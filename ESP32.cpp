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

const int waterRelayPin = 26;
const int fertilizerRelayPin = 23;
const int soilMoisturePin = 34; // Analog pin for soil moisture sensor
const int DHTPIN = 15;          // DHT sensor pin
#define DHTTYPE DHT11           // DHT22 (AM2302) sensor type

DHT dht(DHTPIN, DHTTYPE);

// Threshold ranges (based on 0–1023 scale)
const int dryThreshold = 600;
const int humidThreshold = 370;
const int disconnectedThreshold = 1000;

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
const char* primaryServerUrl = "http://192.168.1.8:3000/api/sensor-data";
const char* backupServerUrl = "https://server-5527.onrender.com/api/sensor-data";
const char* FIXED_PLANT_ID = "C8dA5OfZEC1EGAhkdAB4";

// Add server retry settings
const int SERVER_RETRY_COUNT = 3;      // Number of retries for primary server
const int SERVER_RETRY_DELAY = 1000;   // Delay between retries in milliseconds

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
};

std::vector<Schedule> schedules;
std::map<int, bool> triggeredSchedules;  // Track which schedules have been triggered

// Add at the top with other constants
const unsigned long POLLING_INTERVAL = 60000;  // Check schedules every minute
const unsigned long DHT_READ_INTERVAL = 2000;  // Read DHT every 2 seconds
const unsigned long DATA_SEND_INTERVAL = 30000; // Send data every 30 seconds

// Timing variables
unsigned long lastPollTime = 0;
unsigned long lastDHTReadTime = 0;
unsigned long lastDataSendTime = 0;  // Add this line

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

// Add GSM retry variables
unsigned long lastGSMRetry = 0;
const unsigned long GSM_RETRY_INTERVAL = 60000; // 1 minute between retries

GSMStatus gsmStatus = GSM_WAITING;  // Now this will work

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

// Simplified GSM initialization
bool initGSM() {
    Serial.println("📱 Initializing GSM Module...");
    sim900.begin(9600, SERIAL_8N1, RXD2, TXD2);
    delay(3000);

    sim900.println("AT");
    if (readGSMResponse(1000).indexOf("OK") == -1) {
        Serial.println("❌ GSM not responding");
        return false;
    }

    sim900.println("AT+CMGF=1");  // Set SMS text mode
    if (readGSMResponse().indexOf("OK") == -1) {
        return false;
    }

    Serial.println("✅ GSM Ready");
    return true;
}

// Simplified SMS sending
bool sendSMS(const char* message, const char* phoneNumber) {
    sim900.print("AT+CMGS=\"");
    sim900.print(phoneNumber);
    sim900.println("\"");
    delay(100);
    
    sim900.print(message);
    sim900.write(26);  // Ctrl+Z
    
    String response = readGSMResponse(5000);
    return (response.indexOf("OK") >= 0);
}

// Simplify GSM status check and recovery
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

// Simplified SMS queue processing
void processSMSQueue() {
    if (smsQueue.empty() || millis() - lastSMSAttempt < SMS_RETRY_INTERVAL) {
        return;
    }

    SMSMessage& sms = smsQueue.front();
    if (millis() >= sms.nextAttempt) {
        lastSMSAttempt = millis();
        
        bool sent = false;
        for (int i = 0; i < numPhones && !sent; i++) {
            sent = sendSMS(sms.message.c_str(), phoneNumbers[i]);
        }

        if (sent || sms.retries >= MAX_SMS_RETRIES) {
            smsQueue.pop();
        } else {
            sms.retries++;
            sms.nextAttempt = millis() + SMS_RETRY_INTERVAL;
        }
    }
}

bool syncTime() {
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    struct tm timeinfo;
    if(!getLocalTime(&timeinfo)) {
        Serial.println("Failed to obtain time");
        return false;
    }
    return true;
}

// Get moisture status helper function
String getMoistureStatus(int value) {
    if (value >= disconnectedThreshold) {
        return "DISCONNECTED";
    } else if (value > dryThreshold) {
        return "DRY";
    } else if (value > humidThreshold) {
        return "HUMID";
    } else {
        return "WET";
    }
}

