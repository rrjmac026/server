const express = require("express");
const cors = require("cors");
const fs = require('fs').promises;
const path = require('path');
const PDFDocument = require("pdfkit");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Data storage paths
const DATA_DIR = path.join(__dirname, 'data');
const PLANTS_FILE = path.join(DATA_DIR, 'plants.json');
const SENSOR_DATA_FILE = path.join(DATA_DIR, 'sensor_data.json');

// Initialize data storage
async function initializeStorage() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    // Initialize plants file if it doesn't exist
    try {
      await fs.access(PLANTS_FILE);
    } catch {
      await fs.writeFile(PLANTS_FILE, JSON.stringify({ plants: [] }));
    }
    
    // Initialize sensor data file if it doesn't exist
    try {
      await fs.access(SENSOR_DATA_FILE);
    } catch {
      await fs.writeFile(SENSOR_DATA_FILE, JSON.stringify({ readings: [] }));
    }
  } catch (error) {
    console.error('Storage initialization error:', error);
    process.exit(1);
  }
}

// Initialize storage on startup
initializeStorage();

// ✅ Middleware Setup
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Default Route
app.get("/", (req, res) => {
  res.send("🚀 Welcome to the Plant Monitoring API! Use the correct endpoints.");
});

// ✅ Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "✅ Server is running" });
});

// Helper functions
async function saveSensorData(data) {
  const fileData = await fs.readFile(SENSOR_DATA_FILE, 'utf8');
  const sensorData = JSON.parse(fileData);
  sensorData.readings.push({
    ...data,
    timestamp: new Date().toISOString()
  });
  await fs.writeFile(SENSOR_DATA_FILE, JSON.stringify(sensorData, null, 2));
  return data;
}

async function getLatestReading(plantId) {
  const fileData = await fs.readFile(SENSOR_DATA_FILE, 'utf8');
  const sensorData = JSON.parse(fileData);
  return sensorData.readings
    .filter(r => r.plantId === plantId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
}

// Function to determine moisture status
function getMoistureStatus(moisture) {
  if (moisture >= 70) return "WET";
  if (moisture >= 40) return "MOIST";
  return "DRY";
}

// ==========================
// ✅ Receive Sensor Data
// ==========================
app.post("/api/sensor-data", async (req, res) => {
  try {
    const { moisture, temperature, humidity, plantId } = req.body;
    
    const sensorData = {
      moisture: moisture || 0,
      temperature: temperature || 0,
      humidity: humidity || 0,
      plantId,
      moistureStatus: getMoistureStatus(moisture)
    };

    await saveSensorData(sensorData);
    res.json({ message: "✅ Sensor data recorded successfully", plantId });
  } catch (error) {
    console.error("❌ Error storing data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ==========================
// ✅ Get Latest Sensor Data
// ==========================
app.get("/api/plants/:plantId/latest-sensor-data", async (req, res) => {
  try {
    const { plantId } = req.params;
    console.log(`📡 Fetching latest sensor data for plant ${plantId}`);

    const latestReading = await getLatestReading(plantId);

    if (!latestReading) {
      return res.status(404).json({ 
        error: 'No sensor data found',
        moisture: 0, 
        temperature: 0, 
        humidity: 0, 
        moistureStatus: "NO_DATA" 
      });
    }

    const response = {
      moisture: latestReading.moisture || 0,
      temperature: latestReading.temperature || 0,
      humidity: latestReading.humidity || 0,
      moistureStatus: latestReading.moistureStatus || "NO_DATA",
      timestamp: latestReading.timestamp
    };
    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching latest sensor data:", error.message);
    res.status(500).json({ error: "Failed to load sensor data" });
  }
});

// ==========================
// ✅ PDF Report Endpoint
// ==========================
app.get("/api/reports", async (req, res) => {
  try {
    const { plantId, start, end } = req.query;
    
    if (!plantId || !start || !end) {
      return res.status(400).json({
        error: "Missing parameters",
        required: {
          plantId: "string - The ID of the plant",
          start: "date - Start date (YYYY-MM-DD)",
          end: "date - End date (YYYY-MM-DD)"
        },
        example: "/api/reports?plantId=123&start=2024-01-01&end=2024-01-31"
      });
    }

    const fileData = await fs.readFile(SENSOR_DATA_FILE, 'utf8');
    const sensorData = JSON.parse(fileData);
    const readings = sensorData.readings.filter(r => 
      r.plantId === plantId &&
      new Date(r.timestamp) >= new Date(start) &&
      new Date(r.timestamp) <= new Date(end)
    );

    if (readings.length === 0) {
      return res.status(404).json({ 
        error: "No data found",
        plantId,
        start,
        end
      });
    }

    // Create basic PDF
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
    
    doc.pipe(res);

    // Add basic content
    doc.fontSize(24).text('Plant Monitoring Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12)
      .text(`Plant ID: ${plantId}`)
      .text(`Report Period: ${new Date(start).toLocaleDateString()} to ${new Date(end).toLocaleDateString()}`);
    doc.moveDown();

    readings.forEach((reading, index) => {
      doc.text(`Reading ${index + 1}:`);
      doc.text(`Moisture: ${reading.moisture}`);
      doc.text(`Temperature: ${reading.temperature}`);
      doc.text(`Humidity: ${reading.humidity}`);
      doc.text(`Moisture Status: ${reading.moistureStatus}`);
      doc.text(`Timestamp: ${new Date(reading.timestamp).toLocaleString()}`);
      doc.moveDown();
    });

    // End the document
    doc.end();

  } catch (error) {
    console.error("❌ Report generation error:", error);
    res.status(500).json({ 
      error: "Report generation failed",
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ✅ Start the Server
app.listen(port, () => {
  console.log(`✅ Server started at http://localhost:${port}`);
});
