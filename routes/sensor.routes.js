const express = require('express');
const router = express.Router();
const sensorController = require('../controllers/sensor.controller');

router.post('/sensor-data', sensorController.createSensorData);
router.get('/sensor-data', sensorController.getSensorData);
router.get('/plants/:plantId/latest-sensor-data', sensorController.getLatestSensorData);

module.exports = router;