const moment = require('moment-timezone');

class AuditUtils {
    /**
     * Validate audit log data
     */
    static validateAuditLog(data) {
        const requiredFields = ['plantId', 'type', 'action'];
        for (const field of requiredFields) {
            if (!data[field]) {
                return `Missing required field: ${field}`;
            }
        }
        return null;
    }

    /**
     * Sanitize audit log data
     */
    static sanitizeAuditLog(log) {
        return {
            ...log,
            type: String(log.type || '').toLowerCase(),
            action: String(log.action || '').toLowerCase(),
            status: String(log.status || 'success').toLowerCase(),
            timestamp: log.timestamp || moment().tz('Asia/Manila').toDate(),
            details: log.details || null,
            sensorData: log.sensorData || null
        };
    }

    /**
     * Create audit log entry for sensor readings
     */
    static createSensorAuditLog(plantId, sensorData) {
        return {
            plantId: plantId,
            type: 'sensor',
            action: 'read',
            status: 'success',
            timestamp: moment().tz('Asia/Manila').toDate(),
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
        };
    }

    /**
     * Create audit log entry for report generation
     */
    static createReportAuditLog(plantId, format, start, end, status = 'success', errorDetails = null) {
        return {
            plantId: plantId,
            type: 'report',
            action: 'generate',
            status: status,
            timestamp: moment().tz('Asia/Manila').toDate(),
            details: status === 'success' 
                ? `Generated ${format.toUpperCase()} report from ${start} to ${end}`
                : `Failed to generate report: ${errorDetails}`,
        };
    }

    /**
     * Create audit log entry for schedule operations
     */
    static createScheduleAuditLog(plantId, action, status, details, scheduleData = null) {
        return {
            plantId: plantId,
            type: 'schedule',
            action: action,
            status: status,
            timestamp: moment().tz('Asia/Manila').toDate(),
            details: details,
            scheduleData: scheduleData
        };
    }

    /**
     * Create audit log entry for device commands
     */
    static createDeviceCommandAuditLog(plantId, command, status = 'sent') {
        return {
            plantId: plantId,
            type: 'device',
            action: 'command',
            status: status,
            timestamp: moment().tz('Asia/Manila').toDate(),
            details: `${status === 'sent' ? 'Sent' : 'Failed to send'} ${command.command} command to device`,
            command: command
        };
    }

    /**
     * Build query for audit log filtering
     */
    static buildAuditQuery(filters) {
        const { start, end, type, action, status, plantId } = filters;
        let query = {};
        
        if (plantId) query.plantId = plantId;
        if (type) query.type = type.toLowerCase();
        if (action) query.action = action.toLowerCase();
        if (status) query.status = status.toLowerCase();
        
        if (start || end) {
            query.timestamp = {};
            if (start) query.timestamp.$gte = new Date(start);
            if (end) query.timestamp.$lte = new Date(end);
        }

        return query;
    }

    /**
     * Get status color for PDF reports
     */
    static getStatusColor(status) {
        const colors = {
            'success': '#4CAF50',
            'failed': '#f44336',
            'warning': '#FF9800',
            'info': '#2196F3'
        };
        return colors[status] || '#9E9E9E';
    }

    /**
     * Format sensor data for audit logs
     */
    static formatSensorDataForAudit(sensorData) {
        if (!sensorData) return '-';
        
        const items = [];
        if (sensorData.moisture !== undefined) items.push(`Moisture: ${sensorData.moisture}%`);
        if (sensorData.temperature !== undefined) items.push(`Temp: ${sensorData.temperature}°C`);
        if (sensorData.humidity !== undefined) items.push(`Humidity: ${sensorData.humidity}%`);
        if (sensorData.moistureStatus) items.push(`Status: ${sensorData.moistureStatus}`);
        if (sensorData.waterState !== undefined) items.push(`Water: ${sensorData.waterState ? 'ON' : 'OFF'}`);
        if (sensorData.fertilizerState !== undefined) items.push(`Fertilizer: ${sensorData.fertilizerState ? 'ON' : 'OFF'}`);
        
        return items.join('\n');
    }
}

module.exports = AuditUtils;