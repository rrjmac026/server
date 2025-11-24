require('../setup');
const request = require('supertest');
const express = require('express');
const sensorRoutes = require('../../routes/sensor');
const { getCollection } = require('../../config/database');

describe('Sensor Routes', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', sensorRoutes);
  });

  describe('POST /api/sensor-data', () => {
    it('should save sensor data successfully', async () => {
      const sensorData = {
        plantId: 'plant-001',
        moisture: 500,
        temperature: 25,
        humidity: 60,
        waterState: true,
        fertilizerState: false
      };

      const response = await request(app)
        .post('/api/sensor-data')
        .send(sensorData)
        .expect(201);

      expect(response.body.message).toBe('Sensor data saved');
      expect(response.body.id).toBeDefined();
    });

    it('should reject incomplete sensor data', async () => {
      const incompleteSensorData = {
        plantId: 'plant-001',
        moisture: 500
        // missing other required fields
      };

      const response = await request(app)
        .post('/api/sensor-data')
        .send(incompleteSensorData)
        .expect(400);

      expect(response.body.error).toContain('Incomplete');
    });

    it('should create audit log entry', async () => {
      const sensorData = {
        plantId: 'plant-001',
        moisture: 500,
        temperature: 25,
        humidity: 60,
        waterState: true,
        fertilizerState: false
      };

      await request(app)
        .post('/api/sensor-data')
        .send(sensorData);

      const auditCollection = await getCollection('audit_logs');
      const auditLog = await auditCollection.findOne({ plantId: 'plant-001' });

      expect(auditLog).toBeDefined();
      expect(auditLog.type).toBe('sensor');
      expect(auditLog.action).toBe('read');
    });
  });

  describe('GET /api/sensor-data', () => {
    beforeEach(async () => {
      const sensorCollection = await getCollection('sensor_data');
      await sensorCollection.insertOne({
        plantId: 'plant-001',
        moisture: 500,
        temperature: 25,
        humidity: 60,
        moistureStatus: 'HUMID',
        waterState: true,
        fertilizerState: false,
        isConnected: true,
        timestamp: new Date()
      });
    });

    it('should return latest sensor data', async () => {
      const response = await request(app)
        .get('/api/sensor-data?plantId=plant-001')
        .expect(200);

      expect(response.body.plantId).toBe('plant-001');
      expect(response.body.moisture).toBe(500);
      expect(response.body.isConnected).toBe(true);
    });

    it('should return 404 for missing plantId data', async () => {
      const response = await request(app)
        .get('/api/sensor-data?plantId=plant-999')
        .expect(404);

      expect(response.body.error).toContain('No sensor data found');
      expect(response.body.isConnected).toBe(false);
    });

    it('should require plantId parameter', async () => {
      const response = await request(app)
        .get('/api/sensor-data')
        .expect(400);

      expect(response.body.error).toContain('plantId');
    });
  });
});
