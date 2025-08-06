#include <WiFi.h>
#include <time.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <HardwareSerial.h>
#include <ArduinoJson.h>
#include <queue>
#include <map>
#include <esp_task_wdt.h>
#include <WiFiClientSecure.h>
#include <esp_log.h>  // Add this with other includes
#include <vector>    // Add this for vector support

const int waterRelayPin = 26;
const int fertilizerRelayPin = 23;
const int soilMoisturePin = 34; // Analog pin for soil moisture sensor
const int DHTPIN = 15;          // DHT sensor pin
#define DHTTYPE DHT11           // DHT22 (AM2302) sensor type

DHT dht(DHTPIN, DHTTYPE);

// Threshold ranges (based on 0–1023 scale)
const int dryThreshold = 60;      // 60% dryness threshold
const int humidThreshold = 35;    // 35% dryness threshold
const int disconnectedThreshold = 95;  // 95% indicates likely disconnected

unsigned long previousWaterMillis = 0;
const unsigned long waterOnDuration = 30000;  // 30 seconds
bool waterState = false;

// Fertilizer timing
unsigned long previousFertilizerMillis = 0;
const unsigned long fertilizerOnDuration = 50000;  // 50 seconds
const unsigned long fertilizerOffDuration = 30000; // 30 seconds
bool fertilizerState = false;

// AI-related constants and variables
const int HISTORY_SIZE = 10;
int moistureHistory[HISTORY_SIZE];
int historyIndex = 0;
bool rapidDrying = false;

// Network credentials
const char* ssid = "krezi";
const char* password = "12345678";

// Server Details
const char* serverUrl = "https://server-ydsa.onrender.com/api";  // Base URL
const char* serverUrl2 = "http://192.168.1.8:3000/api";         // Local base URL
const char* sensorEndpoint = "/sensor-data";
const char* schedulesEndpoint = "/schedules";
const char* FIXED_PLANT_ID = "C8dA5OfZEC1EGAhkdAB4";

// NTP Server settings
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 28800;      // UTC+8 (Philippines)
const int daylightOffset_sec = 0;

// GSM module pins for SIM900
#define RXD2 16  // SIM900 TX → ESP32 RX2
#define TXD2 17  // SIM900 RX → ESP32 TX2

// Replace SIM900 definition
HardwareSerial sim900(2);  // Use UART2

// Phone numbers for notifications
const char* phoneNumbers[] = {"+639940090476", "+639554397724",};
const int numPhones = 2;

// Schedule structure
struct Schedule {
    String id;         // Change to String to match MongoDB _id
    String type;
    String time;
    int duration;
    bool enabled;
    std::vector<String> days;
    int moistureThreshold;
    String moistureMode;
    std::vector<int> calendarDays;  // Add support for calendar days
};

std::vector<Schedule> schedules;
std::map<int, bool> triggeredSchedules;  // Track which schedules have been triggered

// Add at the top with other constants
const unsigned long POLLING_INTERVAL = 30000;  // Check schedules every 30 seconds
unsigned long lastPollTime = 0;
unsigned long lastDHTReadTime = 0;
const unsigned long DHT_READ_INTERVAL = 2000;  // Read DHT every 2 seconds

// Add missing variable for minute tracking
int currentMinute = -1;

// SMS queue structure
struct SMSMessage {
    String message;
    int retries;
    unsigned long nextAttempt;
};
std::queue<SMSMessage> smsQueue;
const int MAX_SMS_RETRIES = 3;
unsigned long lastSMSAttempt = 0;
const unsigned long SMS_RETRY_INTERVAL = 10000;  // 10 seconds between retries

// Add these constants after other GSM definitions
enum GSMStatus {
    GSM_ERROR,
    GSM_READY,
    GSM_WAITING
};

GSMStatus gsmStatus = GSM_WAITING;
unsigned long lastGSMRetry = 0;
const unsigned long GSM_RETRY_INTERVAL = 60000; // 1 minute between retries

