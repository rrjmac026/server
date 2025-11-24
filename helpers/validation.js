function validateAuditLog(data) {
    const requiredFields = ['plantId', 'type', 'action'];
    for (const field of requiredFields) {
        if (!data[field]) {
            return `Missing required field: ${field}`;
        }
    }
    return null;
}

function sanitizeAuditLog(log) {
    return {
        ...log,
        type: String(log.type || '').toLowerCase(),
        action: String(log.action || '').toLowerCase(),
        status: String(log.status || 'success').toLowerCase(),
        timestamp: log.timestamp || new Date(),
        details: log.details || null,
        sensorData: log.sensorData || null
    };
}

function validateScheduleData(data) {
  if (!data) return 'Schedule data is required';
  if (!data.plantId) return 'Plant ID is required';
  if (!data.type || !['watering', 'fertilizing'].includes(data.type)) {
    return 'Valid type (watering or fertilizing) is required';
  }
  if (!data.time || !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(data.time)) {
    return 'Valid time in HH:MM format is required';
  }
  
  if (data.type === 'watering') {
    if (!Array.isArray(data.days) || data.days.length === 0) {
      return 'At least one day of the week is required for watering schedule';
    }
    data.calendarDays = [];
  }
  
  if (data.type === 'fertilizing') {
    if (!Array.isArray(data.calendarDays) || data.calendarDays.length === 0) {
      return 'At least one calendar day is required for fertilizing schedule';
    }
    
    for (const day of data.calendarDays) {
      const dayNum = parseInt(day);
      if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
        return 'Calendar days must be numbers between 1 and 31';
      }
    }
    data.days = [];
  }
  
  if (typeof data.duration !== 'number' || data.duration < 1 || data.duration > 60) {
    return 'Duration must be between 1 and 60 minutes';
  }
  
  return null;
}

module.exports = {
  validateAuditLog,
  sanitizeAuditLog,
  validateScheduleData
};
