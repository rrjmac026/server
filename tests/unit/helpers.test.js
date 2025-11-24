require('../setup');
const moment = require('moment-timezone');
const {
  getMoistureStatus,
  isSensorDataStale,
  calculateStats
} = require('../../helpers/sensor-helpers');

describe('Sensor Helpers', () => {
  
  describe('getMoistureStatus', () => {
    it('should return NO DATA for null/undefined', () => {
      expect(getMoistureStatus(null)).toBe('NO DATA');
      expect(getMoistureStatus(undefined)).toBe('NO DATA');
    });

    it('should return SENSOR ERROR for values >= 1000', () => {
      expect(getMoistureStatus(1000)).toBe('SENSOR ERROR');
      expect(getMoistureStatus(1023)).toBe('SENSOR ERROR');
    });

    it('should return DRY for values between 600-1000', () => {
      expect(getMoistureStatus(700)).toBe('DRY');
      expect(getMoistureStatus(601)).toBe('DRY');
    });

    it('should return HUMID for values between 370-600', () => {
      expect(getMoistureStatus(500)).toBe('HUMID');
      expect(getMoistureStatus(371)).toBe('HUMID');
    });

    it('should return WET for values <= 370', () => {
      expect(getMoistureStatus(370)).toBe('WET');
      expect(getMoistureStatus(100)).toBe('WET');
    });
  });

  describe('isSensorDataStale', () => {
    it('should return false for recent data', () => {
      const recentTime = moment().subtract(10, 'seconds');
      expect(isSensorDataStale(recentTime)).toBe(false);
    });

    it('should return true for old data', () => {
      const oldTime = moment().subtract(50, 'seconds');
      expect(isSensorDataStale(oldTime)).toBe(true);
    });

    it('should return false for data at 40 second boundary', () => {
      const boundaryTime = moment().subtract(40, 'seconds');
      expect(isSensorDataStale(boundaryTime)).toBe(false);
    });
  });

  describe('calculateStats', () => {
    it('should calculate stats correctly', () => {
      const readings = [
        {
          temperature: 25,
          humidity: 60,
          moisture: 500,
          moistureStatus: 'humid',
          waterState: true,
          fertilizerState: false
        },
        {
          temperature: 26,
          humidity: 65,
          moisture: 450,
          moistureStatus: 'humid',
          waterState: false,
          fertilizerState: true
        }
      ];

      const stats = calculateStats(readings);
      
      expect(stats.totalTemperature).toBe(51);
      expect(stats.totalHumidity).toBe(125);
      expect(stats.totalMoisture).toBe(950);
      expect(stats.waterStateCount).toBe(1);
      expect(stats.fertilizerStateCount).toBe(1);
    });

    it('should handle empty readings', () => {
      const stats = calculateStats([]);
      
      expect(stats.totalTemperature).toBe(0);
      expect(stats.totalHumidity).toBe(0);
      expect(stats.totalMoisture).toBe(0);
    });
  });
});
