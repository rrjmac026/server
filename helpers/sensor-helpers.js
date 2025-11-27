const moment = require('moment-timezone');
const { getCollection } = require('../config/database');

// Deduplication configuration
const DEDUP_WINDOW_MS = 10000; // 10 seconds
const PERIODIC_STORE_MS = 300000; // 5 minutes
const SIGNIFICANT_CHANGE_THRESHOLDS = {
  moisture: 5,
  temperature: 0.5,
  humidity: 3
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

async function shouldStoreSensorData(data) {
  const collection = await getCollection('sensor_data');
  const lastReading = await collection.findOne(
    { plantId: data.plantId },
    { sort: { timestamp: -1 } }
  );
  
  if (!lastReading) {
    return { store: true, reason: 'first_reading', skipAudit: false };
  }
  
  const timeSinceLastReading = Date.now() - new Date(lastReading.timestamp).getTime();
  
  if (timeSinceLastReading > PERIODIC_STORE_MS) {
    return { store: true, reason: 'periodic_update', skipAudit: false };
  }
  
  if (timeSinceLastReading < DEDUP_WINDOW_MS &&
      data.moisture === lastReading.moisture &&
      data.temperature === lastReading.temperature &&
      data.humidity === lastReading.humidity &&
      Boolean(data.waterState) === Boolean(lastReading.waterState) &&
      Boolean(data.fertilizerState) === Boolean(lastReading.fertilizerState)) {
    return { store: false, reason: 'duplicate_within_window', skipAudit: true };
  }
  
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
      changes: { moistureChange, tempChange, humidityChange, stateChanged }
    };
  }
  
  return { store: false, reason: 'no_significant_change', skipAudit: true };
}

async function saveSensorData(data) {
    const shouldStore = await shouldStoreSensorData(data);
    
    if (!shouldStore.store) {
        console.log(`⚠️ Skipping sensor data for ${data.plantId}: ${shouldStore.reason}`);
        return { 
            insertedId: null, 
            isDuplicate: true,
            reason: shouldStore.reason
        };
    }
    
    const collection = await getCollection('sensor_data');
    const result = await collection.insertOne({
        ...data,
        waterState: Boolean(data.waterState),
        fertilizerState: Boolean(data.fertilizerState),
        timestamp: moment().tz('Asia/Manila').toDate()
    });

    if (!shouldStore.skipAudit) {
        const auditCollection = await getCollection('audit_logs');
        await auditCollection.insertOne({
            plantId: data.plantId,
            type: 'sensor',
            action: 'read',
            status: 'success',
            timestamp: moment().tz('Asia/Manila').toDate(),
            details: `Sensor reading recorded (${shouldStore.reason})`,
            sensorData: {
                moisture: data.moisture,
                temperature: data.temperature,
                humidity: data.humidity,
                moistureStatus: data.moistureStatus,
                waterState: Boolean(data.waterState),
                fertilizerState: Boolean(data.fertilizerState),
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

async function getReadingsInRange(plantId, startDate, endDate) {
  const collection = await getCollection('sensor_data');
  
  const readings = await collection.find({
    plantId,
    timestamp: {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    }
  }).sort({ timestamp: -1 }).toArray();

  return readings;
}

async function getAllReadingsInRange(plantId, startDate, endDate) {
    const collection = await getCollection('sensor_data');
    
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    
    console.log('Debug - Query params:', { plantId, startDate: start, endDate: end });

    const readings = await collection.find({
        plantId: plantId,
        timestamp: { $gte: start, $lte: end }
    }).sort({ timestamp: -1 }).toArray();

    console.log(`Debug - Found ${readings.length} readings`);
    return readings;
}

function calculateStats(readings) {
  return readings.reduce((stats, reading) => {
    stats.totalTemperature += reading.temperature || 0;
    stats.totalHumidity += reading.humidity || 0;
    stats.totalMoisture += reading.moisture || 0;
    stats.moistureStatus[reading.moistureStatus.toLowerCase()]++;
    stats.waterStateCount += reading.waterState ? 1 : 0;
    stats.fertilizerStateCount += reading.fertilizerState ? 1 : 0;
    return stats;
  }, {
    totalTemperature: 0,
    totalHumidity: 0,
    totalMoisture: 0,
    moistureStatus: { dry: 0, moist: 0, wet: 0 },
    waterStateCount: 0,
    fertilizerStateCount: 0
  });
}

module.exports = {
  getMoistureStatus,
  isSensorDataStale,
  saveSensorData,
  getLatestReading,
  getReadingsInRange,
  getAllReadingsInRange,
  calculateStats,
  shouldStoreSensorData,
  DEDUP_WINDOW_MS,
  PERIODIC_STORE_MS,
  SIGNIFICANT_CHANGE_THRESHOLDS
};