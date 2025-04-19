const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const PDFDocument = require("pdfkit");

const app = express();
const port = process.env.PORT || 3000;

// ✅ Firestore Credentials Check
if (!process.env.FIREBASE_CREDENTIALS) {
  console.error("❌ FIREBASE_CREDENTIALS missing! Set it in environment variables.");
  process.exit(1);
}

// ✅ Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();

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
  const docRef = await db.collection("sensor_data").add({
    ...data,
    timestamp: admin.firestore.Timestamp.now()
  });
  return docRef;
}

async function getLatestReading(plantId) {
  const snapshot = await db.collection("sensor_data")
    .where("plantId", "==", plantId)
    .orderBy("timestamp", "desc")
    .limit(1)
    .get();
  
  return snapshot.empty ? null : snapshot.docs[0].data();
}

// Function to determine moisture status
function getMoistureStatus(moisture) {
  if (moisture >= 70) return "WET";
  if (moisture >= 40) return "MOIST";
  return "DRY";
}

// Add new helper functions
async function getReadingsInRange(plantId, startDate, endDate) {
  const snapshot = await db.collection("sensor_data")
    .where("plantId", "==", plantId)
    .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(new Date(startDate)))
    .where("timestamp", "<=", admin.firestore.Timestamp.fromDate(new Date(endDate)))
    .orderBy("timestamp", "desc")
    .get();

  return snapshot.docs.map(doc => ({
    ...doc.data(),
    id: doc.id,
    timestamp: doc.data().timestamp.toDate()
  }));
}

function calculateStats(readings) {
  return readings.reduce((stats, reading) => {
    stats.totalTemperature += reading.temperature || 0;
    stats.totalHumidity += reading.humidity || 0;
    stats.totalMoisture += reading.moisture || 0;
    stats.moistureStatus[reading.moistureStatus.toLowerCase()]++;
    stats.waterStateCount += reading.waterState ? 1 : 0;
    stats.fertilizerStateCount += reading.fertilizerState ? 1 : 0;
    return stats;
  }, {
    totalTemperature: 0,
    totalHumidity: 0,
    totalMoisture: 0,
    moistureStatus: { dry: 0, moist: 0, wet: 0 },
    waterStateCount: 0,
    fertilizerStateCount: 0
  });
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
      timestamp: latestReading.timestamp.toDate().toISOString()
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
    const { plantId, start, end, format = 'pdf' } = req.query;
    
    if (!plantId || !start || !end) {
      return res.status(400).json({
        error: "Missing parameters",
        example: "/api/reports?plantId=123&start=2024-01-01&end=2024-01-31&format=pdf|json"
      });
    }

    const readings = await getReadingsInRange(plantId, start, end);
    
    if (readings.length === 0) {
      return res.status(404).json({ error: "No data found" });
    }

    const stats = calculateStats(readings);
    const count = readings.length;

    // Return JSON if requested
    if (format === 'json') {
      return res.json({ readings, stats });
    }

    // Generate PDF report
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
    
    doc.pipe(res);

    // Enhanced PDF content
    doc.fontSize(24).text('Plant Monitoring Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12)
      .text(`Plant ID: ${plantId}`)
      .text(`Report Period: ${new Date(start).toLocaleDateString()} to ${new Date(end).toLocaleDateString()}`)
      .text(`Total Readings: ${count}`);
    doc.moveDown();

    // Add statistics
    doc.fontSize(14).text('Statistics:', { underline: true });
    doc.fontSize(12)
      .text(`Average Temperature: ${(stats.totalTemperature / count).toFixed(2)}°C`)
      .text(`Average Humidity: ${(stats.totalHumidity / count).toFixed(2)}%`)
      .text(`Average Moisture: ${(stats.totalMoisture / count).toFixed(2)}%`)
      .text(`Water System Activations: ${stats.waterStateCount}`)
      .text(`Fertilizer System Activations: ${stats.fertilizerStateCount}`);
    doc.moveDown();

    // Add readings
    doc.fontSize(14).text('Recent Readings:', { underline: true });
    readings.slice(0, 10).forEach((reading, index) => {
      doc.fontSize(12)
        .text(`Time: ${reading.timestamp.toLocaleString()}`)
        .text(`Temperature: ${reading.temperature}°C`)
        .text(`Humidity: ${reading.humidity}%`)
        .text(`Moisture: ${reading.moisture}%`)
        .text(`Status: ${reading.moistureStatus}`)
        .text(`Water: ${reading.waterState ? "ON" : "OFF"}`)
        .text(`Fertilizer: ${reading.fertilizerState ? "ON" : "OFF"}`);
      doc.moveDown();
    });

    doc.end();

  } catch (error) {
    console.error("❌ Report generation error:", error);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// Add new report endpoints
app.get("/api/reports/stats", async (req, res) => {
  try {
    const { plantId, start, end } = req.query;
    
    if (!plantId || !start || !end) {
      return res.status(400).json({
        error: "Missing parameters",
        example: "/api/reports/stats?plantId=123&start=2024-01-01&end=2024-01-31"
      });
    }

    const readings = await getReadingsInRange(plantId, start, end);
    
    if (readings.length === 0) {
      return res.status(404).json({ error: "No data found" });
    }

    const stats = calculateStats(readings);
    const count = readings.length;

    res.json({
      period: { start, end },
      readingCount: count,
      averages: {
        temperature: stats.totalTemperature / count,
        humidity: stats.totalHumidity / count,
        moisture: stats.totalMoisture / count
      },
      moistureStatus: stats.moistureStatus,
      systemStats: {
        waterActivations: stats.waterStateCount,
        fertilizerActivations: stats.fertilizerStateCount
      },
      lastReading: readings[0]
    });

  } catch (error) {
    console.error("❌ Error generating stats:", error);
    res.status(500).json({ error: "Failed to generate stats" });
  }
});

// ✅ Start the Server
app.listen(port, () => {
  console.log(`✅ Server started at http://localhost:${port}`);
});
