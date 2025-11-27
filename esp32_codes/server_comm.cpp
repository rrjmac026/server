/*
 * Server Communication - Handles all server API communications
 */

#ifndef SERVER_COMM_H
#define SERVER_COMM_H
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include "config.h"
#include "sensor_manager.h"

extern SystemState systemState;
extern GSMStatus gsmStatus;

void sendDataToServer(const SystemState& state) {
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

    StaticJsonDocument<200> doc;
    doc["plantId"] = FIXED_PLANT_ID;
    doc["moisture"] = state.moisturePercent;
    doc["temperature"] = state.temperature;
    doc["humidity"] = state.humidity;
    doc["waterState"] = state.waterState;
    doc["fertilizerState"] = state.fertilizerState;
    doc["timestamp"] = timestamp;
    doc["isConnected"] = true;

    String jsonString;
    serializeJson(doc, jsonString);

    WiFiClientSecure *client = new WiFiClientSecure;
    if(client) {
        client->setInsecure();
        HTTPClient https;
        https.begin(*client, String(SERVER_URL) + SENSOR_ENDPOINT);
        https.addHeader("Content-Type", "application/json");
        
        int retries = 0;
        int httpResponseCode;
        bool success = false;
        
        while (retries < 3 && !success) {
            httpResponseCode = https.POST(jsonString);
            
            if (httpResponseCode > 0) {
                String response = https.getString();
                Serial.println("✅ Server response code: " + String(httpResponseCode));
                success = true;
            } else {
                retries++;
                if (retries < 3) {
                    Serial.println("🔄 Retrying... Attempt " + String(retries + 1));
                    delay(1000);
                }
            }
        }

        https.end();
        delete client;

        // Try local server if remote failed
        if (!success) {
            HTTPClient http;
            http.begin(String(SERVER_URL_LOCAL) + SENSOR_ENDPOINT);
            http.addHeader("Content-Type", "application/json");
            
            httpResponseCode = http.POST(jsonString);
            if (httpResponseCode > 0) {
                Serial.println("✅ Local server response");
            }
            http.end();
        }
    }
}

void sendEventData(const char* type, const char* action, const char* details) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("❌ WiFi not connected - Event not sent");
        return;
    }

    StaticJsonDocument<512> doc;
    doc["plantId"] = FIXED_PLANT_ID;
    doc["type"] = type;
    doc["action"] = action;
    doc["status"] = "success";
    
    if (details) {
        doc["details"] = details;
    }

    JsonObject sensorData = doc.createNestedObject("sensorData");
    sensorData["moisture"] = systemState.moisturePercent;
    sensorData["temperature"] = systemState.temperature;
    sensorData["humidity"] = systemState.humidity;
    sensorData["waterState"] = systemState.waterState;
    sensorData["fertilizerState"] = systemState.fertilizerState;
    sensorData["moistureStatus"] = systemState.moistureStatus;
    sensorData["isConnected"] = WiFi.status() == WL_CONNECTED;
    sensorData["signalStrength"] = WiFi.RSSI();
    sensorData["gsmStatus"] = gsmStatus == GSM_READY ? "ready" : "error";

    JsonObject systemData = doc.createNestedObject("systemData");
    systemData["freeHeap"] = ESP.getFreeHeap();
    systemData["uptime"] = millis() / 1000;
    systemData["wifiSignal"] = WiFi.RSSI();

    String jsonString;
    serializeJson(doc, jsonString);

    bool success = false;
    
    // Try remote server
    WiFiClientSecure *client = new WiFiClientSecure;
    if(client) {
        client->setInsecure();
        HTTPClient https;
        https.begin(*client, String(SERVER_URL) + AUDIT_LOGS_ENDPOINT);
        https.addHeader("Content-Type", "application/json");
        
        int httpCode = https.POST(jsonString);
        success = (httpCode > 0 && httpCode < 400);
        https.end();
        delete client;
    }

    // Try local server if remote failed
    if (!success) {
        HTTPClient http;
        http.begin(String(SERVER_URL_LOCAL) + AUDIT_LOGS_ENDPOINT);
        http.addHeader("Content-Type", "application/json");
        
        int httpCode = http.POST(jsonString);
        success = (httpCode > 0 && httpCode < 400);
        http.end();
    }

    Serial.println(success ? "✅ Event logged successfully" : "❌ Failed to log event");
}

#endif // SERVER_COMM_H