// Replace readGSMResponse with improved version
String readGSMResponse(unsigned long timeout = 5000) {
    String response = "";
    unsigned long startTime = millis();
    while (millis() - startTime < timeout) {
        while (sim900.available()) {
            char c = sim900.read();
            response += c;
            delay(1); // Give a tiny delay to allow buffer to fill
        }
        if (response.indexOf("OK") >= 0 || response.indexOf("ERROR") >= 0) {
            break; // Exit early if we got a definitive response
        }
    }
    return response;
}

// Replace initGSM with improved version
bool initGSM() {
    Serial.println("\n📱 Initializing GSM Module...");
    sim900.begin(9600, SERIAL_8N1, RXD2, TXD2);
    delay(3000);

    // Test AT command
    sim900.println("AT");
    String response = readGSMResponse(1000);
    if (response.indexOf("OK") == -1) {
        Serial.println("❌ GSM not responding");
        gsmStatus = GSM_ERROR;
        return false;
    }

    // Reset to factory defaults
    sim900.println("ATZ");
    if (readGSMResponse().indexOf("OK") == -1) {
        Serial.println("❌ GSM reset failed");
        gsmStatus = GSM_ERROR;
        return false;
    }

    // Check network registration
    int networkRetries = 0;
    bool networkRegistered = false;
    while (networkRetries < 5 && !networkRegistered) {
        sim900.println("AT+CREG?");
        response = readGSMResponse();
        if (response.indexOf("+CREG: 0,1") >= 0 || response.indexOf("+CREG: 0,5") >= 0) {
            networkRegistered = true;
        } else {
            networkRetries++;
            Serial.println("📱 Waiting for network... Attempt " + String(networkRetries));
            delay(2000);
        }
    }

    if (!networkRegistered) {
        Serial.println("❌ Network registration failed");
        gsmStatus = GSM_ERROR;
        return false;
    }

    // Set SMS text mode
    sim900.println("AT+CMGF=1");
    if (readGSMResponse().indexOf("OK") == -1) {
        Serial.println("❌ Failed to set SMS mode");
        gsmStatus = GSM_ERROR;
        return false;
    }

    // Check signal quality
    sim900.println("AT+CSQ");
    response = readGSMResponse();
    if (response.indexOf("+CSQ:") >= 0) {
        Serial.println("📶 Signal Quality: " + response);
    }

    gsmStatus = GSM_READY;
    Serial.println("✅ GSM Module Ready");
    return true;
}

// Add new GSM recovery function
void checkGSMStatus() {
    if (gsmStatus == GSM_ERROR && millis() - lastGSMRetry >= GSM_RETRY_INTERVAL) {
        Serial.println("🔄 Attempting GSM recovery...");
        if (initGSM()) {
            Serial.println("✅ GSM Module recovered");
        } else {
            Serial.println("❌ GSM recovery failed");
        }
        lastGSMRetry = millis();
    }
}

// Replace sendSMS with improved version
bool sendSMS(const char* message, const char* phoneNumber) {
    if (gsmStatus != GSM_READY) {
        Serial.println("❌ GSM not ready");
        return false;
    }

    Serial.println("📨 Sending SMS to " + String(phoneNumber));
    
    // Check if module is responsive
    sim900.println("AT");
    if (readGSMResponse(1000).indexOf("OK") == -1) {
        Serial.println("❌ GSM not responding");
        gsmStatus = GSM_ERROR;
        return false;
    }

    // Send SMS command
    sim900.print("AT+CMGS=\"");
    sim900.print(phoneNumber);
    sim900.println("\"");
    
    delay(100);
    String response = readGSMResponse(1000);
    if (response.indexOf(">") == -1) {
        Serial.println("❌ Failed to get SMS prompt");
        return false;
    }

    // Send message content
    sim900.print(message);
    sim900.write(26);  // Ctrl+Z
    
    response = readGSMResponse(10000); // Longer timeout for SMS sending
    bool success = (response.indexOf("OK") >= 0 && response.indexOf("+CMGS:") >= 0);
    
    if (success) {
        Serial.println("✅ SMS sent successfully");
    } else {
        Serial.println("❌ Failed to send SMS");
        if (response.indexOf("ERROR") >= 0) {
            gsmStatus = GSM_ERROR;
        }
    }
    
    return success;
}

