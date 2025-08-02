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
const char* serverUrl = "http://192.168.1.8:3000/api/sensor-data";
const char* serverUrl2 = "https://server-ydsa.onrender.com/api/sensor-data";
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
    int id;
    String type;
    String time;
    int duration;
    bool enabled;
    std::vector<String> days;  // Add days vector for fertilizer schedules
};

std::vector<Schedule> schedules;
std::map<int, bool> triggeredSchedules;  // Track which schedules have been triggered

// Add at the top with other constants
const unsigned long POLLING_INTERVAL = 60000;  // Check schedules every minute
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

// Replace the server communication function
void sendDataToServer(int moisture, bool waterState, float temperature, float humidity, bool isHeartbeat = false) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected");
        return;
    }

    // Skip invalid DHT readings
    if (isnan(temperature) || isnan(humidity)) {
        Serial.println("❌ Invalid DHT readings, skipping transmission");
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
    doc["isConnected"] = true;
    doc["heartbeat"] = isHeartbeat;  // Add heartbeat field

    String jsonString;
    serializeJson(doc, jsonString);

    // Setup HTTPS client
    WiFiClientSecure *client = new WiFiClientSecure;
    if(!client) {
        Serial.println("❌ Failed to create HTTPS client");
        return;
    }

    client->setInsecure(); // Skip certificate verification
    HTTPClient https;
    
    // Set longer timeout and retry mechanism
    https.setTimeout(15000); // 15 seconds timeout
    
    // Try to connect to Render server
    Serial.println("📡 Sending data to Render...");
    https.begin(*client, serverUrl2);
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
        http.begin(serverUrl);
        http.addHeader("Content-Type", "application/json");
        
        httpResponseCode = http.POST(jsonString);
        if (httpResponseCode > 0) {
            String response = http.getString();
            Serial.println("✅ Local server response: " + response);
        }
        http.end();
    }

    if (success) {
        // Update last sent values only on successful transmission
        lastSentTemp = temperature;
        lastSentHumidity = humidity;
        lastSentMoisture = convertToMoisturePercent(moisture);
        lastHeartbeatTime = currentMillis;

        if (isHeartbeat) {
            Serial.println("💓 Heartbeat sent successfully");
        } else {
            Serial.println("📡 Sensor update sent successfully");
        }
    }
}

// Schedule fetching function
void fetchSchedules() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected");
        return;
    }

    HTTPClient http;
    String url = String(serverUrl) + "/schedules/" + FIXED_PLANT_ID + "?enabled=true";
    http.begin(url);

    int httpCode = http.GET();
    if (httpCode > 0) {
        String payload = http.getString();
        
        // Parse JSON response
        StaticJsonDocument<1024> doc;
        DeserializationError error = deserializeJson(doc, payload);
        
        if (!error) {
            schedules.clear();
            JsonArray schedulesArray = doc["schedules"];
            
            for (JsonObject scheduleObj : schedulesArray) {
                Schedule schedule;
                schedule.id = scheduleObj["id"].as<int>();
                schedule.type = scheduleObj["type"].as<String>();
                schedule.time = scheduleObj["time"].as<String>();
                schedule.duration = scheduleObj["duration"].as<int>();
                schedule.enabled = scheduleObj["enabled"].as<bool>();
                schedules.push_back(schedule);
            }
        }
    }
    
    http.end();
}

// Helper functions
int convertToMoisturePercent(int rawValue) {
    // Invert and convert to percentage (1023 = 0%, 0 = 100%)
    // Constrain raw value to valid range first
    rawValue = constrain(rawValue, 0, 1023);
    return map(rawValue, 0, 1023, 100, 0);
}

