const express = require('express');
const SensorController = require('../controllers/sensorController');

const router = express.Router();

// ✅ Receive POST Sensor Data (from ESP32)
router.post('/sensor-data', SensorController.receiveSensorData);

// ✅ Get Latest Sensor Data (query parameter)
router.get('/sensor-data', SensorController.getLatestSensorData);

// ✅ Get Latest Sensor Data by Plant ID (URL parameter)
router.get('/plants/:plantId/latest-sensor-data', SensorController.getLatestByPlantId);

// ✅ Get sensor readings within date range
router.get('/plants/:plantId/sensor-readings', SensorController.getSensorReadings);

// ✅ Get sensor health status
router.get('/plants/:plantId/sensor-health', SensorController.getSensorHealth);

// ✅ Get sensor statistics
router.get('/plants/:plantId/sensor-stats', SensorController.getSensorStats);

// ✅ Check if sensor is online
router.get('/plants/:plantId/sensor-status', SensorController.checkSensorStatus);

module.exports = router;