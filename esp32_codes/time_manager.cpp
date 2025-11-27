/*
 * Time Manager - Handles NTP time synchronization
 */

#ifndef TIME_MANAGER_H
#define TIME_MANAGER_H

#include <time.h>
#include "config.h"

bool syncTime() {
    int retries = 0;
    const int maxRetries = 5;
    
    while (retries < maxRetries) {
        configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
        
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

bool initTimeSync() {
    if (syncTime()) {
        Serial.println("✅ Time synchronized successfully");
        return true;
    } else {
        Serial.println("❌ Time sync failed");
        return false;
    }
}

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

#endif // TIME_MANAGER_H