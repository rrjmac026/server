/*
 * Smart Plant Monitoring System - Main Program
 * Modularized version with separate configuration and modules
 */

#include "config.h"
#include "wifi_manager.h"
#include "sensor_manager.h"
#include "relay_manager.h"
#include "gsm_manager.h"
#include "schedule_manager.h"
#include "server_comm.h"
#include "time_manager.h"

// Global state variables
SystemState systemState;
unsigned long lastPollTime = 0;
unsigned long lastHeapCheck = 0;
unsigned long lastDiagnosticsLog = 0;

void setup() {
    // Initialize serial communication
    esp_log_level_set("*", ESP_LOG_NONE);
    delay(100);
    Serial.begin(115200);
    Serial.println();
    Serial.println("🌱 Smart Plant System Starting...");

    // Initialize WiFi
    if (!initWiFi()) {
        Serial.println("❌ WiFi initialization failed - restarting");
        ESP.restart();
    }

    // Initialize time synchronization
    if (!initTimeSync()) {
        Serial.println("❌ Time sync failed - restarting");
        ESP.restart();
    }

    // Initialize sensors
    initSensors();

    // Initialize relays
    initRelays();

    // Initialize GSM module
    initGSMModule();

    // Initialize watchdog if enabled
    if (USE_WATCHDOG) {
        esp_task_wdt_config_t wdt_config = {
            .timeout_ms = 60000,
            .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
            .trigger_panic = true
        };
        esp_task_wdt_init(&wdt_config);
        esp_task_wdt_add(NULL);
    }

    Serial.println("✅ System initialization complete");
}

void loop() {
    unsigned long currentMillis = millis();

    // Check WiFi connection
    checkWiFiConnection();

    // Pause watchdog during operations
    pauseWatchdog();

    // Update current date
    updateCurrentDate();

    // Read sensors and send data
    if (shouldReadSensors(currentMillis)) {
        readAndProcessSensors(currentMillis);
    }

    // Check and execute schedules
    if (shouldPollSchedules(currentMillis)) {
        fetchSchedulesFromServer();
        lastPollTime = currentMillis;
    }
    checkAndExecuteSchedules();

    // Process SMS queue
    checkGSMStatusAndProcess();

    // System monitoring
    if (currentMillis - lastHeapCheck >= 30000) {
        Serial.printf("Free heap: %d bytes\n", ESP.getFreeHeap());
        lastHeapCheck = currentMillis;
    }

    logSystemDiagnosticsIfNeeded();

    // Resume watchdog
    resumeWatchdog();

    delay(100);
}

// Helper function implementations
void updateCurrentDate() {
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
        char dateStr[3];
        strftime(dateStr, sizeof(dateStr), "%d", &timeinfo);
        systemState.currentDate = String(dateStr);
    }
}

bool shouldReadSensors(unsigned long currentMillis) {
    return (currentMillis - systemState.lastReadTime >= READ_INTERVAL);
}

bool shouldPollSchedules(unsigned long currentMillis) {
    return (currentMillis - lastPollTime >= POLLING_INTERVAL);
}

void logSystemDiagnosticsIfNeeded() {
    if (millis() - lastDiagnosticsLog >= 3600000) {
        String details = "Free heap: " + String(ESP.getFreeHeap()) + 
                        ", Uptime: " + String(millis() / 1000) + "s" +
                        ", WiFi: " + String(WiFi.RSSI()) + "dBm";
        sendEventData("system", "diagnostics", details.c_str());
        lastDiagnosticsLog = millis();
    }
}