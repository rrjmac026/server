require('../setup');
const request = require('supertest');
const express = require('express');
const auditRoutes = require('../../routes/audit');
const { getCollection } = require('../../config/database');

describe('Audit Routes', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', auditRoutes);
  });

  describe('POST /api/audit-logs', () => {
    it('should create audit log', async () => {
      const auditData = {
        plantId: 'plant-001',
        type: 'sensor',
        action: 'read',
        status: 'success',
        details: 'Test audit log'
      };

      const response = await request(app)
        .post('/api/audit-logs')
        .send(auditData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.id).toBeDefined();
    });

    it('should reject missing required fields', async () => {
      const invalidData = {
        plantId: 'plant-001'
        // missing type and action
      };

      const response = await request(app)
        .post('/api/audit-logs')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/audit-logs', () => {
    beforeEach(async () => {
      const collection = await getCollection('audit_logs');
      await collection.insertMany([
        {
          plantId: 'plant-001',
          type: 'sensor',
          action: 'read',
          status: 'success',
          timestamp: new Date()
        },
        {
          plantId: 'plant-001',
          type: 'schedule',
          action: 'execute',
          status: 'success',
          timestamp: new Date()
        }
      ]);
    });

    it('should retrieve audit logs', async () => {
      const response = await request(app)
        .get('/api/audit-logs')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.logs.length).toBeGreaterThan(0);
    });

    it('should filter by plantId', async () => {
      const response = await request(app)
        .get('/api/audit-logs?plantId=plant-001')
        .expect(200);

      expect(response.body.logs.every(log => log.plantId === 'plant-001')).toBe(true);
    });

    it('should filter by type', async () => {
      const response = await request(app)
        .get('/api/audit-logs?type=sensor')
        .expect(200);

      expect(response.body.logs.every(log => log.type === 'sensor')).toBe(true);
    });
  });

  describe('GET /api/audit-logs/types', () => {
    beforeEach(async () => {
      const collection = await getCollection('audit_logs');
      await collection.insertMany([
        { plantId: 'plant-001', type: 'sensor', action: 'read', status: 'success', timestamp: new Date() },
        { plantId: 'plant-001', type: 'schedule', action: 'execute', status: 'success', timestamp: new Date() }
      ]);
    });

    it('should return distinct log types', async () => {
      const response = await request(app)
        .get('/api/audit-logs/types')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.types).toContain('sensor');
      expect(response.body.types).toContain('schedule');
    });
  });
});