// Update processSMSQueue to use new error handling
void processSMSQueue() {
    if (gsmStatus != GSM_READY) {
        checkGSMStatus();
        return;
    }

    if (smsQueue.empty() || millis() - lastSMSAttempt < SMS_RETRY_INTERVAL) {
        return;
    }

    SMSMessage& sms = smsQueue.front();
    if (millis() >= sms.nextAttempt) {
        lastSMSAttempt = millis();
        bool success = false;

        for (int i = 0; i < numPhones && !success; i++) {
            success = sendSMS(sms.message.c_str(), phoneNumbers[i]);
            if (!success && gsmStatus == GSM_ERROR) {
                break; // Exit if GSM module is in error state
            }
        }

        if (success || sms.retries >= MAX_SMS_RETRIES) {
            smsQueue.pop();
        } else {
            sms.retries++;
            sms.nextAttempt = millis() + SMS_RETRY_INTERVAL;
        }
    }
}

// Time sync function
bool syncTime() {
    int retries = 0;
    const int maxRetries = 5;
    
    while (retries < maxRetries) {
        configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
        
        struct tm timeinfo;
        if (getLocalTime(&timeinfo)) {
            Serial.println("⏰ Time synchronized");
            return true;
        }
        
        retries++;
        Serial.println("Retrying time sync...");
        delay(2000);
    }
    
    return false;
}

// Update the server communication function
void sendDataToServer(int moisture, bool waterState, float temperature, float humidity) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected");
        return;
    }

    struct tm timeinfo;
    if(!getLocalTime(&timeinfo)) {
        Serial.println("Failed to obtain time");
        return;
    }

    char timestamp[25];
    strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%S.000Z", &timeinfo);

    // Create JSON document
    StaticJsonDocument<200> doc;
    doc["plantId"] = FIXED_PLANT_ID;
    doc["moisture"] = convertToMoisturePercent(moisture);
    doc["temperature"] = temperature;
    doc["humidity"] = humidity;
    doc["waterState"] = waterState;
    doc["fertilizerState"] = fertilizerState;
    doc["timestamp"] = timestamp;
    doc["isConnected"] = true;  // Add explicit connection state

    String jsonString;
    serializeJson(doc, jsonString);

    // Setup HTTPS client
    WiFiClientSecure *client = new WiFiClientSecure;
    if(client) {
        client->setInsecure();
        HTTPClient https;
        https.begin(*client, String(serverUrl) + sensorEndpoint);  // Use sensorEndpoint
        https.addHeader("Content-Type", "application/json");
        
        // Send with retries
        int retries = 0;
        int httpResponseCode;
        bool success = false;
        
        while (retries < 3 && !success) {
            httpResponseCode = https.POST(jsonString);
            
            if (httpResponseCode > 0) {
                String response = https.getString();
                Serial.println("✅ Server response code: " + String(httpResponseCode));
                Serial.println("📥 Response: " + response);
                success = true;
            } else {
                retries++;
                Serial.println("❌ Error on sending POST: " + https.errorToString(httpResponseCode));
                if (retries < 3) {
                    Serial.println("🔄 Retrying... Attempt " + String(retries + 1));
                    delay(1000);
                }
            }
        }

        https.end();
        delete client;

        // Try local server only if remote failed
        if (!success) {
            HTTPClient http;
            http.begin(serverUrl2);
            http.addHeader("Content-Type", "application/json");
            
            httpResponseCode = http.POST(jsonString);
            if (httpResponseCode > 0) {
                String response = http.getString();
                Serial.println("✅ Local server response: " + response);
            }
            http.end();
        }
    } else {
        Serial.println("❌ Failed to create HTTPS client");
    }
}

