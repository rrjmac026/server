
const moment = require('moment-timezone');
const AuditUtils = require('../utils/auditUtils');

// Import your database connection function
const { getCollection } = require('../config/database'); // Adjust path as needed

class AuditService {
    /**
     * Create audit log entry
     */
    static async createAuditLog(data) {
        const collection = await getCollection('audit_logs');
        const logData = AuditUtils.sanitizeAuditLog({
            ...data,
            timestamp: moment().tz('Asia/Manila').toDate()
        });

        const result = await collection.insertOne(logData);
        
        return {
            insertedId: result.insertedId,
            logData: logData
        };
    }

    /**
     * Get audit logs with filtering and pagination
     */
    static async getAuditLogs(params) {
        const collection = await getCollection('audit_logs');
        const { 
            start, 
            end, 
            type, 
            action, 
            status,
            plantId,
            page = 1, 
            limit = 20,
            sort = 'desc' 
        } = params;
        
        let query = {};
        
        // Apply filters
        if (plantId) query.plantId = plantId;
        if (type) query.type = type.toLowerCase();
        if (action) query.action = action.toLowerCase();
        if (status) query.status = status.toLowerCase();
        
        // Date range filter
        if (start || end) {
            query.timestamp = {};
            if (start) query.timestamp.$gte = new Date(start);
            if (end) query.timestamp.$lte = new Date(end);
        }

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

        return {
            logs,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / parseInt(limit)),
                limit: parseInt(limit)
            }
        };
    }

    /**
     * Get logs for export (no pagination)
     */
    static async getLogsForExport(params) {
        const collection = await getCollection('audit_logs');
        const { start, end, type, plantId } = params;
        
        let query = {};
        
        if (plantId) query.plantId = plantId;
        if (type) query.type = type.toLowerCase();
        
        if (start || end) {
            query.timestamp = {};
            if (start) query.timestamp.$gte = new Date(start);
            if (end) query.timestamp.$lte = new Date(end);
        }

        const logs = await collection.find(query)
            .sort({ timestamp: -1 })
            .toArray();

        return logs;
    }

    /**
     * Get distinct audit log types
     */
    static async getAuditTypes() {
        const collection = await getCollection('audit_logs');
        const types = await collection.distinct('type');
        return types;
    }

    /**
     * Get distinct audit log actions
     */
    static async getAuditActions() {
        const collection = await getCollection('audit_logs');
        const actions = await collection.distinct('action');
        return actions;
    }

    /**
     * Get audit statistics
     */
    static async getAuditStats(plantId, days = 30) {
        const collection = await getCollection('audit_logs');
        const startDate = moment().subtract(days, 'days').toDate();
        
        let matchQuery = {
            timestamp: { $gte: startDate }
        };
        
        if (plantId) {
            matchQuery.plantId = plantId;
        }

        const pipeline = [
            { $match: matchQuery },
            {
                $group: {
                    _id: null,
                    totalLogs: { $sum: 1 },
                    successCount: {
                        $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] }
                    },
                    failedCount: {
                        $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] }
                    },
                    typeBreakdown: {
                        $push: "$type"
                    },
                    actionBreakdown: {
                        $push: "$action"
                    }
                }
            }
        ];

        const stats = await collection.aggregate(pipeline).toArray();
        const result = stats[0] || {
            totalLogs: 0,
            successCount: 0,
            failedCount: 0,
            typeBreakdown: [],
            actionBreakdown: []
        };

        // Process breakdown arrays
        const typeStats = result.typeBreakdown.reduce((acc, type) => {
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});

        const actionStats = result.actionBreakdown.reduce((acc, action) => {
            acc[action] = (acc[action] || 0) + 1;
            return acc;
        }, {});

        return {
            period: `${days} days`,
            totalLogs: result.totalLogs,
            successCount: result.successCount,
            failedCount: result.failedCount,
            successRate: result.totalLogs > 0 ? ((result.successCount / result.totalLogs) * 100).toFixed(2) : 0,
            typeBreakdown: typeStats,
            actionBreakdown: actionStats
        };
    }

    /**
     * Clean up old audit logs
     */
    static async cleanupOldLogs(days = 365) {
        const collection = await getCollection('audit_logs');
        const cutoffDate = moment().subtract(days, 'days').toDate();
        
        const result = await collection.deleteMany({
            timestamp: { $lt: cutoffDate }
        });

        // Log the cleanup action
        if (result.deletedCount > 0) {
            await this.createAuditLog({
                plantId: 'SYSTEM',
                type: 'maintenance',
                action: 'cleanup',
                status: 'success',
                details: `Cleaned up ${result.deletedCount} audit logs older than ${days} days`
            });
        }

        return {
            deletedCount: result.deletedCount,
            cutoffDate: cutoffDate,
            message: `Removed ${result.deletedCount} logs older than ${days} days`
        };
    }

    /**
     * Log sensor data reading
     */
    static async logSensorReading(plantId, sensorData) {
        return await this.createAuditLog({
            plantId: plantId,
            type: 'sensor',
            action: 'read',
            status: 'success',
            details: 'Sensor reading recorded',
            sensorData: {
                moisture: sensorData.moisture,
                temperature: sensorData.temperature,
                humidity: sensorData.humidity,
                moistureStatus: sensorData.moistureStatus,
                waterState: Boolean(sensorData.waterState),
                fertilizerState: Boolean(sensorData.fertilizerState),
                isConnected: sensorData.isConnected
            }
        });
    }

    /**
     * Log report generation
     */
    static async logReportGeneration(plantId, format, start, end, success = true, error = null) {
        return await this.createAuditLog({
            plantId: plantId,
            type: 'report',
            action: 'generate',
            status: success ? 'success' : 'failed',
            details: success ? 
                `Generated ${format.toUpperCase()} report from ${start} to ${end}` :
                `Failed to generate report: ${error}`,
        });
    }

    /**
     * Log schedule operations
     */
    static async logScheduleOperation(plantId, action, scheduleData, success = true, error = null) {
        return await this.createAuditLog({
            plantId: plantId,
            type: 'schedule',
            action: action,
            status: success ? 'success' : 'failed',
            details: success ? 
                `${action.charAt(0).toUpperCase() + action.slice(1)} ${scheduleData.type} schedule` :
                `Failed to ${action} schedule: ${error}`,
            scheduleData: scheduleData
        });
    }
}

module.exports = AuditService;