// Server communication function
void sendDataToServer(int moisture, bool waterState, float temperature, float humidity) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected - attempting reconnection");
        WiFi.reconnect();
        return;
    }

    HTTPClient http;
    StaticJsonDocument<200> doc;
    doc["plantId"] = FIXED_PLANT_ID;
    doc["moisture"] = moisture;
    doc["temperature"] = temperature;
    doc["humidity"] = humidity;
    doc["pumpState"] = waterState;
    doc["fertilizerState"] = fertilizerState;

    String jsonString;
    serializeJson(doc, jsonString);

    // Try primary server first
    bool sent = false;
    for (int i = 0; i < SERVER_RETRY_COUNT && !sent; i++) {
        http.begin(primaryServerUrl);
        http.addHeader("Content-Type", "application/json");
        int httpCode = http.POST(jsonString);
        
        if (httpCode > 0 && httpCode == HTTP_CODE_CREATED) {
            Serial.println("✅ Data sent to primary server");
            sent = true;
        } else {
            Serial.printf("❌ Primary server attempt %d failed: %d\n", i + 1, httpCode);
            delay(SERVER_RETRY_DELAY);
        }
        http.end();
    }

    // Try backup server if primary failed
    if (!sent) {
        http.begin(backupServerUrl);
        http.addHeader("Content-Type", "application/json");
        int httpCode = http.POST(jsonString);
        
        if (httpCode > 0 && httpCode == HTTP_CODE_CREATED) {
            Serial.println("✅ Data sent to backup server");
        } else {
            Serial.printf("❌ Backup server failed: %d\n", httpCode);
            queueSMS("Warning: Failed to send data to both servers");
        }
        http.end();
    }
}

// Schedule fetching function
void fetchSchedules() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected");
        return;
    }

    HTTPClient http;
    String schedulesUrl = String(primaryServerUrl) + "/schedules/" + String(FIXED_PLANT_ID);
    http.begin(schedulesUrl);

    int httpResponseCode = http.GET();
    
    if (httpResponseCode > 0) {
        String payload = http.getString();
        
        // Parse JSON response
        DynamicJsonDocument doc(1024);
        DeserializationError error = deserializeJson(doc, payload);
        
        if (!error) {
            schedules.clear();
            JsonArray array = doc.as<JsonArray>();
            
            for (JsonObject obj : array) {
                Schedule schedule;
                schedule.id = obj["id"].as<int>();
                schedule.type = obj["type"].as<String>();
                schedule.time = obj["time"].as<String>();
                schedule.duration = obj["duration"].as<int>();
                schedule.enabled = obj["enabled"].as<bool>();
                schedules.push_back(schedule);
            }
        }
    }

    http.end();
}

void setup() {
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

    // Initialize watchdog
    esp_task_wdt_config_t wdt_config = {
      .timeout_ms = 30000,                      // 30 seconds
      .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,  // Both cores
      .trigger_panic = true                     // Reset on WDT timeout
    };

    esp_task_wdt_init(&wdt_config);
 // 30 second timeout
    esp_task_wdt_add(NULL);
    
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
    strftime(currentTime, sizeof(currentTime), "%H:%M", &timeinfo);
    
    for (const auto& schedule : schedules) {
        // Skip if already triggered this minute or not enabled
        if (!schedule.enabled || triggeredSchedules[schedule.id]) {
            continue;
        }
        
        if (schedule.time == String(currentTime)) {
            if (schedule.type == "watering" && !waterState) {
                // FIXED: Check soil moisture before starting scheduled watering
                int currentMoisture = analogRead(soilMoisturePin);
                if (currentMoisture > 600 && currentMoisture < 1000) {  // Only if dry
                    waterState = true;
                    previousWaterMillis = millis();
                    digitalWrite(waterRelayPin, HIGH);
                    String message = "Smart Plant System: Starting scheduled watering - soil is dry (" + String(currentMoisture) + ")";
                    Serial.println(message);
                    queueSMS(message.c_str());
                } else {
                    String message = "Smart Plant System: Scheduled watering skipped - soil is already humid (" + String(currentMoisture) + ")";
                    Serial.println(message);
                    queueSMS(message.c_str());
                }
                triggeredSchedules[schedule.id] = true;  // Mark as triggered regardless
            }
            else if (schedule.type == "fertilizing" && !fertilizerState) {
                fertilizerState = true;
                previousFertilizerMillis = millis();
                digitalWrite(fertilizerRelayPin, HIGH);
                String message = "Smart Plant System: Starting scheduled fertilizing";
                Serial.println(message);
                queueSMS(message.c_str());
                triggeredSchedules[schedule.id] = true;  // Mark as triggered
            }
        }
    }
}