// Schedule fetching function
void fetchSchedules() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected");
        return;
    }

    Serial.println("\n📅 Fetching schedules from Render...");
    
    WiFiClientSecure *client = new WiFiClientSecure;
    if(!client) {
        Serial.println("❌ Failed to create HTTPS client");
        return;
    }

    client->setInsecure();
    HTTPClient https;
    
    String url = String(serverUrl) + schedulesEndpoint + "/" + FIXED_PLANT_ID + "?enabled=true";
    https.begin(*client, url);

    int httpCode = https.GET();
    bool success = false;

    if (httpCode > 0) {
        String payload = https.getString();
        Serial.println("✅ Got response from Render server");
        Serial.println("📦 Raw response: " + payload); // Debug print
        
        DynamicJsonDocument doc(2048); // Increase buffer size
        DeserializationError error = deserializeJson(doc, payload);
        
        if (!error) {
            success = true;
            schedules.clear();
            
            // Check if schedules array exists
            if (doc.containsKey("schedules") && doc["schedules"].is<JsonArray>()) {
                JsonArray schedulesArray = doc["schedules"];
                Serial.printf("Found %d schedules in array\n", schedulesArray.size());
                
                for (JsonObject scheduleObj : schedulesArray) {
                    Schedule schedule;
                    if (scheduleObj.containsKey("_id")) schedule.id = scheduleObj["_id"].as<String>();
                    if (scheduleObj.containsKey("type")) schedule.type = scheduleObj["type"].as<String>();
                    if (scheduleObj.containsKey("time")) schedule.time = scheduleObj["time"].as<String>();
                    if (scheduleObj.containsKey("duration")) schedule.duration = scheduleObj["duration"].as<int>();
                    if (scheduleObj.containsKey("enabled")) schedule.enabled = scheduleObj["enabled"].as<bool>();
                    
                    // Parse settings object
                    if (scheduleObj.containsKey("settings")) {
                        JsonObject settings = scheduleObj["settings"];
                        schedule.moistureThreshold = settings["moistureThreshold"] | 60;
                        schedule.moistureMode = settings["moistureMode"] | "manual";
                    }
                    
                    // Handle both regular days and calendar days
                    if (scheduleObj.containsKey("days") && scheduleObj["days"].is<JsonArray>()) {
                        JsonArray daysArray = scheduleObj["days"];
                        for (JsonVariant day : daysArray) {
                            if (day.is<String>()) {
                                schedule.days.push_back(day.as<String>());
                            }
                        }
                    }
                    
                    if (scheduleObj.containsKey("calendarDays") && scheduleObj["calendarDays"].is<JsonArray>()) {
                        JsonArray calendarDays = scheduleObj["calendarDays"];
                        for (JsonVariant day : calendarDays) {
                            if (day.is<int>()) {
                                schedule.calendarDays.push_back(day.as<int>());
                            }
                        }
                    }
                    
                    schedules.push_back(schedule);
                    Serial.printf("Added schedule: ID=%s, Type=%s\n", 
                        schedule.id.c_str(), schedule.type.c_str());
                }
            } else {
                Serial.println("❌ No schedules array found in response");
            }
        } else {
            Serial.print("❌ JSON parse error: ");
            Serial.println(error.c_str());
        }
    } else {
        Serial.printf("❌ HTTP GET failed, error: %s\n", 
            https.errorToString(httpCode).c_str());
    }
    
    https.end();
    delete client;

    // Print final status
    if (success) {
        Serial.printf("✅ Successfully loaded %d schedules\n", schedules.size());
    } else {
        Serial.println("❌ Failed to load schedules");
    }
}

// Helper functions
int convertToMoisturePercent(int rawValue) {
    // Invert and convert to percentage (1023 = 0%, 0 = 100%)
    // Constrain raw value to valid range first
    rawValue = constrain(rawValue, 0, 1023);
    return map(rawValue, 0, 1023, 100, 0);
}

String getMoistureStatus(int moisturePercent) {
    if (moisturePercent >= 95) return "SENSOR ERROR";    // Likely disconnected
    if (moisturePercent <= 35) return "DRY";            // Below 35% moisture is dry
    if (moisturePercent <= 65) return "HUMID";          // 35-65% is humid
    if (moisturePercent > 65) return "WET";             // Above 65% is wet
    return "SENSOR ERROR";                              // Fallback
}

