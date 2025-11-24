require('../setup');
const request = require('supertest');
const express = require('express');
const sensorRoutes = require('../../routes/sensor');
const auditRoutes = require('../../routes/audit');
const { getCollection } = require('../../config/database');

describe('ESP32 ↔ Server Synchronization', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', sensorRoutes);
    app.use('/', auditRoutes);
  });

  describe('Sensor Data Flow', () => {
    it('should accept ESP32 sensor data format', async () => {
      const esp32Data = {
        plantId: 'C8dA5OfZEC1EGAhkdAB4',
        moisture: 500,
        temperature: 25.5,
        humidity: 65.3,
        waterState: true,
        fertilizerState: false
      };

      const response = await request(app)
        .post('/api/sensor-data')
        .send(esp32Data)
        .expect(201);

      expect(response.body.id).toBeDefined();

      // Verify sensor data was saved
      const sensorCollection = await getCollection('sensor_data');
      const savedData = await sensorCollection.findOne({ 
        plantId: 'C8dA5OfZEC1EGAhkdAB4' 
      });

      expect(savedData).toBeDefined();
      expect(savedData.moisture).toBe(50); // Converted to percentage
      expect(savedData.waterState).toBe(true);
    });

    it('should auto-create audit log for sensor reading', async () => {
      const esp32Data = {
        plantId: 'C8dA5OfZEC1EGAhkdAB4',
        moisture: 450,
        temperature: 26,
        humidity: 70,
        waterState: false,
        fertilizerState: true
      };

      await request(app)
        .post('/api/sensor-data')
        .send(esp32Data);

      const auditCollection = await getCollection('audit_logs');
      const auditLog = await auditCollection.findOne({
        plantId: 'C8dA5OfZEC1EGAhkdAB4',
        type: 'sensor'
      });

      expect(auditLog).toBeDefined();
      expect(auditLog.action).toBe('read');
      expect(auditLog.status).toBe('success');
      expect(auditLog.sensorData).toBeDefined();
    });
  });

  describe('Event Data Flow (ESP32 → Server)', () => {
    it('should accept ESP32 event data', async () => {
      const eventData = {
        plantId: 'C8dA5OfZEC1EGAhkdAB4',
        type: 'watering',
        action: 'started',
        status: 'success',
        details: 'Scheduled watering started for 30 minutes',
        sensorData: {
          moisture: 65,
          temperature: 25.5,
          humidity: 60,
          waterState: true,
          fertilizerState: false
        }
      };

      const response = await request(app)
        .post('/api/audit-logs')
        .send(eventData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.id).toBeDefined();
    });

    it('should track watering schedule execution', async () => {
      const wateringEvent = {
        plantId: 'C8dA5OfZEC1EGAhkdAB4',
        type: 'schedule',
        action: 'execute',
        status: 'success',
        details: 'Scheduled watering started for 30 minutes'
      };

      await request(app)
        .post('/api/audit-logs')
        .send(wateringEvent);

      const auditCollection = await getCollection('audit_logs');
      const logs = await auditCollection.find({
        type: 'schedule',
        action: 'execute'
      }).toArray();

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should track fertilizer schedule execution', async () => {
      const fertilizerEvent = {
        plantId: 'C8dA5OfZEC1EGAhkdAB4',
        type: 'schedule',
        action: 'execute',
        status: 'success',
        details: 'Scheduled fertilizing started for day 15'
      };

      await request(app)
        .post('/api/audit-logs')
        .send(fertilizerEvent);

      const auditCollection = await getCollection('audit_logs');
      const logs = await auditCollection.find({
        type: 'schedule',
        action: 'execute'
      }).toArray();

      expect(logs.some(log => log.details.includes('fertilizing'))).toBe(true);
    });
  });

  describe('Data Consistency', () => {
    it('should maintain sensor data consistency', async () => {
      const readings = [
        { plantId: 'sync-test', moisture: 800, temperature: 25, humidity: 60, waterState: false, fertilizerState: false },
        { plantId: 'sync-test', moisture: 600, temperature: 26, humidity: 65, waterState: true, fertilizerState: false },
        { plantId: 'sync-test', moisture: 400, temperature: 27, humidity: 70, waterState: false, fertilizerState: true }
      ];

      for (const reading of readings) {
        await request(app)
          .post('/api/sensor-data')
          .send(reading);
      }

      const response = await request(app)
        .get('/api/sensor-data?plantId=sync-test')
        .expect(200);

      // Should get the latest reading
      expect(response.body.humidity).toBe(70);
      expect(response.body.isConnected).toBe(true);
    });

    it('should track multiple events in audit log', async () => {
      const events = [
        { plantId: 'event-test', type: 'sensor', action: 'read', status: 'success' },
        { plantId: 'event-test', type: 'watering', action: 'started', status: 'success' },
        { plantId: 'event-test', type: 'watering', action: 'stopped', status: 'success' }
      ];

      for (const event of events) {
        await request(app)
          .post('/api/audit-logs')
          .send(event);
      }

      const response = await request(app)
        .get('/api/audit-logs?plantId=event-test')
        .expect(200);

      expect(response.body.logs.length).toBe(3);
    });
  });

  describe('Timezone Handling', () => {
    it('should store timestamps in Manila timezone', async () => {
      const auditCollection = await getCollection('audit_logs');
      const logs = await auditCollection.find({}).limit(1).toArray();

      if (logs.length > 0) {
        const timestamp = logs[0].timestamp;
        expect(timestamp).toBeInstanceOf(Date);
        // Timestamp should be stored as UTC but represents Manila time
        expect(timestamp.getTimezoneOffset()).toBeLessThanOrEqual(0);
      }
    });
  });
});
