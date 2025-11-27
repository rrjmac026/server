/*
 * Sensor Manager - Handles all sensor reading and processing
 */

#ifndef SENSOR_MANAGER_H
#define SENSOR_MANAGER_H

#include <DHT.h>
#include "config.h"

// Global sensor object
DHT dht(DHT_PIN, DHT_TYPE);

// Moisture history for AI detection
int moistureHistory[HISTORY_SIZE];
int historyIndex = 0;
bool rapidDrying = false;

void initSensors() {
    analogReadResolution(10); // Use 0–1023 range
    dht.begin();
    
    // Initialize moisture history
    for (int i = 0; i < HISTORY_SIZE; i++) {
        moistureHistory[i] = 0;
    }
    
    Serial.println("✅ Sensors initialized");
}

int convertToMoisturePercent(int rawValue) {
    rawValue = constrain(rawValue, 0, 1023);
    return map(rawValue, 0, 1023, 100, 0);
}

String getMoistureStatus(int moisturePercent) {
    if (moisturePercent >= 95) return "SENSOR ERROR";
    if (moisturePercent <= 35) return "DRY";
    if (moisturePercent <= 65) return "HUMID";
    if (moisturePercent > 65) return "WET";
    return "SENSOR ERROR";
}

void updateMoistureHistory(int currentValue) {
    moistureHistory[historyIndex] = currentValue;
    historyIndex = (historyIndex + 1) % HISTORY_SIZE;
}

bool detectRapidDrying() {
    if (historyIndex < HISTORY_SIZE) return false;
    
    int current = (historyIndex - 1 + HISTORY_SIZE) % HISTORY_SIZE;
    int prev = (historyIndex - 2 + HISTORY_SIZE) % HISTORY_SIZE;
    
    return (moistureHistory[current] - moistureHistory[prev] > 50);
}

void readSensorData(SystemState& state) {
    state.soilMoistureValue = analogRead(SOIL_MOISTURE_PIN);
    state.moisturePercent = convertToMoisturePercent(state.soilMoistureValue);
    state.humidity = dht.readHumidity();
    state.temperature = dht.readTemperature();
    state.moistureStatus = getMoistureStatus(state.moisturePercent);
    
    updateMoistureHistory(state.moisturePercent);
    rapidDrying = detectRapidDrying();
}

void printSensorReadings(const SystemState& state) {
    char msgBuffer[100];
    snprintf(msgBuffer, sizeof(msgBuffer), 
             "🌡️ Temperature: %.1f °C | 💧 Humidity: %.1f %%", 
             state.temperature, state.humidity);
    Serial.println(msgBuffer);
    
    Serial.print("🌱 Soil Moisture: ");
    Serial.print(state.moisturePercent);
    Serial.print("% → Status: ");
    Serial.println(state.moistureStatus);
    Serial.println("===========================");
}

#endif // SENSOR_MANAGER_H