// Add new constant for watchdog control
const bool USE_WATCHDOG = true;

// Forward declare sendEventData (add before setup())
void sendEventData(const char* type, const char* action, const char* details = nullptr);

void setup() {
    // Add these lines at the very start of setup()
    esp_log_level_set("*", ESP_LOG_NONE);  // Disable all ESP32 debug output
    delay(100);  // Wait for any pending messages
    Serial.begin(115200);
    Serial.println();  // Clear line
    Serial.println("🌱 Smart Plant System Starting...");

    // Continue with the rest of the setup code
    // ...existing code...
    analogReadResolution(10); // Use 0–1023 range
    pinMode(waterRelayPin, OUTPUT);
    digitalWrite(waterRelayPin, LOW); // Start with pump OFF
    pinMode(fertilizerRelayPin, OUTPUT);
    digitalWrite(fertilizerRelayPin, LOW); // Start with fertilizer OFF

    // Connect to WiFi with retry
    WiFi.begin(ssid, password);
    int attempts = 0;
    Serial.print("Connecting to WiFi");
    
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n✅ Connected to WiFi!");
        Serial.println("📡 IP: " + WiFi.localIP().toString());
        
        // Try to sync time with retries
        if (syncTime()) {
            Serial.println("✅ Time synchronized successfully");
        } else {
            Serial.println("❌ Time sync failed - system will restart");
            ESP.restart();
        }
    } else {
        Serial.println("\n❌ WiFi Connection Failed!");
        ESP.restart();
    }

    dht.begin();
    Serial.println("DHT sensor initialized");

    // Initialize GSM module
    if (!initGSM()) {
        Serial.println("⚠️ GSM initialization failed - will retry later");
    }
    Serial.println("GSM Module Ready");

    // Modify watchdog initialization to be conditional
    if (USE_WATCHDOG) {
        esp_task_wdt_config_t wdt_config = {
            .timeout_ms = 60000,                   // Increase to 60 seconds
            .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
            .trigger_panic = true
        };
        esp_task_wdt_init(&wdt_config);
        esp_task_wdt_add(NULL);
    }
    
    // Initialize moisture history
    for (int i = 0; i < HISTORY_SIZE; i++) {
        moistureHistory[i] = 0;
    }
}

// Add global variables before the Schedule structure
float humidity = 0;
float temperature = 0;
int soilMoistureValue = 0;
String moistureStatus;
String currentDate;
bool isScheduledDate = false;

// Add timing variables
unsigned long lastReadTime = 0;
unsigned long lastSendTime = 0;
unsigned long lastStatusPrintMillis = 0;
unsigned long lastHeapCheck = 0;
unsigned long lastDiagnosticsLog = 0;

// Add state tracking variables
bool lastWaterState = false;
bool lastFertilizerState = false;

// Add timing constants
const unsigned long SEND_INTERVAL = 30000;  // Send data every 30 seconds
const unsigned long READ_INTERVAL = 30000;  // Read sensors every 30 seconds
const unsigned long STATUS_PRINT_INTERVAL = 5000;  // Print status every 5 seconds

// Add watchdog control functions
void pauseWatchdog() {
    if (USE_WATCHDOG) {
        esp_task_wdt_delete(NULL);
    }
}

void resumeWatchdog() {
    if (USE_WATCHDOG) {
        esp_task_wdt_add(NULL);
        esp_task_wdt_reset();
    }
}

void updateMoistureHistory(int currentValue) {
    moistureHistory[historyIndex] = currentValue;
    historyIndex = (historyIndex + 1) % HISTORY_SIZE;
}

bool detectRapidDrying() {
    if (historyIndex < HISTORY_SIZE) return false;  // Wait until history is filled
    
    int current = (historyIndex - 1 + HISTORY_SIZE) % HISTORY_SIZE;
    int prev = (historyIndex - 2 + HISTORY_SIZE) % HISTORY_SIZE;
    
    return (moistureHistory[current] - moistureHistory[prev] > 50);
}

