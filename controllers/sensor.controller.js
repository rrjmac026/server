const sensorService = require('../services/sensor.service');

exports.createSensorData = async (req, res) => {
  try {
    const data = req.body;

    if (!data.plantId || data.moisture == null || data.temperature == null || 
        data.humidity == null || data.waterState == null || data.fertilizerState == null) {
      return res.status(400).json({ error: "Incomplete sensor data" });
    }

    const result = await sensorService.saveSensorData(data);
    res.status(201).json({ message: "Sensor data saved", id: result.insertedId });
  } catch (error) {
    console.error("❌ Error saving sensor data:", error.message);
    res.status(500).json({ error: "Failed to save sensor data" });
  }
};

exports.getSensorData = async (req, res) => {
  try {
    const { plantId } = req.query;
    if (!plantId) {
      return res.status(400).json({ error: "Missing plantId" });
    }

    const latestReading = await sensorService.getLatestReading(plantId);

    if (!latestReading) {
      return res.status(404).json({
        error: 'No sensor data found',
        moisture: 0,
        temperature: 0,
        humidity: 0,
        moistureStatus: "OFFLINE",
        waterState: false,
        fertilizerState: false,
        isOnline: false,
        isConnected: false,
        timestamp: null
      });
    }

    const response = sensorService.formatSensorResponse(latestReading);
    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching sensor data:", error.message);
    res.status(500).json({ error: "Failed to load sensor data" });
  }
};

exports.getLatestSensorData = async (req, res) => {
  try {
    const { plantId } = req.params;
    const latestReading = await sensorService.getLatestReading(plantId);

    if (!latestReading) {
      return res.status(404).json({ 
        error: 'No sensor data found',
        moisture: 0, 
        temperature: 0, 
        humidity: 0, 
        moistureStatus: "NO_DATA" 
      });
    }

    const response = sensorService.formatSensorResponse(latestReading);
    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching latest sensor data:", error.message);
    res.status(500).json({ error: "Failed to load sensor data" });
  }
};