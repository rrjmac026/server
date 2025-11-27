/*
 * Configuration Header - All constants and pin definitions
 */

#ifndef CONFIG_H
#define CONFIG_H
#include <Arduino.h>
#include <vector>

// Pin Definitions
const int WATER_RELAY_PIN = 26;
const int FERTILIZER_RELAY_PIN = 23;
const int SOIL_MOISTURE_PIN = 34;
const int DHT_PIN = 15;

// DHT Sensor Type
#define DHT_TYPE DHT11

// Moisture Thresholds (based on 0–1023 scale)
const int DRY_THRESHOLD = 60;
const int HUMID_THRESHOLD = 35;
const int DISCONNECTED_THRESHOLD = 95;

// Timing Intervals (milliseconds)
const unsigned long READ_INTERVAL = 25000;        // Read sensors every 25 seconds
const unsigned long SEND_INTERVAL = 25000;        // Send data every 25 seconds
const unsigned long POLLING_INTERVAL = 30000;     // Poll schedules every 30 seconds
const unsigned long STATUS_PRINT_INTERVAL = 5000; // Print status every 5 seconds
const unsigned long DHT_READ_INTERVAL = 2000;     // Read DHT every 2 seconds
const unsigned long FERTILIZER_OFF_DURATION = 30000; // 30 seconds

// Network Configuration
const char* WIFI_SSID = "GlobeAtHome_efd40_2.4";
const char* WIFI_PASSWORD = "pzlblst'8090";

// Server Configuration
const char* SERVER_URL = "https://server-ydsa.onrender.com/api";
const char* SERVER_URL_LOCAL = "http://192.168.1.8:3000/api";
const char* SENSOR_ENDPOINT = "/sensor-data";
const char* SCHEDULES_ENDPOINT = "/schedules";
const char* AUDIT_LOGS_ENDPOINT = "/audit-logs";
const char* FIXED_PLANT_ID = "C8dA5OfZEC1EGAhkdAB4";

// NTP Configuration
const char* NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET_SEC = 28800;      // UTC+8 (Philippines)
const int DAYLIGHT_OFFSET_SEC = 0;

// GSM Configuration
#define RXD2 16  // SIM900 TX → ESP32 RX2
#define TXD2 17  // SIM900 RX → ESP32 TX2

// Phone Numbers for Notifications
const char* PHONE_NUMBERS[] = {
    "+639940090476",
    "+639554397724"
};
const int NUM_PHONES = 2;

// SMS Configuration
const int MAX_SMS_RETRIES = 3;
const unsigned long SMS_RETRY_INTERVAL = 10000;  // 10 seconds
const unsigned long GSM_RETRY_INTERVAL = 60000;  // 1 minute

// AI & History Configuration
const int HISTORY_SIZE = 10;

// Watchdog Configuration
const bool USE_WATCHDOG = true;

// System State Structure
struct SystemState {
    float humidity = 0;
    float temperature = 0;
    int soilMoistureValue = 0;
    int moisturePercent = 0;
    String moistureStatus;
    String currentDate;
    bool isScheduledDate = false;
    bool waterState = false;
    bool fertilizerState = false;
    unsigned long lastReadTime = 0;
    unsigned long lastSendTime = 0;
    unsigned long previousWaterMillis = 0;
    unsigned long previousFertilizerMillis = 0;
    int currentMinute = -1;
};

// Schedule Structure
struct Schedule {
    String id;
    String type;
    String time;
    int duration;
    bool enabled;
    std::vector<String> days;
    int moistureThreshold;
    String moistureMode;
    std::vector<int> calendarDays;
};

// GSM Status Enum
enum GSMStatus {
    GSM_ERROR,
    GSM_READY,
    GSM_WAITING
};

// SMS Message Structure
struct SMSMessage {
    String message;
    int retries;
    unsigned long nextAttempt;
};

#endif // CONFIG_H