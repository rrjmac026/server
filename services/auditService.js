const DatabaseConfig = require('../config/database');
const AuditUtils = require('../utils/auditUtils');
const moment = require('moment-timezone');

class AuditService {
    /**
     * Create audit log entry
     */
    static async createAuditLog(data) {
        try {
            const validationError = AuditUtils.validateAuditLog(data);
            if (validationError) {
                throw new Error(validationError);
            }

            const collection = await DatabaseConfig.getCollection('audit_logs');
            const logData = AuditUtils.sanitizeAuditLog(data);

            const result = await collection.insertOne(logData);
            
            return {
                success: true,
                id: result.insertedId,
                data: logData
            };
        } catch (error) {
            console.error('❌ Error creating audit log:', error.message);
            throw error;
        }
    }

    /**
     * Get audit logs with filtering and pagination
     */
    static async getAuditLogs(filters = {}) {
        try {
            const collection = await DatabaseConfig.getCollection('audit_logs');
            const { 
                start, end, type, action, status, plantId,
                page = 1, limit = 20, sort = 'desc' 
            } = filters;
            
            console.log('Fetching audit logs with params:', filters);
            
            // Build query
            const query = AuditUtils.buildAuditQuery({ start, end, type, action, status, plantId });
            console.log('MongoDB query:', JSON.stringify(query, null, 2));
            
            const skip = (parseInt(page) - 1) * parseInt(limit);
            
            // Fetch logs and total count
            const [logs, total] = await Promise.all([
                collection.find(query)
                    .sort({ timestamp: sort === 'asc' ? 1 : -1 })
                    .skip(skip)
                    .limit(parseInt(limit))
                    .toArray(),
                collection.countDocuments(query)
            ]);

            console.log(`Found ${logs.length} logs out of ${total} total`);
            
            return {
                success: true,
                logs: logs.map(log => ({
                    ...log,
                    timestamp: moment(log.timestamp).tz('Asia/Manila').format()
                })),
                pagination: {
                    total,
                    page: parseInt(page),
                    pages: Math.ceil(total / parseInt(limit)),
                    limit: parseInt(limit)
                }
            };
        } catch (error) {
            console.error('❌ Error fetching audit logs:', error.message);
            return {
                success: false,
                error: error.message,
                logs: [],
                pagination: { total: 0, page: 1, pages: 0, limit: 20 }
            };
        }
    }

    /**
     * Export audit logs for reporting
     */
    static async exportAuditLogs(filters = {}) {
        try {
            const collection = await DatabaseConfig.getCollection('audit_logs');
            const { start, end, type, plantId } = filters;
            
            const query = AuditUtils.buildAuditQuery({ start, end, type, plantId });

            const logs = await collection.find(query)
                .sort({ timestamp: -1 })
                .toArray();

            return {
                success: true,
                logs: logs.map(log => ({
                    ...log,
                    timestamp: moment(log.timestamp).tz('Asia/Manila').format()
                }))
            };
        } catch (error) {
            console.error('❌ Error exporting audit logs:', error.message);
            throw error;
        }
    }

    /**
     * Get distinct audit log types
     */
    static async getAuditTypes() {
        try {
            const collection = await DatabaseConfig.getCollection('audit_logs');
            const types = await collection.distinct('type');
            
            return {
                success: true,
                types: types.filter(t => t).map(t => String(t).toLowerCase())
            };
        } catch (error) {
            console.error('❌ Error fetching audit types:', error.message);
            return {
                success: false,
                error: error.message,
                types: []
            };
        }
    }

    /**
     * Get distinct audit log actions
     */
    static async getAuditActions() {
        try {
            const collection = await DatabaseConfig.getCollection('audit_logs');
            const actions = await collection.distinct('action');
            
            return {
                success: true,
                actions: actions.filter(a => a).map(a => String(a).toLowerCase())
            };
        } catch (error) {
            console.error('❌ Error fetching audit actions:', error.message);
            return {
                success: false,
                error: error.message,
                actions: []
            };
        }
    }

    /**
     * Get audit log statistics
     */
    static async getAuditStats(plantId = null, days = 30) {
        try {
            const collection = await DatabaseConfig.getCollection('audit_logs');
            const startDate = moment().subtract(days, 'days').toDate();
            
            let query = { timestamp: { $gte: startDate } };
            if (plantId) {
                query.plantId = plantId;
            }

            const [totalLogs, statusStats, typeStats] = await Promise.all([
                collection.countDocuments(query),
                collection.aggregate([
                    { $match: query },
                    { $group: { _id: '$status', count: { $sum: 1 } } }
                ]).toArray(),
                collection.aggregate([
                    { $match: query },
                    { $group: { _id: '$type', count: { $sum: 1 } } }
                ]).toArray()
            ]);

            return {
                success: true,
                totalLogs,
                period: `${days} days`,
                statusBreakdown: statusStats.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {}),
                typeBreakdown: typeStats.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {})
            };
        } catch (error) {
            console.error('❌ Error getting audit stats:', error.message);
            throw error;
        }
    }

    /**
     * Clean up old audit logs
     */
    static async cleanupOldLogs(daysToKeep = 365) {
        try {
            const cutoffDate = moment().subtract(daysToKeep, 'days').toDate();
            const collection = await DatabaseConfig.getCollection('audit_logs');
            
            const result = await collection.deleteMany({
                timestamp: { $lt: cutoffDate }
            });

            console.log(`✅ Cleaned up ${result.deletedCount} old audit log records`);
            return {
                success: true,
                deletedCount: result.deletedCount,
                cutoffDate
            };
        } catch (error) {
            console.error('❌ Error cleaning up old audit logs:', error.message);
            throw error;
        }
    }

    /**
     * Log sensor reading
     */
    static async logSensorReading(plantId, sensorData) {
        const auditLog = AuditUtils.createSensorAuditLog(plantId, sensorData);
        return await this.createAuditLog(auditLog);
    }

    /**
     * Log report generation
     */
    static async logReportGeneration(plantId, format, start, end, status = 'success', errorDetails = null) {
        const auditLog = AuditUtils.createReportAuditLog(plantId, format, start, end, status, errorDetails);
        return await this.createAuditLog(auditLog);
    }

    /**
     * Log schedule operation
     */
    static async logScheduleOperation(plantId, action, status, details, scheduleData = null) {
        const auditLog = AuditUtils.createScheduleAuditLog(plantId, action, status, details, scheduleData);
        return await this.createAuditLog(auditLog);
    }

    /**
     * Log device command
     */
    static async logDeviceCommand(plantId, command, status = 'sent') {
        const auditLog = AuditUtils.createDeviceCommandAuditLog(plantId, command, status);
        return await this.createAuditLog(auditLog);
    }
}

module.exports = AuditService;