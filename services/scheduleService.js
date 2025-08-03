const DatabaseConfig = require('../config/database');
const ScheduleUtils = require('../utils/scheduleUtils');
const AuditService = require('./auditService');
const SensorService = require('./sensorService');
const { ObjectId } = require('mongodb');
const moment = require('moment-timezone');

class ScheduleService {
    /**
     * Create a new schedule
     */
    static async createSchedule(data) {
        try {
            const validationError = ScheduleUtils.validateScheduleData(data);
            if (validationError) {
                throw new Error(validationError);
            }

            const collection = await DatabaseConfig.getCollection('schedules');
            const scheduleData = ScheduleUtils.formatScheduleData(data);
            
            const result = await collection.insertOne(scheduleData);
            const insertedSchedule = {
                ...scheduleData,
                _id: result.insertedId,
                id: result.insertedId.toString()
            };

            // Create audit log
            await AuditService.logScheduleOperation(
                scheduleData.plantId,
                'create',
                'success',
                `Created ${scheduleData.type} schedule`,
                scheduleData
            );

            return {
                success: true,
                id: result.insertedId.toString(),
                schedule: ScheduleUtils.formatScheduleResponse(insertedSchedule)
            };
        } catch (error) {
            console.error('❌ Error creating schedule:', error.message);
            
            // Log failure if we have plantId
            if (data?.plantId) {
                await AuditService.logScheduleOperation(
                    data.plantId,
                    'create',
                    'failed',
                    `Failed to create schedule: ${error.message}`
                );
            }
            
            throw error;
        }
    }

    /**
     * Get schedules for a plant
     */
    static async getSchedulesByPlant(plantId, enabled = undefined) {
        try {
            const collection = await DatabaseConfig.getCollection('schedules');
            const query = ScheduleUtils.buildScheduleQuery(plantId, enabled);
            
            const schedules = await collection
                .find(query)
                .sort({ createdAt: -1 })
                .toArray();

            return {
                success: true,
                schedules: schedules.map(schedule => ScheduleUtils.formatScheduleResponse(schedule))
            };
        } catch (error) {
            console.error('❌ Error fetching schedules:', error.message);
            throw error;
        }
    }

    /**
     * Update a schedule
     */
    static async updateSchedule(scheduleId, updateData) {
        try {
            const validationError = ScheduleUtils.validateScheduleUpdate(updateData);
            if (validationError) {
                throw new Error(validationError);
            }

            const collection = await DatabaseConfig.getCollection('schedules');
            const formattedUpdate = ScheduleUtils.formatScheduleUpdate(updateData);
            
            const result = await collection.updateOne(
                { _id: new ObjectId(scheduleId) },
                { $set: formattedUpdate }
            );
            
            if (result.matchedCount === 0) {
                throw new Error('Schedule not found');
            }

            // Get updated schedule for audit logging
            const updatedSchedule = await collection.findOne({ _id: new ObjectId(scheduleId) });
            
            if (updatedSchedule) {
                await AuditService.logScheduleOperation(
                    updatedSchedule.plantId,
                    'update',
                    'success',
                    `Updated ${updatedSchedule.type} schedule`,
                    updatedSchedule
                );
            }
            
            return {
                success: true,
                id: scheduleId,
                modifiedCount: result.modifiedCount
            };
        } catch (error) {
            console.error('❌ Error updating schedule:', error.message);
            throw error;
        }
    }

    /**
     * Delete a schedule
     */
    static async deleteSchedule(scheduleId) {
        try {
            const collection = await DatabaseConfig.getCollection('schedules');
            
            // Get schedule before deletion for audit logging
            const schedule = await collection.findOne({ _id: new ObjectId(scheduleId) });
            
            const result = await collection.deleteOne({ _id: new ObjectId(scheduleId) });
            
            if (result.deletedCount === 0) {
                throw new Error('Schedule not found');
            }

            if (schedule) {
                await AuditService.logScheduleOperation(
                    schedule.plantId,
                    'delete',
                    'success',
                    `Deleted ${schedule.type} schedule`
                );
            }
            
            return {
                success: true,
                id: scheduleId,
                deletedCount: result.deletedCount
            };
        } catch (error) {
            console.error('❌ Error deleting schedule:', error.message);
            throw error;
        }
    }

