/*
 * Schedule Manager - Handles schedule fetching and execution
 */

#ifndef SCHEDULE_MANAGER_H
#define SCHEDULE_MANAGER_H
#include <vector>
#include <map>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "config.h"

// Global schedule storage
std::vector<Schedule> schedules;
std::map<int, bool> triggeredSchedules;

// Forward declarations
void startWatering(const char* reason);
void startFertilizing(const char* reason);

bool isFertilizingScheduled(const Schedule& schedule, int currentDay, String currentTime) {
    if (schedule.type == "fertilizing") {
        for (int day : schedule.calendarDays) {
            if (day == currentDay && schedule.time == currentTime) {
                return true;
            }
        }
    }
    return false;
}

void fetchSchedulesFromServer() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected");
        return;
    }

    Serial.println("\n📅 Fetching schedules from server...");
    
    WiFiClientSecure *client = new WiFiClientSecure;
    if(!client) {
        Serial.println("❌ Failed to create HTTPS client");
        return;
    }

    client->setInsecure();
    HTTPClient https;
    
    String url = String(SERVER_URL) + SCHEDULES_ENDPOINT + "/" + FIXED_PLANT_ID + "?enabled=true";
    https.begin(*client, url);

    int httpCode = https.GET();
    bool success = false;

    if (httpCode > 0) {
        String payload = https.getString();
        Serial.println("✅ Got response from server");
        
        DynamicJsonDocument doc(2048);
        DeserializationError error = deserializeJson(doc, payload);
        
        if (!error) {
            success = true;
            schedules.clear();
            
            if (doc.containsKey("schedules") && doc["schedules"].is<JsonArray>()) {
                JsonArray schedulesArray = doc["schedules"];
                
                for (JsonObject scheduleObj : schedulesArray) {
                    Schedule schedule;
                    if (scheduleObj.containsKey("_id")) 
                        schedule.id = scheduleObj["_id"].as<String>();
                    if (scheduleObj.containsKey("type")) 
                        schedule.type = scheduleObj["type"].as<String>();
                    if (scheduleObj.containsKey("time")) 
                        schedule.time = scheduleObj["time"].as<String>();
                    if (scheduleObj.containsKey("duration")) 
                        schedule.duration = scheduleObj["duration"].as<int>();
                    if (scheduleObj.containsKey("enabled")) 
                        schedule.enabled = scheduleObj["enabled"].as<bool>();
                    
                    if (scheduleObj.containsKey("settings")) {
                        JsonObject settings = scheduleObj["settings"];
                        schedule.moistureThreshold = settings["moistureThreshold"] | 60;
                        schedule.moistureMode = settings["moistureMode"] | "manual";
                    }
                    
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
                }
            }
        } else {
            Serial.print("❌ JSON parse error: ");
            Serial.println(error.c_str());
        }
    }
    
    https.end();
    delete client;

    if (success) {
        Serial.printf("✅ Successfully loaded %d schedules\n", schedules.size());
    } else {
        Serial.println("❌ Failed to load schedules");
    }
}

void checkAndExecuteSchedules() {
    struct tm timeinfo;
    if(!getLocalTime(&timeinfo)) {
        return;
    }
    
    // Reset triggers if minute has changed
    static int lastMinute = -1;
    if (timeinfo.tm_min != lastMinute) {
        triggeredSchedules.clear();
        lastMinute = timeinfo.tm_min;
    }
    
    char currentTime[6];
    char currentDayName[10];
    strftime(currentTime, sizeof(currentTime), "%H:%M", &timeinfo);
    strftime(currentDayName, sizeof(currentDayName), "%A", &timeinfo);
    
    String dayName = String(currentDayName);
    String timeStr = String(currentTime);
    
    for (const auto& schedule : schedules) {
        if (!schedule.enabled || triggeredSchedules[schedule.id.toInt()]) {
            continue;
        }
        
        bool shouldRun = false;
        
        if (schedule.type == "fertilizing") {
            shouldRun = isFertilizingScheduled(schedule, timeinfo.tm_mday, timeStr);
        }
        else if (schedule.type == "watering") {
            if (schedule.time == timeStr) {
                for (const String& day : schedule.days) {
                    if (day.equalsIgnoreCase(dayName)) {
                        shouldRun = true;
                        break;
                    }
                }
            }
        }

        if (shouldRun) {
            triggeredSchedules[schedule.id.toInt()] = true;
            
            if (schedule.type == "watering") {
                String details = "Scheduled watering for " + String(schedule.duration) + " minutes";
                startWatering(details.c_str());
            }
            else if (schedule.type == "fertilizing") {
                String details = "Scheduled fertilizing for " + String(schedule.duration) + " minutes";
                startFertilizing(details.c_str());
            }
        }
    }
}

#endif // SCHEDULE_MANAGER_H