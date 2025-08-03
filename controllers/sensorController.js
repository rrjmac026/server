const SensorService = require('../services/sensorService');

class SensorController {
    /**
     * Receive sensor data from ESP32
     */
    static async receiveSensorData(req, res) {
        try {
            const result = await SensorService.saveSensorData(req.body);
            
            res.status(201).json({ 
                message: "Sensor data saved", 
                id: result.id,
                success: true
            });
        } catch (error) {
            console.error("❌ Error saving sensor data:", error.message);
            res.status(400).json({ 
                error: error.message,
                success: false
            });
        }
    }

    /**
     * Get latest sensor data for a plant
     */
    static async getLatestSensorData(req, res) {
        try {
            const { plantId } = req.query;
            
            if (!plantId) {
                return res.status(400).json({ error: "Missing plantId" });
            }

            const sensorData = await SensorService.getLatestReading(plantId);
            res.json(sensorData);
        } catch (error) {
            console.error("❌ Error fetching sensor data:", error.message);
            res.status(500).json({ 
                error: "Failed to load sensor data",
                ...SensorService.getOfflineResponse()
            });
        }
    }

    /**
     * Get latest sensor data by plant ID (alternative endpoint)
     */
    static async getLatestByPlantId(req, res) {
        try {
            const { plantId } = req.params;
            console.log(`📡 Fetching latest sensor data for plant ${plantId}`);

            const sensorData = await SensorService.getLatestReading(plantId);
            
            if (!sensorData.timestamp) {
                return res.status(404).json({ 
                    error: 'No sensor data found',
                    moisture: 0, 
                    temperature: 0, 
                    humidity: 0, 
                    moistureStatus: "NO_DATA" 
                });
            }

            // Format for this specific endpoint
            const response = {
                moisture: sensorData.moisture || 0,
                temperature: sensorData.temperature || 0,
                humidity: sensorData.humidity || 0,
                moistureStatus: sensorData.moistureStatus || "NO_DATA",
                timestamp: sensorData.timestamp
            };

            res.json(response);
        } catch (error) {
            console.error("❌ Error fetching latest sensor data:", error.message);
            res.status(500).json({ error: "Failed to load sensor data" });
        }
    }

    /**
     * Get sensor readings within date range
     */
    static async getSensorReadings(req, res) {
        try {
            const { plantId, start, end } = req.query;
            
            if (!plantId || !start || !end) {
                return res.status(400).json({
                    error: "Missing required parameters: plantId, start, end"
                });
            }

            const readings = await SensorService.getReadingsInRange(plantId, start, end);
            const stats = await SensorService.getSensorStats(plantId, start, end);
            
            res.json({
                success: true,
                plantId,
                period: { start, end },
                totalReadings: readings.length,
                readings,
                statistics: stats
            });
        } catch (error) {
            console.error("❌ Error fetching sensor readings:", error.message);
            res.status(500).json({ 
                error: "Failed to fetch sensor readings",
                success: false
            });
        }
    }

    /**
     * Get sensor health status
     */
    static async getSensorHealth(req, res) {
        try {
            const { plantId } = req.params;
            const healthStatus = await SensorService.getSensorHealth(plantId);
            
            res.json({
                success: true,
                ...healthStatus
            });
        } catch (error) {
            console.error("❌ Error getting sensor health:", error.message);
            res.status(500).json({ 
                error: "Failed to get sensor health status",
                success: false
            });
        }
    }

    /**
     * Get sensor statistics
     */
    static async getSensorStats(req, res) {
        try {
            const { plantId } = req.params;
            const { start, end, days = 7 } = req.query;
            
            let startDate, endDate;
            if (start && end) {
                startDate = start;
                endDate = end;
            } else {
                endDate = new Date().toISOString().split('T')[0];
                startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            }

            const stats = await SensorService.getSensorStats(plantId, startDate, endDate);
            
            res.json({
                success: true,
                plantId,
                period: { start: startDate, end: endDate },
                statistics: stats
            });
        } catch (error) {
            console.error("❌ Error getting sensor statistics:", error.message);
            res.status(500).json({ 
                error: "Failed to get sensor statistics",
                success: false
            });
        }
    }

    /**
     * Check if sensor is online
     */
    static async checkSensorStatus(req, res) {
        try {
            const { plantId } = req.params;
            const isOnline = await SensorService.isSensorOnline(plantId);
            
            res.json({
                success: true,
                plantId,
                isOnline,
                status: isOnline ? 'online' : 'offline',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error("❌ Error checking sensor status:", error.message);
            res.status(500).json({ 
                error: "Failed to check sensor status",
                success: false,
                isOnline: false
            });
        }
    }
}

module.exports = SensorController;