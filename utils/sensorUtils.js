const moment = require('moment-timezone');

class SensorUtils {
    /**
     * Determine moisture status based on moisture reading
     */
    static getMoistureStatus(moisture) {
        if (!moisture || moisture === null) return "NO DATA";
        if (moisture === 1023) return "SENSOR ERROR";
        if (moisture >= 1000) return "SENSOR ERROR";
        if (moisture > 600 && moisture < 1000) return "DRY";
        if (moisture > 370 && moisture <= 600) return "HUMID";
        if (moisture <= 370) return "WET";
        return "NO DATA";
    }

    /**
     * Check if sensor data is stale (older than threshold)
     */
    static isSensorDataStale(timestamp, thresholdSeconds = 50) {
        const now = moment();
        const readingTime = moment(timestamp);
        return now.diff(readingTime, 'seconds') > thresholdSeconds;
    }

    /**
     * Validate sensor data completeness
     */
    static validateSensorData(data) {
        const requiredFields = ['plantId', 'moisture', 'temperature', 'humidity', 'waterState', 'fertilizerState'];
        
        for (const field of requiredFields) {
            if (data[field] == null) {
                return `Missing required field: ${field}`;
            }
        }
        return null;
    }

    /**
     * Sanitize and format sensor data for storage
     */
    static formatSensorData(data) {
        return {
            ...data,
            waterState: Boolean(data.waterState),
            fertilizerState: Boolean(data.fertilizerState),
            moistureStatus: this.getMoistureStatus(data.moisture),
            isConnected: true,
            timestamp: moment().tz('Asia/Manila').toDate()
        };
    }

    /**
     * Format sensor data for API response
     */
    static formatSensorResponse(reading) {
        if (!reading) {
            return {
                moisture: 0,
                temperature: 0,
                humidity: 0,
                moistureStatus: "OFFLINE",
                waterState: false,
                fertilizerState: false,
                isOnline: false,
                isConnected: false,
                timestamp: null
            };
        }

        const isStale = this.isSensorDataStale(reading.timestamp);
        const isConnected = !isStale && reading.isConnected === true;

        return {
            moisture: isConnected ? reading.moisture : 0,
            temperature: isConnected ? reading.temperature : 0,
            humidity: isConnected ? reading.humidity : 0,
            moistureStatus: !isConnected ? "OFFLINE" : this.getMoistureStatus(reading.moisture),
            waterState: isConnected ? reading.waterState : false,
            fertilizerState: isConnected ? reading.fertilizerState : false,
            timestamp: reading.timestamp ? moment(reading.timestamp).tz('Asia/Manila').format() : null,
            isOnline: isConnected,
            isConnected: isConnected
        };
    }

    /**
     * Calculate statistics from sensor readings
     */
    static calculateStats(readings) {
        if (!readings || readings.length === 0) {
            return {
                totalTemperature: 0,
                totalHumidity: 0,
                totalMoisture: 0,
                avgTemperature: 0,
                avgHumidity: 0,
                avgMoisture: 0,
                moistureStatus: { dry: 0, humid: 0, wet: 0 },
                waterStateCount: 0,
                fertilizerStateCount: 0,
                totalReadings: 0
            };
        }

        const stats = readings.reduce((acc, reading) => {
            acc.totalTemperature += reading.temperature || 0;
            acc.totalHumidity += reading.humidity || 0;
            acc.totalMoisture += reading.moisture || 0;
            
            const status = (reading.moistureStatus || '').toLowerCase();
            if (acc.moistureStatus.hasOwnProperty(status)) {
                acc.moistureStatus[status]++;
            }
            
            acc.waterStateCount += reading.waterState ? 1 : 0;
            acc.fertilizerStateCount += reading.fertilizerState ? 1 : 0;
            return acc;
        }, {
            totalTemperature: 0,
            totalHumidity: 0,
            totalMoisture: 0,
            moistureStatus: { dry: 0, humid: 0, wet: 0 },
            waterStateCount: 0,
            fertilizerStateCount: 0
        });

        const count = readings.length;
        return {
            ...stats,
            avgTemperature: (stats.totalTemperature / count).toFixed(1),
            avgHumidity: (stats.totalHumidity / count).toFixed(1),
            avgMoisture: (stats.totalMoisture / count).toFixed(1),
            totalReadings: count
        };
    }
}

module.exports = SensorUtils;