const {
  validateAuditLog,
  sanitizeAuditLog,
  validateScheduleData
} = require('../../helpers/validation');

describe('Validation Helpers', () => {
  
  describe('validateAuditLog', () => {
    it('should return null for valid audit log', () => {
      const data = {
        plantId: 'plant-123',
        type: 'sensor',
        action: 'read'
      };
      expect(validateAuditLog(data)).toBeNull();
    });

    it('should return error for missing plantId', () => {
      const data = {
        type: 'sensor',
        action: 'read'
      };
      expect(validateAuditLog(data)).toContain('plantId');
    });

    it('should return error for missing type', () => {
      const data = {
        plantId: 'plant-123',
        action: 'read'
      };
      expect(validateAuditLog(data)).toContain('type');
    });

    it('should return error for missing action', () => {
      const data = {
        plantId: 'plant-123',
        type: 'sensor'
      };
      expect(validateAuditLog(data)).toContain('action');
    });
  });

  describe('sanitizeAuditLog', () => {
    it('should convert type and action to lowercase', () => {
      const log = {
        plantId: 'plant-123',
        type: 'SENSOR',
        action: 'READ',
        status: 'SUCCESS'
      };
      const sanitized = sanitizeAuditLog(log);
      expect(sanitized.type).toBe('sensor');
      expect(sanitized.action).toBe('read');
      expect(sanitized.status).toBe('success');
    });

    it('should set default status to success', () => {
      const log = {
        plantId: 'plant-123',
        type: 'sensor',
        action: 'read'
      };
      const sanitized = sanitizeAuditLog(log);
      expect(sanitized.status).toBe('success');
    });

    it('should set timestamp if not provided', () => {
      const log = {
        plantId: 'plant-123',
        type: 'sensor',
        action: 'read'
      };
      const sanitized = sanitizeAuditLog(log);
      expect(sanitized.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('validateScheduleData', () => {
    it('should validate watering schedule', () => {
      const data = {
        plantId: 'plant-123',
        type: 'watering',
        time: '08:00',
        days: ['Monday', 'Wednesday', 'Friday'],
        duration: 30
      };
      expect(validateScheduleData(data)).toBeNull();
    });

    it('should validate fertilizing schedule', () => {
      const data = {
        plantId: 'plant-123',
        type: 'fertilizing',
        time: '09:00',
        calendarDays: [1, 15],
        duration: 15
      };
      expect(validateScheduleData(data)).toBeNull();
    });

    it('should reject invalid time format', () => {
      const data = {
        plantId: 'plant-123',
        type: 'watering',
        time: '25:00',
        days: ['Monday'],
        duration: 30
      };
      expect(validateScheduleData(data)).toContain('time');
    });

    it('should reject duration outside range', () => {
      const data = {
        plantId: 'plant-123',
        type: 'watering',
        time: '08:00',
        days: ['Monday'],
        duration: 120
      };
      expect(validateScheduleData(data)).toContain('Duration');
    });
  });
});
