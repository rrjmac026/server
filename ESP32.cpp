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
const char* serverUrl = "http://192.168.1.8:3000/api/sensor-data";  // Local testing
const char* serverUrl2 = "https://server-5527.onrender.com/api/sensor-data";  // Production
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

// Add these functions near the top after your #includes but before setup()

// Time sync function
bool syncTime() {
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    struct tm timeinfo;
    int retry = 0;
    while(!getLocalTime(&timeinfo) && retry < 5) {
        Serial.println("⏳ Waiting for time sync...");
        delay(1000);
        retry++;
    }
    return retry < 5;
}

// Moisture status function
String getMoistureStatus(int moisture) {
    if (moisture >= disconnectedThreshold) return "DISCONNECTED";
    if (moisture > dryThreshold) return "DRY";
    if (moisture > humidThreshold) return "HUMID";
    return "WET";
}

// Schedule fetching function
void fetchSchedules() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected");
        return;
    }

    HTTPClient http;
    String url = String(serverUrl) + "/api/schedules/" + String(FIXED_PLANT_ID) + "?enabled=true";
    
    http.begin(url);
    int httpCode = http.GET();
    
    if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        // Parse JSON and update schedules vector
        DynamicJsonDocument doc(2048);
        deserializeJson(doc, payload);
        
        schedules.clear();
        JsonArray schedulesArray = doc["schedules"];
        
        for (JsonObject scheduleObj : schedulesArray) {
            Schedule schedule;
            schedule.id = scheduleObj["id"] | 0;
            schedule.type = scheduleObj["type"].as<String>();
            schedule.time = scheduleObj["time"].as<String>();
            schedule.duration = scheduleObj["duration"] | 0;
            schedule.enabled = scheduleObj["enabled"] | true;
            schedules.push_back(schedule);
        }
        
        Serial.printf("✅ Fetched %d schedules\n", schedules.size());
    } else {
        Serial.printf("❌ Failed to fetch schedules: %d\n", httpCode);
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
            sim900.print("AT+CMGS=\"");
            sim900.print(phoneNumbers[i]);
            sim900.println("\"");
            delay(100);  // Short delay needed for GSM module

            sim900.print(sms.message);
            sim900.write(26);
            
            String response = readGSMResponse();
            success = (response.indexOf("OK") >= 0 && response.indexOf("+CMGS") >= 0);
        }

        if (success || sms.retries >= MAX_SMS_RETRIES) {
            smsQueue.pop();
        } else {
            sms.retries++;
            sms.nextAttempt = millis() + SMS_RETRY_INTERVAL;
        }
    }
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

// Update constants after other constants
const unsigned long SENSOR_READ_INTERVAL = 30000;  // 30 seconds
const unsigned long DATA_SEND_INTERVAL = 30000;    // 30 seconds
unsigned long lastSensorReadTime = 0;
unsigned long lastDataSendTime = 0;

// Add these variables for data averaging
float temperatureSum = 0;
float humiditySum = 0;
int moistureSum = 0;
int readingCount = 0;

// Add this function before loop()
void resetAggregatedData() {
    temperatureSum = 0;
    humiditySum = 0;
    moistureSum = 0;
    readingCount = 0;
}

// Add these constants near other timing constants
const unsigned long MIN_SEND_INTERVAL = 30000;  // Enforce minimum 30s between sends
unsigned long lastSuccessfulSendTime = 0;  // Track last successful send

// Add this function before loop()
String getFormattedTime() {
    struct tm timeinfo;
    if(!getLocalTime(&timeinfo)) {
        return "Time not set";
    }
    char timeStr[30];
    strftime(timeStr, sizeof(timeStr), "%Y-%m-%d %H:%M:%S", &timeinfo);
    return String(timeStr);
}

// Modify sendDataToServer to try both URLs and improve error handling
bool sendDataToServer(int moisture, bool pumpState, float temperature, float humidity) {
    if (millis() - lastSuccessfulSendTime < MIN_SEND_INTERVAL) {
        Serial.println("⏳ Skipping send - too soon since last send");
        return false;
    }

    // Basic data structure - server will handle the rest
    StaticJsonDocument<300> doc;
    doc["plantId"] = FIXED_PLANT_ID;
    doc["moisture"] = moisture;
    doc["pumpState"] = pumpState;
    doc["temperature"] = temperature;
    doc["humidity"] = humidity;

    String jsonString;
    serializeJson(doc, jsonString);

    Serial.println("📤 Sending data to server");
    Serial.println(jsonString);

    HTTPClient http;
    bool success = false;

    // Try local server first, then remote
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");
    int httpResponseCode = http.POST(jsonString);
    
    if (httpResponseCode != 200) {
        http.end();
        // Try backup server
        http.begin(serverUrl2);
        http.addHeader("Content-Type", "application/json");
        httpResponseCode = http.POST(jsonString);
    }

    success = (httpResponseCode == 200);
    if (success) {
        lastSuccessfulSendTime = millis();
        Serial.println("✅ Data sent successfully");
    } else {
        Serial.println("❌ Failed to send data: " + String(httpResponseCode));
    }

    http.end();
    return success;
}

// Modify the loop() function
void loop() {
    unsigned long currentMillis = millis();
    float temperature = 0;
    float humidity = 0;
    
    // Pat the watchdog
    esp_task_wdt_reset();
    
    static bool readyToSend = false;
    
    // Take sensor readings every 30 seconds
    if (currentMillis - lastSensorReadTime >= SENSOR_READ_INTERVAL) {
        // Read DHT sensor
        float humidity = dht.readHumidity();
        float temperature = dht.readTemperature();
        int soilMoistureValue = analogRead(soilMoisturePin);

        if (!isnan(humidity) && !isnan(temperature)) {
            temperatureSum += temperature;
            humiditySum += humidity;
            moistureSum += soilMoistureValue;
            readingCount++;
            readyToSend = true;  // Mark that we have new data to send

            Serial.printf("📊 Reading #%d - T: %.1f°C, H: %.1f%%, M: %d\n", 
                        readingCount, temperature, humidity, soilMoistureValue);
        }

        lastSensorReadTime = currentMillis;
    }

    // Only attempt to send if we have readings and enough time has passed
    if (readyToSend && currentMillis - lastDataSendTime >= DATA_SEND_INTERVAL && readingCount > 0) {
        float avgTemperature = temperatureSum / readingCount;
        float avgHumidity = humiditySum / readingCount;
        int avgMoisture = moistureSum / readingCount;

        if (sendDataToServer(avgMoisture, waterState, avgTemperature, avgHumidity)) {
            resetAggregatedData();
            lastDataSendTime = currentMillis;
            readyToSend = false;
        }
    }

    int soilMoistureValue = analogRead(soilMoisturePin);
    
    updateMoistureHistory(soilMoistureValue);
    rapidDrying = detectRapidDrying();

    // Get moisture status first
    String moistureStatus = getMoistureStatus(soilMoistureValue);

    // ✅ Updated moisture status output (no percentage)
    Serial.print("🌱 Soil Moisture Value: ");
    Serial.print(soilMoistureValue);
    Serial.print(" → Status: ");
    Serial.println(getMoistureStatus(soilMoistureValue));


    // Send data to server
    sendDataToServer(soilMoistureValue, waterState, temperature, humidity);

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