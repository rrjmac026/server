const moment = require('moment-timezone');
const { getCollection } = require('../config/database');
const auditService = require('./audit.service');

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

async function saveSensorData(data) {
  const collection = await getCollection('sensor_data');
  
  data.isConnected = true;
  data.moistureStatus = getMoistureStatus(data.moisture);
  data.waterState = Boolean(data.waterState);
  data.fertilizerState = Boolean(data.fertilizerState);
  
  const result = await collection.insertOne({
    ...data,
    timestamp: moment().tz('Asia/Manila').toDate()
  });

  // Log audit event
  await auditService.createAuditLog({
    plantId: data.plantId,
    type: 'sensor',
    action: 'read',
    status: 'success',
    details: 'Sensor reading recorded',
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

  return result;
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
  getMoistureStatus
};