void loop() {
    unsigned long currentMillis = millis();
    
    // Pat the watchdog
    esp_task_wdt_reset();
    
    // Throttled DHT reading
    static float humidity = 0;
    static float temperature = 0;
    if (currentMillis - lastDHTReadTime >= DHT_READ_INTERVAL) {
    humidity = dht.readHumidity();
    temperature = dht.readTemperature();

    if (!isnan(humidity) && !isnan(temperature)) {
        lastDHTReadTime = currentMillis;

        // ✅ Print to Serial Monitor
        Serial.print("🌡️ Temperature: ");
        Serial.print(temperature);
        Serial.print(" °C | 💧 Humidity: ");
        Serial.print(humidity);
        Serial.println(" %");
    } else {
        // ❌ Print error if sensor fails
        Serial.println("❌ Failed to read from DHT sensor (NaN)");
    }
}


    int soilMoistureValue = analogRead(soilMoisturePin);
    updateMoistureHistory(soilMoistureValue);
    rapidDrying = detectRapidDrying();
    String moistureStatus = getMoistureStatus(soilMoistureValue);

    // Print sensor values immediately for monitoring
    Serial.print("🌱 Soil Moisture Value: ");
    Serial.print(soilMoistureValue);
    Serial.print(" → Status: ");
    Serial.println(getMoistureStatus(soilMoistureValue));

    // Only send data to server every 30 seconds
    if (currentMillis - lastDataSendTime >= DATA_SEND_INTERVAL) {
        sendDataToServer(soilMoistureValue, waterState, temperature, humidity);
        lastDataSendTime = currentMillis;
    }

    // Enhanced water pump control logic
    if (waterState) {
        if (currentMillis - previousWaterMillis >= waterOnDuration || 
            soilMoistureValue <= 600 || soilMoistureValue >= 1000) {
            waterState = false;
            digitalWrite(waterRelayPin, LOW);
            String message;
            if (soilMoistureValue >= 1000) {
                message = "Smart Plant System: Watering stopped. Reason: Sensor disconnected or not in soil.";
            } else if (soilMoistureValue <= 600) {
                message = "Smart Plant System: Watering stopped. Soil is now humid/wet.";
            } else {
                message = "Smart Plant System: Watering cycle completed.";
            }
            Serial.println("Water pump OFF: " + moistureStatus);
            queueSMS(message.c_str());
        }
    } else {
        // Only start watering if soil is dry or triggered by schedule (checkSchedules handles scheduling)
        if (soilMoistureValue > 600 && soilMoistureValue < 1000) {  // DRY condition only
            waterState = true;
            previousWaterMillis = currentMillis;
            digitalWrite(waterRelayPin, HIGH);
            Serial.println("Water pump ON: " + moistureStatus);
            String smsMessage = "Smart Plant System: Started watering. Soil is dry (" + String(soilMoistureValue) + " reading)";
            queueSMS(smsMessage.c_str());
        }
    }

    // Fertilizer timing control
    if (fertilizerState) {
        if (currentMillis - previousFertilizerMillis >= fertilizerOnDuration) {
            fertilizerState = false;
            digitalWrite(fertilizerRelayPin, LOW);
            String completionMsg = "Smart Plant System: Fertilizer cycle completed.";
            Serial.println("✅ " + completionMsg);
            queueSMS(completionMsg.c_str());
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
    delay(500);
}