void queueSMS(const char* message) {
    SMSMessage sms;
    sms.message = String(message);
    sms.retries = 0;
    sms.nextAttempt = millis();
    smsQueue.push(sms);
}

// Add this new function after convertToMoisturePercent()
bool isFertilizingScheduled(const Schedule& schedule, int currentDay, String currentTime) {
    // For fertilizing type, check calendar days
    if (schedule.type == "fertilizing") {
        // Check if current day matches any calendar day
        for (int day : schedule.calendarDays) {
            if (day == currentDay && schedule.time == currentTime) {
                return true;
            }
        }
    }
    return false;
}

// Replace the existing checkSchedules() function
void checkSchedules() {
    struct tm timeinfo;
    if(!getLocalTime(&timeinfo)) {
        Serial.println("Failed to obtain time");
        return;
    }
    
    // Reset triggers if minute has changed
    if (timeinfo.tm_min != currentMinute) {
        triggeredSchedules.clear();
        currentMinute = timeinfo.tm_min;
    }
    
    char currentTime[6];
    char currentDate[3];
    char currentDayName[10];
    strftime(currentTime, sizeof(currentTime), "%H:%M", &timeinfo);
    strftime(currentDate, sizeof(currentDate), "%d", &timeinfo);
    strftime(currentDayName, sizeof(currentDayName), "%A", &timeinfo);
    
    String dayName = String(currentDayName);
    int currentDay = atoi(currentDate);
    
    Serial.printf("Checking schedules for %s at %s (Day: %s)\n", 
        currentTime, currentDate, currentDayName);
    
    for (const auto& schedule : schedules) {
        // Skip if already triggered this minute or not enabled
        if (!schedule.enabled || triggeredSchedules[schedule.id.toInt()]) {
            continue;
        }
        
        bool shouldRun = false;
        
        // Handle fertilizing schedules
        if (schedule.type == "fertilizing") {
            shouldRun = isFertilizingScheduled(schedule, currentDay, String(currentTime));
            if (shouldRun) {
                Serial.printf("🌱 Fertilizing schedule triggered for day %d at %s\n", 
                    currentDay, currentTime);
                isScheduledDate = true;  // Set this flag for fertilizer control
                triggeredSchedules[schedule.id.toInt()] = true;
            }
        }
        // Handle watering schedules (existing logic)
        else if (schedule.type == "watering") {
            // ... existing watering schedule code ...
        }
    }
}
void loop() {
    unsigned long currentMillis = millis();
    static int moisturePercent = 0;  // Add this line to declare moisturePercent
    
    // Get current date at the start of loop
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
        char dateStr[3];
        strftime(dateStr, sizeof(dateStr), "%d", &timeinfo);
        currentDate = String(dateStr);
    }
    
    // WiFi check
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("📡 Reconnecting WiFi...");
        WiFi.reconnect();
        delay(5000);
        return;
    }

    pauseWatchdog();
    
    // Read sensors every 30 seconds
    if (currentMillis - lastReadTime >= READ_INTERVAL) {
        // Read DHT sensor
        humidity = dht.readHumidity();
        temperature = dht.readTemperature();
        
        // Read soil moisture and convert to percentage
        soilMoistureValue = analogRead(soilMoisturePin);
        moisturePercent = convertToMoisturePercent(soilMoistureValue);

        updateMoistureHistory(moisturePercent);
        rapidDrying = detectRapidDrying();
        
        // Update status and display
        moistureStatus = getMoistureStatus(moisturePercent);
        
        // Print readings
        char msgBuffer[100];
        snprintf(msgBuffer, sizeof(msgBuffer), "🌡️ Temperature: %.1f °C | 💧 Humidity: %.1f %%", 
                temperature, humidity);
        Serial.println(msgBuffer);
        
        Serial.print("🌱 Soil Moisture: ");
        Serial.print(moisturePercent);
        Serial.print("% → Status: ");
        Serial.println(moistureStatus);
        
        lastReadTime = currentMillis;
    }

    // Send data every 30 seconds
    if (currentMillis - lastSendTime >= SEND_INTERVAL) {
        sendDataToServer(soilMoistureValue, waterState, temperature, humidity);
        lastSendTime = currentMillis;
    }

    resumeWatchdog();

    // Replace the direct status prints with this new code block
    if (currentMillis - lastStatusPrintMillis >= STATUS_PRINT_INTERVAL || 
        lastWaterState != waterState || 
        lastFertilizerState != fertilizerState) {
            
        Serial.println("\n=== System Status ===");
        Serial.println("💧 Water Pump Status: " + String(waterState ? "ON" : "OFF"));
        Serial.println("🌱 Fertilizer Status: " + String(fertilizerState ? "ON" : "OFF"));
        Serial.println("====================\n");
        
        lastStatusPrintMillis = currentMillis;
        lastWaterState = waterState;
        lastFertilizerState = fertilizerState;
    }

    // Enhanced water pump control logic
    if (waterState) {
        Serial.println("💧 Water Pump Status: ON");  // Add this line
        if (currentMillis - previousWaterMillis >= waterOnDuration || 
            moisturePercent <= dryThreshold || moisturePercent >= disconnectedThreshold) {
            waterState = false;
            digitalWrite(waterRelayPin, LOW);
            
            String reason;
            if (moisturePercent >= disconnectedThreshold) {
                reason = "Sensor disconnected or not in soil";
                sendEventData("watering", "stopped", reason.c_str());
            } else if (moisturePercent <= dryThreshold) {
                reason = "Target moisture level reached";
                sendEventData("watering", "completed", reason.c_str());
            } else {
                reason = "Duration completed";
                sendEventData("watering", "completed", reason.c_str());
            }
            
            String message;
            if (moisturePercent >= disconnectedThreshold) {
                message = "Smart Plant System: Watering stopped. Reason: Sensor disconnected or not in soil.";
            } else if (moisturePercent <= dryThreshold) {
                message = "Smart Plant System: Watering stopped. Soil is now humid/wet.";
            } else {
                message = "Smart Plant System: Watering cycle completed.";
            }
            Serial.println("Water pump OFF: " + moistureStatus);
            queueSMS(message.c_str());
        }
    } else {
        Serial.println("💧 Water Pump Status: OFF");  // Add this line
        // Find applicable watering schedule
        Schedule* activeSchedule = nullptr;
        for (auto& schedule : schedules) {
            if (schedule.type == "watering" && schedule.enabled) {
                activeSchedule = &schedule;
                break;
            }
        }

        // Get threshold from schedule or use default
        int currentThreshold = (activeSchedule) ? activeSchedule->moistureThreshold : 60;
        bool isAutoMode = (activeSchedule) ? (activeSchedule->moistureMode == "auto") : false;

        // Only start automatic watering if in auto mode and soil is dry
        if (isAutoMode && moisturePercent > currentThreshold && moisturePercent < disconnectedThreshold) {
            waterState = true;
            previousWaterMillis = currentMillis;
            digitalWrite(waterRelayPin, HIGH);
            
            String details = "Moisture: " + String(moisturePercent) + "% (Threshold: " + String(currentThreshold) + "%)";
            sendEventData("watering", "started", details.c_str());
            
            Serial.println("Water pump ON: " + moistureStatus);
            String smsMessage = "Smart Plant System: Started watering. Soil is dry (" + 
                              String(moisturePercent) + "%, Threshold: " + String(currentThreshold) + "%)";
            queueSMS(smsMessage.c_str());
        }
    }

    // Fertilizer timing control
    if (fertilizerState) {
        Serial.println("🌱 Fertilizer Status: ON");  // Add this line
        if (currentMillis - previousFertilizerMillis >= fertilizerOnDuration) {
            fertilizerState = false;
            digitalWrite(fertilizerRelayPin, LOW);
            
            sendEventData("fertilizer", "completed", "Duration completed");
            
            String completionMsg = "Smart Plant System: Fertilizer cycle completed.";
            Serial.println("✅ " + completionMsg);
            queueSMS(completionMsg.c_str());
        }
    } else {
        Serial.println("🌱 Fertilizer Status: OFF");  // Add this line
        // In checkSchedules() when starting fertilizer
        if (isScheduledDate) {
            fertilizerState = true;
            previousFertilizerMillis = millis();
            digitalWrite(fertilizerRelayPin, HIGH);
            
            String details = "Scheduled application on day " + String(currentDate);
            sendEventData("fertilizer", "started", details.c_str());
            
            String message = "Smart Plant System: Starting scheduled fertilizing for day " + String(currentDate);
            Serial.println(message);
            queueSMS(message.c_str());
        }
    }

    // Add GSM status check before processing SMS queue
    checkGSMStatus();
    processSMSQueue();
    
    // Schedule polling with proper interval checking
    if (currentMillis - lastPollTime >= POLLING_INTERVAL) {
        fetchSchedules();
        lastPollTime = currentMillis;
    }
    
    checkSchedules();
    
    // Heap check
    if (currentMillis - lastHeapCheck >= 30000) {
        Serial.printf("Free heap: %d bytes\n", ESP.getFreeHeap());
        lastHeapCheck = currentMillis;
    }

    // Log system diagnostics
    logSystemDiagnostics();

    delay(100);
}

