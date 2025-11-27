const moment = require('moment-timezone');
const { getCollection } = require('../config/database');
const auditService = require('./audit.service');

// Deduplication configuration
const DEDUP_WINDOW_MS = 10000; // 10 seconds - prevent exact duplicates
const PERIODIC_STORE_MS = 300000; // 5 minutes - always store periodic records
const SIGNIFICANT_CHANGE_THRESHOLDS = {
  moisture: 5,      // 5% change
  temperature: 0.5, // 0.5°C change
  humidity: 3       // 3% change
};

function getMoistureStatus(moisture) {
  if (!moisture || moisture === null) return "NO DATA";
  if (moisture === 1023) return "SENSOR ERROR";
  if (moisture >= 1000) return "SENSOR ERROR";
  if (moisture > 600 && moisture < 1000) return "DRY";
  if (moisture > 370 && moisture <= 600) return "HUMID";
  if (moisture <= 370) return "WET";
  return "NO DATA";
}

function isSensorDataStale(timestamp) {
  const now = moment();
  const readingTime = moment(timestamp);
  return now.diff(readingTime, 'seconds') > 40;
}

/**
 * Determines if sensor data should be stored based on:
 * 1. Time since last reading (periodic storage)
 * 2. Duplicate detection within time window
 * 3. Significant change detection
 */
async function shouldStoreSensorData(data) {
  const collection = await getCollection('sensor_data');
  const lastReading = await collection.findOne(
    { plantId: data.plantId },
    { sort: { timestamp: -1 } }
  );
  
  // First reading for this plant - always store
  if (!lastReading) {
    return { 
      store: true, 
      reason: 'first_reading',
      skipAudit: false 
    };
  }
  
  // Calculate time since last reading
  const timeSinceLastReading = Date.now() - new Date(lastReading.timestamp).getTime();
  
  // Always store if more than 5 minutes elapsed (periodic update)
  if (timeSinceLastReading > PERIODIC_STORE_MS) {
    return { 
      store: true, 
      reason: 'periodic_update',
      skipAudit: false 
    };
  }
  
  // Check for exact duplicate within deduplication window
  if (timeSinceLastReading < DEDUP_WINDOW_MS &&
      data.moisture === lastReading.moisture &&
      data.temperature === lastReading.temperature &&
      data.humidity === lastReading.humidity &&
      Boolean(data.waterState) === Boolean(lastReading.waterState) &&
      Boolean(data.fertilizerState) === Boolean(lastReading.fertilizerState)) {
    return { 
      store: false, 
      reason: 'duplicate_within_window',
      skipAudit: true 
    };
  }
  
  // Check for significant change in any sensor value
  const moistureChange = Math.abs(data.moisture - lastReading.moisture);
  const tempChange = Math.abs(data.temperature - lastReading.temperature);
  const humidityChange = Math.abs(data.humidity - lastReading.humidity);
  const stateChanged = Boolean(data.waterState) !== Boolean(lastReading.waterState) ||
                       Boolean(data.fertilizerState) !== Boolean(lastReading.fertilizerState);
  
  const hasSignificantChange = 
    moistureChange >= SIGNIFICANT_CHANGE_THRESHOLDS.moisture ||
    tempChange >= SIGNIFICANT_CHANGE_THRESHOLDS.temperature ||
    humidityChange >= SIGNIFICANT_CHANGE_THRESHOLDS.humidity ||
    stateChanged;
  
  if (hasSignificantChange) {
    return { 
      store: true, 
      reason: 'significant_change',
      skipAudit: false,
      changes: {
        moisture: moistureChange,
        temperature: tempChange,
        humidity: humidityChange,
        stateChanged
      }
    };
  }
  
  // No significant change - don't store
  return { 
    store: false, 
    reason: 'no_significant_change',
    skipAudit: true 
  };
}

async function saveSensorData(data) {
  // Check if data should be stored
  const shouldStore = await shouldStoreSensorData(data);
  
  if (!shouldStore.store) {
    console.log(`⚠️ Skipping sensor data for ${data.plantId}: ${shouldStore.reason}`);
    return { 
      insertedId: null, 
      isDuplicate: true,
      reason: shouldStore.reason,
      message: `Sensor data not stored: ${shouldStore.reason}`
    };
  }
  
  const collection = await getCollection('sensor_data');
  
  // Prepare data for storage
  data.isConnected = true;
  data.moistureStatus = getMoistureStatus(data.moisture);
  data.waterState = Boolean(data.waterState);
  data.fertilizerState = Boolean(data.fertilizerState);
  
  const result = await collection.insertOne({
    ...data,
    timestamp: moment().tz('Asia/Manila').toDate()
  });

  console.log(`✅ Stored sensor data for ${data.plantId}: ${shouldStore.reason}`);

  // Create audit log only if not skipping
  if (!shouldStore.skipAudit) {
    await auditService.createAuditLog({
      plantId: data.plantId,
      type: 'sensor',
      action: 'read',
      status: 'success',
      details: `Sensor reading recorded (${shouldStore.reason})`,
      sensorData: {
        moisture: data.moisture,
        temperature: data.temperature,
        humidity: data.humidity,
        moistureStatus: data.moistureStatus,
        waterState: data.waterState,
        fertilizerState: data.fertilizerState,
        isConnected: data.isConnected
      }
    });
  }

  return {
    insertedId: result.insertedId,
    isDuplicate: false,
    reason: shouldStore.reason
  };
}

async function getLatestReading(plantId) {
  const collection = await getCollection('sensor_data');
  const reading = await collection.findOne(
    { plantId },
    { sort: { timestamp: -1 } }
  );
  
  if (!reading) return null;
  
  const isStale = isSensorDataStale(reading.timestamp);
  const isConnected = !isStale && reading.isConnected === true;
  
  return {
    ...reading,
    isConnected,
    isOnline: isConnected,
    moisture: isConnected ? reading.moisture : 0,
    temperature: isConnected ? reading.temperature : 0,
    humidity: isConnected ? reading.humidity : 0,
    moistureStatus: !isConnected ? "OFFLINE" : getMoistureStatus(reading.moisture)
  };
}

function formatSensorResponse(reading) {
  return {
    moisture: reading.isConnected ? reading.moisture : 0,
    temperature: reading.isConnected ? reading.temperature : 0,
    humidity: reading.isConnected ? reading.humidity : 0,
    moistureStatus: reading.moistureStatus,
    waterState: reading.isConnected ? reading.waterState : false,
    fertilizerState: reading.isConnected ? reading.fertilizerState : false,
    timestamp: moment(reading.timestamp).tz('Asia/Manila').format(),
    isOnline: reading.isConnected,
    isConnected: reading.isConnected
  };
}

module.exports = {
  saveSensorData,
  getLatestReading,
  formatSensorResponse,
  getMoistureStatus,
  shouldStoreSensorData, // Export for testing
  DEDUP_WINDOW_MS,
  PERIODIC_STORE_MS,
  SIGNIFICANT_CHANGE_THRESHOLDS
};