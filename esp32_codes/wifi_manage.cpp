/*
 * WiFi Manager - Handles WiFi connection and reconnection
 */

#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <WiFi.h>
#include "config.h"

bool initWiFi() {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
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
        return true;
    } else {
        Serial.println("\n❌ WiFi Connection Failed!");
        return false;
    }
}

void checkWiFiConnection() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("📡 Reconnecting WiFi...");
        WiFi.reconnect();
        delay(5000);
    }
}

#endif // WIFI_MANAGER_H