    /**
     * Execute a schedule
     */
    static async executeSchedule(scheduleId) {
        try {
            const collection = await DatabaseConfig.getCollection('schedules');
            const schedule = await collection.findOne({ _id: new ObjectId(scheduleId) });

            if (!schedule) {
                throw new Error('Schedule not found');
            }

            if (!schedule.enabled) {
                throw new Error('Schedule is disabled');
            }

            // Check if device is online
            const sensorData = await SensorService.getLatestReading(schedule.plantId);
            if (!sensorData.isConnected) {
                throw new Error('Device is offline');
            }

            // Log execution start
            await AuditService.logScheduleOperation(
                schedule.plantId,
                'execute',
                'start',
                `Starting ${schedule.type} schedule execution`,
                schedule
            );

            // Update schedule status
            await collection.updateOne(
                { _id: new ObjectId(scheduleId) },
                { 
                    $set: { 
                        status: 'executing',
                        lastExecuted: moment().tz('Asia/Manila').toDate()
                    }
                }
            );

            // Check conditions for watering
            if (schedule.type === 'watering') {
                const shouldWater = ScheduleUtils.shouldWaterBasedOnMoisture(schedule, sensorData);
                if (!shouldWater) {
                    await AuditService.logScheduleOperation(
                        schedule.plantId,
                        'execute',
                        'skipped',
                        `Skipped watering - moisture level sufficient (${sensorData.moisture})`
                    );
                    
                    return {
                        success: true,
                        status: 'skipped',
                        reason: 'Moisture level sufficient'
                    };
                }
            }

            // Generate and send command to ESP32
            const command = ScheduleUtils.generateESP32Command(schedule);
            await this.sendCommandToESP32(schedule.plantId, command);

            // Update schedule status to completed
            await collection.updateOne(
                { _id: new ObjectId(scheduleId) },
                { $set: { status: 'completed' } }
            );

            // Log successful execution
            await AuditService.logScheduleOperation(
                schedule.plantId,
                'execute',
                'success',
                `Completed ${schedule.type} schedule execution`,
                schedule
            );

            return {
                success: true,
                status: 'completed',
                command: command
            };
        } catch (error) {
            console.error(`❌ Schedule execution failed: ${error.message}`);
            
            // Update schedule status to failed
            if (scheduleId) {
                const collection = await DatabaseConfig.getCollection('schedules');
                await collection.updateOne(
                    { _id: new ObjectId(scheduleId) },
                    { $set: { status: 'failed' } }
                );
            }

            throw error;
        }
    }

    /**
     * Get schedule status
     */
    static async getScheduleStatus(scheduleId) {
        try {
            const collection = await DatabaseConfig.getCollection('schedules');
            const schedule = await collection.findOne({ _id: new ObjectId(scheduleId) });

            if (!schedule) {
                throw new Error('Schedule not found');
            }

            return {
                success: true,
                status: schedule.status || 'idle',
                lastExecuted: schedule.lastExecuted ? 
                    moment(schedule.lastExecuted).tz('Asia/Manila').format() : null,
                enabled: schedule.enabled,
                nextRun: ScheduleUtils.getNextRunTime(schedule)
            };
        } catch (error) {
            console.error('❌ Error getting schedule status:', error.message);
            throw error;
        }
    }

    /**
     * Get schedules that should run now
     */
    static async getSchedulesToRun() {
        try {
            const collection = await DatabaseConfig.getCollection('schedules');
            const schedules = await collection.find({ enabled: true }).toArray();
            
            const schedulesToRun = schedules.filter(schedule => 
                ScheduleUtils.shouldScheduleRun(schedule)
            );

            return {
                success: true,
                schedules: schedulesToRun.map(schedule => ScheduleUtils.formatScheduleResponse(schedule))
            };
        } catch (error) {
            console.error('❌ Error getting schedules to run:', error.message);
            throw error;
        }
    }

    /**
     * Send command to ESP32 device
     */
    static async sendCommandToESP32(plantId, command) {
        try {
            // Verify device is online
            const sensorData = await SensorService.getLatestReading(plantId);
            if (!sensorData.isConnected) {
                throw new Error('ESP32 device is offline');
            }

            // TODO: Implement actual ESP32 communication
            // This could be MQTT, HTTP, or other communication method
            console.log(`📡 Sending command to ESP32 for plant ${plantId}:`, command);
            
            // Log command sent
            await AuditService.logDeviceCommand(plantId, command, 'sent');

            // Simulate command execution time
            await new Promise(resolve => setTimeout(resolve, 1000));

            return {
                success: true,
                command: command,
                timestamp: moment().tz('Asia/Manila').toDate()
            };
        } catch (error) {
            console.error(`❌ Failed to send command to ESP32: ${error.message}`);
            
            // Log command failure
            await AuditService.logDeviceCommand(plantId, command, 'failed');
            
            throw error;
        }
    }

    /**
     * Clean up old completed schedules
     */
    static async cleanupCompletedSchedules(daysToKeep = 30) {
        try {
            const cutoffDate = moment().subtract(daysToKeep, 'days').toDate();
            const collection = await DatabaseConfig.getCollection('schedules');
            
            const result = await collection.deleteMany({
                status: 'completed',
                lastExecuted: { $lt: cutoffDate }
            });

            console.log(`✅ Cleaned up ${result.deletedCount} old completed schedules`);
            return {
                success: true,
                deletedCount: result.deletedCount,
                cutoffDate
            };
        } catch (error) {
            console.error('❌ Error cleaning up completed schedules:', error.message);
            throw error;
        }
    }
}

module.exports = ScheduleService;