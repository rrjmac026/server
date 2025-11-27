const moment = require('moment-timezone');
const { ObjectId } = require('mongodb');
const { getCollection } = require('../config/database');
const auditService = require('./audit.service');
const esp32Service = require('./esp32.service');
const sensorService = require('./sensor.service');

async function createSchedule(scheduleData) {
  const collection = await getCollection('schedules');
  
  const data = {
    ...scheduleData,
    enabled: scheduleData.enabled ?? true,
    createdAt: moment().tz('Asia/Manila').toDate(),
    updatedAt: moment().tz('Asia/Manila').toDate()
  };
  
  const result = await collection.insertOne(data);
  
  // Create audit log
  await auditService.createAuditLog({
    plantId: data.plantId,
    type: 'schedule',
    action: 'create',
    status: 'success',
    details: `Created ${data.type} schedule`,
    scheduleData: data
  });

  return {
    _id: result.insertedId,
    ...data,
    id: result.insertedId.toString()
  };
}

async function getSchedules(plantId, enabled) {
  const collection = await getCollection('schedules');
  
  let query = { plantId };
  if (enabled !== undefined) {
    query.enabled = enabled === 'true';
  }
  
  const schedules = await collection
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();

  return schedules;
}

async function updateSchedule(scheduleId, updateData) {
  const collection = await getCollection('schedules');
  
  const result = await collection.updateOne(
    { _id: new ObjectId(scheduleId) },
    { 
      $set: {
        ...updateData,
        updatedAt: moment().tz('Asia/Manila').toDate()
      }
    }
  );
  
  return result.matchedCount > 0;
}

async function deleteSchedule(scheduleId) {
  const collection = await getCollection('schedules');
  const result = await collection.deleteOne({ _id: new ObjectId(scheduleId) });
  return result.deletedCount > 0;
}

async function executeSchedule(scheduleId) {
  const collection = await getCollection('schedules');
  const schedule = await collection.findOne({ _id: new ObjectId(scheduleId) });

  if (!schedule) {
    throw new Error('Schedule not found');
  }

  const sensorData = await sensorService.getLatestReading(schedule.plantId);
  
  if (!sensorData.isConnected) {
    throw new Error('Device is offline');
  }

  // Log execution start
  await auditService.createAuditLog({
    plantId: schedule.plantId,
    type: 'schedule',
    action: 'execute',
    status: 'start',
    details: `Starting ${schedule.type} schedule execution`,
    scheduleData: schedule
  });

  // Update schedule status
  await collection.updateOne(
    { _id: new ObjectId(scheduleId) },
    { $set: { 
      status: 'executing',
      lastExecuted: moment().tz('Asia/Manila').toDate()
    }}
  );

  try {
    if (schedule.type === 'watering') {
      if (schedule.settings?.moistureMode === 'auto' && 
          sensorData.moisture <= schedule.settings.moistureThreshold) {
        await esp32Service.sendCommand(schedule.plantId, {
          command: 'startWatering',
          duration: schedule.duration * 60
        });
      }
    } else if (schedule.type === 'fertilizing') {
      await esp32Service.sendCommand(schedule.plantId, {
        command: 'startFertilizing',
        duration: schedule.duration * 60,
        amount: schedule.settings?.fertilizerAmount || 50
      });
    }

    // Log successful execution
    await auditService.createAuditLog({
      plantId: schedule.plantId,
      type: 'schedule',
      action: 'execute',
      status: 'success',
      details: `Completed ${schedule.type} schedule execution`,
      scheduleData: schedule
    });
  } catch (error) {
    // Log execution failure
    await auditService.createAuditLog({
      plantId: schedule.plantId,
      type: 'schedule',
      action: 'execute',
      status: 'failed',
      details: `Failed to execute ${schedule.type} schedule: ${error.message}`,
      scheduleData: schedule
    });
    throw error;
  }
}

async function getScheduleStatus(scheduleId) {
  const collection = await getCollection('schedules');
  const schedule = await collection.findOne({ _id: new ObjectId(scheduleId) });

  if (!schedule) {
    return null;
  }

  return {
    status: schedule.status || 'idle',
    lastExecuted: schedule.lastExecuted,
    enabled: schedule.enabled
  };
}

module.exports = {
  createSchedule,
  getSchedules,
  updateSchedule,
  deleteSchedule,
  executeSchedule,
  getScheduleStatus
};