String getMoistureStatus(int moisturePercent) {
  if (moisturePercent >= 95) return "WET";          // In water
  if (moisturePercent >= 60) return "HUMID";        // Moist enough
  if (moisturePercent >= 1) return "DRY";           // Needs water
  return "SENSOR ERROR";                            // 0% = disconnected or very dry
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

    Serial.begin(115200);

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

void checkSchedules() {
    struct tm timeinfo;
    if(!getLocalTime(&timeinfo)){
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
    strftime(currentTime, sizeof(currentTime), "%H:%M", &timeinfo);
    strftime(currentDate, sizeof(currentDate), "%d", &timeinfo);
    
    for (const auto& schedule : schedules) {
        // Skip if already triggered this minute or not enabled
        if (!schedule.enabled || triggeredSchedules[schedule.id]) {
            continue;
        }
        
        if (schedule.time == String(currentTime)) {
            if (schedule.type == "watering" && !waterState) {
                int currentMoisture = analogRead(soilMoisturePin);
                int moisturePercent = convertToMoisturePercent(currentMoisture);
                if (moisturePercent > dryThreshold && moisturePercent < disconnectedThreshold) {
                    waterState = true;
                    previousWaterMillis = millis();
                    digitalWrite(waterRelayPin, HIGH);
                    String message = "Smart Plant System: Starting scheduled watering - soil is dry (" + 
                                   String(moisturePercent) + "%)";
                    Serial.println(message);
                    queueSMS(message.c_str());
                } else {
                    String message = "Smart Plant System: Scheduled watering skipped - soil is already humid (" + 
                                   String(moisturePercent) + "%)";
                    Serial.println(message);
                    queueSMS(message.c_str());
                }
                triggeredSchedules[schedule.id] = true;
            }
            else if (schedule.type == "fertilizing" && !fertilizerState) {
                // Check if current date matches any of the scheduled dates
                bool isScheduledDate = false;
                for (const auto& day : schedule.days) {
                    if (day == String(currentDate)) {
                        isScheduledDate = true;
                        break;
                    }
                }
                
                if (isScheduledDate) {
                    fertilizerState = true;
                    previousFertilizerMillis = millis();
                    digitalWrite(fertilizerRelayPin, HIGH);
                    String message = "Smart Plant System: Starting scheduled fertilizing for day " + String(currentDate);
                    Serial.println(message);
                    queueSMS(message.c_str());
                    triggeredSchedules[schedule.id] = true;
                }
            }
        }
    }
}

// Add watchdog control functions before loop()
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

// Add these with other global variables at the top
float humidity = 0;
float temperature = 0;
int soilMoistureValue = 0;
String moistureStatus;
unsigned long lastHeapCheck = 0;

const unsigned long SEND_INTERVAL = 30000;  // Send data every 30 seconds
const unsigned long READ_INTERVAL = 30000;  // Read sensors every 30 seconds
unsigned long lastSendTime = 0;
unsigned long lastReadTime = 0;

// Add after other global variables (before setup())
bool isScheduledDate = false;
String currentDate;

// Add these with other global variables at the top
unsigned long lastStatusPrintMillis = 0;
const unsigned long STATUS_PRINT_INTERVAL = 5000;  // Print status every 5 seconds
bool lastWaterState = false;
bool lastFertilizerState = false;

// Add new global variable for diagnostics logging
unsigned long lastDiagnosticsLog = 0;

// Add these with other global variables
float lastSentTemp = 0;
float lastSentHumidity = 0;
int lastSentMoisture = 0;
unsigned long lastHeartbeatTime = 0;

// Define thresholds
const float TEMP_THRESHOLD = 0.5;     // ±0.5°C
const float HUMIDITY_THRESHOLD = 3.0;  // ±3%
const float MOISTURE_THRESHOLD = 5.0;  // ±5%
const unsigned long HEARTBEAT_INTERVAL = 600000;  // 10 minutes in milliseconds

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
        sendDataToServer(soilMoistureValue, waterState, temperature, humidity, false);
        lastSendTime = currentMillis;
    } else if (currentMillis - lastHeartbeatTime >= HEARTBEAT_INTERVAL) {
        sendDataToServer(soilMoistureValue, waterState, temperature, humidity, true);
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
        // Only start watering if soil is dry
        if (moisturePercent > dryThreshold && moisturePercent < disconnectedThreshold) {  // DRY condition only
            waterState = true;
            previousWaterMillis = currentMillis;
            digitalWrite(waterRelayPin, HIGH);
            
            String details = "Moisture: " + String(moisturePercent) + "%";
            sendEventData("watering", "started", details.c_str());
            
            Serial.println("Water pump ON: " + moistureStatus);
            String smsMessage = "Smart Plant System: Started watering. Soil is dry (" + String(soilMoistureValue) + " reading)";
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
        https.begin(*client, String(serverUrl2) + "/audit-logs");
        https.addHeader("Content-Type", "application/json");
        
        int httpCode = https.POST(jsonString);
        success = (httpCode > 0 && httpCode < 400);
        https.end();
        delete client;
    }

    // Try local server if remote failed
    if (!success) {
        HTTPClient http;
        http.begin(String(serverUrl) + "/audit-logs");
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