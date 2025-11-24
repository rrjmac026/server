require('../setup');
const request = require('supertest');
const express = require('express');
const sensorRoutes = require('../../routes/sensor');
const auditRoutes = require('../../routes/audit');

describe('E2E: Complete Workflow', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', sensorRoutes);
    app.use('/', auditRoutes);
  });

  it('should complete full sensor data flow', async () => {
    // Step 1: Send sensor data
    const sensorData = {
      plantId: 'plant-e2e-001',
      moisture: 500,
      temperature: 25,
      humidity: 60,
      waterState: true,
      fertilizerState: false
    };

    const postResponse = await request(app)
      .post('/api/sensor-data')
      .send(sensorData)
      .expect(201);

    expect(postResponse.body.id).toBeDefined();

    // Step 2: Retrieve sensor data
    const getResponse = await request(app)
      .get('/api/sensor-data?plantId=plant-e2e-001')
      .expect(200);

    expect(getResponse.body.moisture).toBe(500);
    expect(getResponse.body.isConnected).toBe(true);

    // Step 3: Verify audit log was created
    const auditResponse = await request(app)
      .get('/api/audit-logs?plantId=plant-e2e-001&type=sensor')
      .expect(200);

    expect(auditResponse.body.logs.length).toBeGreaterThan(0);
    expect(auditResponse.body.logs[0].type).toBe('sensor');
  });
});
