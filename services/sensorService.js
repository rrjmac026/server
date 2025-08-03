const DatabaseConfig = require('../config/database');
const SensorUtils = require('../utils/sensorUtils');
const AuditUtils = require('../utils/auditUtils');
const moment = require('moment-timezone');

class SensorService {
    /**
     * Save sensor data to database
     */
    static async saveSensorData(rawData) {
        try {
            // Validate data
            const validationError = SensorUtils.validateSensorData(rawData);
            if (validationError) {
                throw new Error(validationError);
            }

            // Format data for storage
            const sensorData = SensorUtils.formatSensorData(rawData);
            
            // Save to database
            const collection = await DatabaseConfig.getCollection('sensor_data');
            const result = await collection.insertOne(sensorData);

            // Create audit log
            const auditLog = AuditUtils.createSensorAuditLog(sensorData.plantId, sensorData);
            const auditCollection = await DatabaseConfig.getCollection('audit_logs');
            await auditCollection.insertOne(auditLog);

            return {
                success: true,
                id: result.insertedId,
                data: sensorData
            };
        } catch (error) {
            console.error('❌ Error saving sensor data:', error.message);
            throw error;
        }
    }

    /**
     * Get latest sensor reading for a plant
     */
    static async getLatestReading(plantId) {
        try {
            const collection = await DatabaseConfig.getCollection('sensor_data');
            const reading = await collection.findOne(
                { plantId },
                { sort: { timestamp: -1 } }
            );
            
            return SensorUtils.formatSensorResponse(reading);
        } catch (error) {
            console.error('❌ Error getting latest reading:', error.message);
            throw error;
        }
    }

    /**
     * Get sensor readings within date range
     */
    static async getReadingsInRange(plantId, startDate, endDate) {
        try {
            const collection = await DatabaseConfig.getCollection('sensor_data');
            
            // Convert string dates to Date objects
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            
            console.log('Debug - Query params:', { plantId, startDate: start, endDate: end });

            const readings = await collection.find({
                plantId: plantId,
                timestamp: {
                    $gte: start,
                    $lte: end
                }
            }).sort({ timestamp: -1 }).toArray();

            console.log(`Debug - Found ${readings.length} readings`);
            return readings;
        } catch (error) {
            console.error('❌ Error getting readings in range:', error.message);
            throw error;
        }
    }

    /**
     * Get sensor statistics for a date range
     */
    static async getSensorStats(plantId, startDate, endDate) {
        try {
            const readings = await this.getReadingsInRange(plantId, startDate, endDate);
            return SensorUtils.calculateStats(readings);
        } catch (error) {
            console.error('❌ Error calculating sensor stats:', error.message);
            throw error;
        }
    }

    /**
     * Check if sensor is online
     */
    static async isSensorOnline(plantId) {
        try {
            const reading = await this.getLatestReading(plantId);
            return reading.isConnected;
        } catch (error) {
            console.error('❌ Error checking sensor status:', error.message);
            return false;
        }
    }

    /**
     * Get sensor health status
     */
    static async getSensorHealth(plantId) {
        try {
            const reading = await this.getLatestReading(plantId);
            const isOnline = reading.isConnected;
            const lastSeen = reading.timestamp;
            
            let healthStatus = 'unknown';
            if (isOnline) {
                healthStatus = 'healthy';
            } else if (lastSeen) {
                const hoursSinceLastSeen = moment().diff(moment(lastSeen), 'hours');
                if (hoursSinceLastSeen < 1) {
                    healthStatus = 'warning';
                } else {
                    healthStatus = 'offline';
                }
            }

            return {
                plantId,
                isOnline,
                healthStatus,
                lastSeen,
                currentReading: reading
            };
        } catch (error) {
            console.error('❌ Error getting sensor health:', error.message);
            return {
                plantId,
                isOnline: false,
                healthStatus: 'error',
                lastSeen: null,
                currentReading: null,
                error: error.message
            };
        }
    }

    /**
     * Delete old sensor data (cleanup)
     */
    static async cleanupOldData(daysToKeep = 90) {
        try {
            const cutoffDate = moment().subtract(daysToKeep, 'days').toDate();
            const collection = await DatabaseConfig.getCollection('sensor_data');
            
            const result = await collection.deleteMany({
                timestamp: { $lt: cutoffDate }
            });

            console.log(`✅ Cleaned up ${result.deletedCount} old sensor records`);
            return {
                success: true,
                deletedCount: result.deletedCount,
                cutoffDate
            };
        } catch (error) {
            console.error('❌ Error cleaning up old data:', error.message);
            throw error;
        }
    }
}

module.exports = SensorService;