// Add near the other helper functions
void sendEventData(const char* type, const char* action, const char* details) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected - Event not sent");
        return;
    }

    StaticJsonDocument<512> doc;
    doc["plantId"] = FIXED_PLANT_ID;
    doc["type"] = type;
    doc["action"] = action;
    doc["status"] = "success";  // Add status field
    
    if (details) {
        doc["details"] = details;
    }

    // Add more detailed sensor data
    JsonObject sensorData = doc.createNestedObject("sensorData");
    sensorData["moisture"] = convertToMoisturePercent(analogRead(soilMoisturePin));
    sensorData["temperature"] = dht.readTemperature();
    sensorData["humidity"] = dht.readHumidity();
    sensorData["waterState"] = waterState;
    sensorData["fertilizerState"] = fertilizerState;
    sensorData["moistureStatus"] = getMoistureStatus(convertToMoisturePercent(analogRead(soilMoisturePin)));
    sensorData["isConnected"] = WiFi.status() == WL_CONNECTED;
    sensorData["signalStrength"] = WiFi.RSSI();
    sensorData["gsmStatus"] = gsmStatus == GSM_READY ? "ready" : "error";

    // Add system metrics
    JsonObject systemData = doc.createNestedObject("systemData");
    systemData["freeHeap"] = ESP.getFreeHeap();
    systemData["uptime"] = millis() / 1000;
    systemData["wifiSignal"] = WiFi.RSSI();

    String jsonString;
    serializeJson(doc, jsonString);

    // Try both servers
    bool success = false;
    
    // Try Render server first
    WiFiClientSecure *client = new WiFiClientSecure;
    if(client) {
        client->setInsecure();
        HTTPClient https;
        https.begin(*client, String(serverUrl) + "/audit-logs");
        https.addHeader("Content-Type", "application/json");
        
        int httpCode = https.POST(jsonString);
        success = (httpCode > 0 && httpCode < 400);
        https.end();
        delete client;
    }

    // Try local server if remote failed
    if (!success) {
        HTTPClient http;
        http.begin(String(serverUrl2) + "/audit-logs");
        http.addHeader("Content-Type", "application/json");
        
        int httpCode = http.POST(jsonString);
        success = (httpCode > 0 && httpCode < 400);
        http.end();
    }

    Serial.println(success ? "✅ Event logged successfully" : "❌ Failed to log event");
}

// Add new helper function for logging system diagnostics
void logSystemDiagnostics() {
    if (millis() - lastDiagnosticsLog >= 3600000) { // Every hour
        String details = "Free heap: " + String(ESP.getFreeHeap()) + 
                        ", Uptime: " + String(millis() / 1000) + "s" +
                        ", WiFi: " + String(WiFi.RSSI()) + "dBm";
        sendEventData("system", "diagnostics", details.c_str());
        lastDiagnosticsLog = millis();
    }
}