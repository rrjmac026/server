/*
 * GSM Manager - Handles SIM900 GSM module and SMS functionality
 */

#ifndef GSM_MANAGER_H
#define GSM_MANAGER_H

#include <HardwareSerial.h>
#include <queue>
#include "config.h"

// GSM module serial
HardwareSerial sim900(2);

// Global GSM state
GSMStatus gsmStatus = GSM_WAITING;
unsigned long lastGSMRetry = 0;
unsigned long lastSMSAttempt = 0;
std::queue<SMSMessage> smsQueue;

String readGSMResponse(unsigned long timeout = 5000) {
    String response = "";
    unsigned long startTime = millis();
    
    while (millis() - startTime < timeout) {
        while (sim900.available()) {
            char c = sim900.read();
            response += c;
            delay(1);
        }
        if (response.indexOf("OK") >= 0 || response.indexOf("ERROR") >= 0) {
            break;
        }
    }
    return response;
}

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

void initGSMModule() {
    if (!initGSM()) {
        Serial.println("⚠️ GSM initialization failed - will retry later");
    }
}

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
    
    response = readGSMResponse(10000);
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

        for (int i = 0; i < NUM_PHONES && !success; i++) {
            success = sendSMS(sms.message.c_str(), PHONE_NUMBERS[i]);
            if (!success && gsmStatus == GSM_ERROR) {
                break;
            }
        }

        if (success || sms.retries >= MAX_SMS_RETRIES) {
            smsQueue.pop();
        } else {
            sms.retries++;
            sms.nextAttempt = millis() + SMS_RETRY_INTERVAL;
        }
    }
}

void checkGSMStatusAndProcess() {
    checkGSMStatus();
    processSMSQueue();
}

#endif // GSM_MANAGER_H