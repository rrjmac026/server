const moment = require('moment-timezone');

class ScheduleUtils {
    /**
     * Validate schedule data
     */
    static validateScheduleData(data) {
        if (!data) return 'Schedule data is required';
        if (!data.plantId) return 'Plant ID is required';
        if (!data.type || !['watering', 'fertilizing'].includes(data.type)) {
            return 'Valid type (watering or fertilizing) is required';
        }
        if (!data.time || !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(data.time)) {
            return 'Valid time in HH:MM format is required';
        }
        if (!Array.isArray(data.days) || data.days.length === 0) {
            return 'At least one day of the week is required';
        }
        if (typeof data.duration !== 'number' || data.duration < 1 || data.duration > 60) {
            return 'Duration must be between 1 and 60 minutes';
        }
        
        return null; // No validation errors
    }

    /**
     * Format schedule data for storage
     */
    static formatScheduleData(data) {
        return {
            ...data,
            enabled: data.enabled ?? true,
            status: 'idle',
            createdAt: moment().tz('Asia/Manila').toDate(),
            updatedAt: moment().tz('Asia/Manila').toDate()
        };
    }

    /**
     * Format schedule data for API response
     */
    static formatScheduleResponse(schedule) {
        return {
            ...schedule,
            id: schedule._id?.toString() || schedule.id,
            createdAt: moment(schedule.createdAt).tz('Asia/Manila').format(),
            updatedAt: moment(schedule.updatedAt).tz('Asia/Manila').format(),
            lastExecuted: schedule.lastExecuted ? 
                moment(schedule.lastExecuted).tz('Asia/Manila').format() : null
        };
    }

    /**
     * Check if schedule should run now
     */
    static shouldScheduleRun(schedule) {
        if (!schedule.enabled) return false;
        
        const now = moment().tz('Asia/Manila');
        const currentDay = now.format('dddd').toLowerCase();
        const currentTime = now.format('HH:mm');
        
        // Check if current day is in schedule
        const scheduleDays = schedule.days.map(day => day.toLowerCase());
        if (!scheduleDays.includes(currentDay)) return false;
        
        // Check if current time matches schedule time (within 1 minute window)
        const scheduleTime = moment(schedule.time, 'HH:mm');
        const timeDiff = Math.abs(now.diff(scheduleTime, 'minutes'));
        
        return timeDiff <= 1;
    }

    /**
     * Get next scheduled run time
     */
    static getNextRunTime(schedule) {
        if (!schedule.enabled) return null;
        
        const now = moment().tz('Asia/Manila');
        const scheduleTime = moment(schedule.time, 'HH:mm');
        
        // Find next occurrence
        for (let i = 0; i < 7; i++) {
            const checkDate = now.clone().add(i, 'days');
            const dayName = checkDate.format('dddd').toLowerCase();
            
            if (schedule.days.map(d => d.toLowerCase()).includes(dayName)) {
                const nextRun = checkDate.clone()
                    .hour(scheduleTime.hour())
                    .minute(scheduleTime.minute())
                    .second(0);
                
                if (nextRun.isAfter(now)) {
                    return nextRun.toDate();
                }
            }
        }
        
        return null;
    }

    /**
     * Check if device should be watered based on moisture
     */
    static shouldWaterBasedOnMoisture(schedule, sensorData) {
        if (schedule.type !== 'watering') return true;
        if (!schedule.settings?.moistureMode || schedule.settings.moistureMode !== 'auto') return true;
        if (!sensorData || !sensorData.isConnected) return false;
        
        const threshold = schedule.settings.moistureThreshold || 300;
        return sensorData.moisture <= threshold;
    }

    /**
     * Generate ESP32 command from schedule
     */
    static generateESP32Command(schedule) {
        const baseCommand = {
            duration: schedule.duration * 60 // Convert minutes to seconds
        };

        if (schedule.type === 'watering') {
            return {
                ...baseCommand,
                command: 'startWatering'
            };
        }

        if (schedule.type === 'fertilizing') {
            return {
                ...baseCommand,
                command: 'startFertilizing',
                amount: schedule.settings?.fertilizerAmount || 50
            };
        }

        throw new Error(`Unknown schedule type: ${schedule.type}`);
    }

    /**
     * Build query for schedule filtering
     */
    static buildScheduleQuery(plantId, enabled) {
        let query = { plantId };
        if (enabled !== undefined) {
            query.enabled = enabled === 'true';
        }
        return query;
    }

    /**
     * Validate schedule update data
     */
    static validateScheduleUpdate(data) {
        // Allow partial updates, but validate what's provided
        if (data.type && !['watering', 'fertilizing'].includes(data.type)) {
            return 'Valid type (watering or fertilizing) is required';
        }
        if (data.time && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(data.time)) {
            return 'Valid time in HH:MM format is required';
        }
        if (data.days && (!Array.isArray(data.days) || data.days.length === 0)) {
            return 'At least one day of the week is required';
        }
        if (data.duration && (typeof data.duration !== 'number' || data.duration < 1 || data.duration > 60)) {
            return 'Duration must be between 1 and 60 minutes';
        }
        
        return null;
    }

    /**
     * Format schedule update data
     */
    static formatScheduleUpdate(data) {
        return {
            ...data,
            updatedAt: moment().tz('Asia/Manila').toDate()
        };
    }
}

module.exports = ScheduleUtils;