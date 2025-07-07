#include <WiFi.h>
#include <time.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <HardwareSerial.h>
#include <ArduinoJson.h>
#include <queue>
#include <map>

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
const char* ssid = "B880-E80A";
const char* password = "EDD9C205";

// Server Details
const char* serverUrl = "http://192.168.1.8:3000/api/sensor-data";
const char* serverUrl2 = "https://server-5527.onrender.com/api/sensor-data";
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

String readGSMResponse() {
    String response = "";
    unsigned long startTime = millis();
    while (millis() - startTime < 5000) {
        while (sim900.available()) {
            char c = sim900.read();
            response += c;
        }
    }
    return response;
}

void initGSM() {
    sim900.begin(9600, SERIAL_8N1, RXD2, TXD2);
    delay(3000);

    Serial.println("Initializing SIM900...");
    sim900.println("AT");
    delay(1000);
    String response = readGSMResponse();
    Serial.println("AT Response: " + response);

    // Check network
    sim900.println("AT+CREG?");
    delay(1000);
    response = readGSMResponse();
    Serial.println("Network Registration: " + response);

    sim900.println("AT+CMGF=1");
    delay(1000);
    readGSMResponse();
}

void sendSMS(const char* message) {
    for(int i = 0; i < numPhones; i++) {
        Serial.println("\n📨 Sending SMS...");
        
        sim900.print("AT+CMGS=\"");
        sim900.print(phoneNumbers[i]);
        sim900.println("\"");
        delay(1000);

        sim900.print(message);
        sim900.write(26);  // Ctrl+Z to send
        delay(5000);

        String response = readGSMResponse();
        Serial.println("Response: " + response);

        if (response.indexOf("OK") >= 0 && response.indexOf("+CMGS") >= 0) {
            Serial.println("✅ SMS sent successfully");
        } else {
            Serial.println("❌ SMS failed");
        }
    }
}

void sendDataToServer(int moistureValue, bool pumpState, float temperature, float humidity) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi disconnected, reconnecting...");
        WiFi.reconnect();
        return;
    }

    HTTPClient http1, http2;
    http1.setTimeout(10000);
    http2.setTimeout(10000);

    String jsonData = "{\"plantId\":\"" + String(FIXED_PLANT_ID) + 
                     "\",\"moisture\":" + String(moistureValue) + 
                     ",\"pumpState\":" + String(pumpState ? "true" : "false") + 
                     ",\"temperature\":" + String(temperature) + 
                     ",\"humidity\":" + String(humidity) + 
                     ",\"moistureStatus\":\"" + getMoistureStatus(moistureValue) + "\"}";

    bool server1Success = false;
    bool server2Success = false;

    // Send to first server
    if (http1.begin(serverUrl)) {
        http1.addHeader("Content-Type", "application/json");
        int httpCode1 = http1.POST(jsonData);
        server1Success = (httpCode1 == 200 || httpCode1 == 201);
        Serial.printf("Server 1 Response: %d\n", httpCode1);
        http1.end();
    }

    // Send to second server
    if (http2.begin(serverUrl2)) {
        http2.addHeader("Content-Type", "application/json");
        int httpCode2 = http2.POST(jsonData);
        server2Success = (httpCode2 == 200 || httpCode2 == 201);
        Serial.printf("Server 2 Response: %d\n", httpCode2);
        http2.end();
    }

    if (server1Success || server2Success) {
        Serial.println("✅ Data sent to at least one server successfully");
    } else {
        Serial.println("❌ Failed to send data to all servers");
    }
}

String getMoistureStatus(int value) {
    if (value >= 1023) {
        return "NO DATA: Sensor reading at maximum value";
    } else if (value >= 1000) {
        return "SENSOR ERROR: Not in soil or disconnected";
    } else if (value > 600 && value < 1000) {
        return "DRY SOIL: Watering needed";
    } else if (value >= 370 && value <= 600) {
        return "HUMID SOIL: Good condition";
    } else {
        return "IN WATER: Sensor in water or very wet soil";
    }
}

bool syncTime() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("Cannot sync time - WiFi not connected");
        return false;
    }
    
    Serial.println("Syncing time...");
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    
    int retries = 0;
    const int maxRetries = 5;
    struct tm timeinfo;
    
    while(!getLocalTime(&timeinfo) && retries < maxRetries) {
        Serial.println("Failed to obtain time, retrying...");
        delay(1000);
        retries++;
    }
    
    if (retries < maxRetries) {
        char timeStringBuff[50];
        strftime(timeStringBuff, sizeof(timeStringBuff), "%A, %B %d %Y %H:%M:%S", &timeinfo);
        Serial.println("Time synchronized: " + String(timeStringBuff));
        return true;
    }
    
    Serial.println("Failed to sync time after " + String(maxRetries) + " attempts");
    return false;
}

void fetchSchedules() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi disconnected");
        return;
    }

    HTTPClient http;
    String url = String(serverUrl) + "/schedules/" + String(FIXED_PLANT_ID);
    
    if (http.begin(url)) {
        int httpCode = http.GET();
        
        if (httpCode == HTTP_CODE_OK) {
            String payload = http.getString();
            
            // Parse JSON response
            StaticJsonDocument<1024> doc;
            DeserializationError error = deserializeJson(doc, payload);
            
            if (!error) {
                // Clear existing schedules
                schedules.clear();
                
                // Add new schedules
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
  initGSM();
  Serial.println("GSM Module Ready");

  // Initialize watchdog
  esp_task_wdt_init(30, true); // 30 second timeout
  esp_task_wdt_add(NULL);
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
                waterState = true;
                previousWaterMillis = millis();
                digitalWrite(waterRelayPin, HIGH);
                String message = "Smart Plant System: Starting scheduled watering";
                Serial.println(message);
                queueSMS(message.c_str());
                triggeredSchedules[schedule.id] = true;  // Mark as triggered
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
        float newHumidity = dht.readHumidity();
        float newTemperature = dht.readTemperature();
        
        if (!isnan(newHumidity) && !isnan(newTemperature)) {
            humidity = newHumidity;
            temperature = newTemperature;
            lastDHTReadTime = currentMillis;
        }
    }

    int soilMoistureValue = analogRead(soilMoisturePin);
    
    updateMoistureHistory(soilMoistureValue);
    rapidDrying = detectRapidDrying();

    // Get moisture status first
    String moistureStatus = getMoistureStatus(soilMoistureValue);

    // Updated moisture status output (remove percentage)
    Serial.print("Soil Moisture Value: ");
    Serial.print(soilMoistureValue);
    Serial.print(" - Status: ");
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

    // Process SMS queue
    processSMSQueue();

    // Schedule polling with proper interval checking
    if (currentMillis - lastPollTime >= POLLING_INTERVAL) {
        fetchSchedules();
        lastPollTime = currentMillis;
    }
    
    checkSchedules();
    delay(500);
}
