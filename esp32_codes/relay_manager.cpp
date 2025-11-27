/*
 * Relay Manager - Handles water pump and fertilizer relay control
 */

#ifndef RELAY_MANAGER_H
#define RELAY_MANAGER_H

#include "config.h"
#include "schedule_manager.h"
#include "server_comm.h"
#include "gsm_manager.h"

extern SystemState systemState;
extern std::vector<Schedule> schedules;

void initRelays() {
    pinMode(WATER_RELAY_PIN, OUTPUT);
    pinMode(FERTILIZER_RELAY_PIN, OUTPUT);
    digitalWrite(WATER_RELAY_PIN, LOW);
    digitalWrite(FERTILIZER_RELAY_PIN, LOW);
    Serial.println("✅ Relays initialized");
}

void startWatering(const char* reason) {
    systemState.waterState = true;
    systemState.previousWaterMillis = millis();
    digitalWrite(WATER_RELAY_PIN, HIGH);
    
    Serial.println("\n=== 💧 Water Pump Started ===");
    Serial.println("Reason: " + String(reason));
    
    sendEventData("watering", "started", reason);
    
    String smsMessage = "Smart Plant System: Started watering. " + String(reason);
    queueSMS(smsMessage.c_str());
}

void stopWatering(const char* reason) {
    systemState.waterState = false;
    digitalWrite(WATER_RELAY_PIN, LOW);
    
    unsigned long duration = (millis() - systemState.previousWaterMillis) / 1000;
    
    Serial.println("\n=== 💧 Water Pump Stopped ===");
    Serial.println("Reason: " + String(reason));
    Serial.println("Final Moisture: " + String(systemState.moisturePercent) + "%");
    Serial.println("Total Duration: " + String(duration) + " seconds");
    Serial.println("==========================");
    
    sendEventData("watering", "stopped", reason);
    queueSMS(("Smart Plant System: Watering stopped. " + String(reason)).c_str());
}

void startFertilizing(const char* reason) {
    systemState.fertilizerState = true;
    systemState.previousFertilizerMillis = millis();
    digitalWrite(FERTILIZER_RELAY_PIN, HIGH);
    
    Serial.println("\n=== 🌱 Fertilizer Started ===");
    Serial.println("Reason: " + String(reason));
    
    sendEventData("fertilizer", "started", reason);
    
    String smsMessage = "Smart Plant System: Started fertilizing. " + String(reason);
    queueSMS(smsMessage.c_str());
}

void stopFertilizing(const char* reason) {
    systemState.fertilizerState = false;
    digitalWrite(FERTILIZER_RELAY_PIN, LOW);
    
    Serial.println("\n=== 🌱 Fertilizer Stopped ===");
    Serial.println("Reason: " + String(reason));
    
    sendEventData("fertilizer", "completed", reason);
    
    String completionMsg = "Smart Plant System: Fertilizer cycle completed.";
    queueSMS(completionMsg.c_str());
}

void manageWaterPump(unsigned long currentMillis) {
    if (systemState.waterState) {
        // Get current watering duration from schedule
        unsigned long waterDuration = 30000; // Default 30 seconds
        for (const auto& s : schedules) {
            if (s.type == "watering" && s.enabled) {
                waterDuration = s.duration * 60000;
                break;
            }
        }
        
        if (currentMillis - systemState.previousWaterMillis >= waterDuration) {
            stopWatering("⏱️ Scheduled duration completed");
        }
    } else {
        // Check if automatic watering should start
        Schedule* activeSchedule = nullptr;
        for (auto& schedule : schedules) {
            if (schedule.type == "watering" && schedule.enabled) {
                activeSchedule = &schedule;
                break;
            }
        }
        
        int currentThreshold = (activeSchedule) ? activeSchedule->moistureThreshold : 60;
        bool isAutoMode = (activeSchedule) ? (activeSchedule->moistureMode == "auto") : false;
        
        if (isAutoMode && 
            systemState.moisturePercent > currentThreshold && 
            systemState.moisturePercent < DISCONNECTED_THRESHOLD) {
            
            String details = "Moisture: " + String(systemState.moisturePercent) + 
                           "% (Threshold: " + String(currentThreshold) + "%)";
            startWatering(details.c_str());
        }
    }
}

void manageFertilizer(unsigned long currentMillis) {
    if (systemState.fertilizerState) {
        // Get fertilizer duration from schedule
        unsigned long fertilizerDuration = 50000; // Default 50 seconds
        for (const auto& s : schedules) {
            if (s.type == "fertilizing" && s.enabled) {
                fertilizerDuration = s.duration * 60000;
                break;
            }
        }
        
        if (currentMillis - systemState.previousFertilizerMillis >= fertilizerDuration) {
            stopFertilizing("Duration completed");
        }
    }
}

#endif // RELAY_MANAGER_H