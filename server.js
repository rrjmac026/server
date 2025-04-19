const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const WebSocket = require("ws");
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

// ==========================
// 🌱 Default Plant Handling
// ==========================
let defaultPlantId = null;

async function initializeDefaultPlant() {
  try {
    const plantsSnapshot = await db.collection("plants").limit(1).get();
    
    if (plantsSnapshot.empty) {
      console.log("🌱 Creating initial default plant...");
      const defaultPlant = {
        name: "Default Plant",
        type: "Indoor Plant",
        description: "Default monitoring plant",
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      };
      
      const docRef = await db.collection("plants").add(defaultPlant);
      defaultPlantId = docRef.id;
      console.log(`✅ Created default plant with ID: ${defaultPlantId}`);
    } else {
      defaultPlantId = plantsSnapshot.docs[0].id;
      console.log(`✅ Using existing plant with ID: ${defaultPlantId}`);
    }
  } catch (error) {
    console.error("❌ Error initializing default plant:", error);
  }
}

// Function to determine moisture status
function getMoistureStatus(moisture) {
  if (moisture >= 70) return "WET";
  if (moisture >= 40) return "MOIST";
  return "DRY";
}

// ==========================
// ✅ WebSocket Setup
// ==========================
const wss = new WebSocket.Server({ noServer: true });

// Handle WebSocket connections
wss.on("connection", (ws) => {
  console.log("New WebSocket client connected");

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

// Broadcast sensor data to all connected clients
function broadcastSensorData(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ==========================
// ✅ Receive Sensor Data
// ==========================
app.post("/api/sensor-data", async (req, res) => {
  try {
    console.log("📩 Received Sensor Data:", req.body);
    let { moisture, temperature, humidity, plantId, moistureStatus } = req.body;

    // Ensure default plant is initialized
    if (!defaultPlantId) {
      await initializeDefaultPlant();
    }

    // Use default plant ID if none provided
    if (!plantId) {
      plantId = defaultPlantId;
    }

    if (!plantId) {
      return res.status(400).json({ error: "❌ No plant ID available" });
    }

    const sensorData = {
      moisture: moisture || 0,
      temperature: temperature || 0,
      humidity: humidity || 0,
      plantId,
      moistureStatus: moistureStatus || getMoistureStatus(moisture),
      timestamp: admin.firestore.Timestamp.now(),
    };

    const docRef = await db.collection("sensor_data").add(sensorData);
    console.log(`✅ Data stored in Firestore! (Doc ID: ${docRef.id})`);

    // Broadcast to all connected clients
    broadcastSensorData(sensorData);

    res.json({
      message: "✅ Sensor data recorded successfully",
      plantId: plantId,
    });
  } catch (error) {
    console.error("❌ Error storing data:", error.message);
    res.status(500).json({ error: "❌ Internal Server Error: " + error.message });
  }
});

// ==========================
// ✅ Get Latest Sensor Data
// ==========================
app.get("/api/plants/:plantId/latest-sensor-data", async (req, res) => {
  try {
    const { plantId } = req.params;
    console.log(`📡 Fetching latest sensor data for plant ${plantId}`);

    const latestReadingQuery = await db.collection("sensor_data")
      .where("plantId", "==", plantId)
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    if (latestReadingQuery.empty) {
      return res.status(404).json({ 
        error: 'No sensor data found',
        moisture: 0, 
        temperature: 0, 
        humidity: 0, 
        moistureStatus: "NO_DATA" 
      });
    }

    const latestReading = latestReadingQuery.docs[0].data();
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
app.post("/api/reports", async (req, res) => {
  try {
    const { plantId, startDate, endDate } = req.body;
    
    console.log(`📊 Generating report for plant ${plantId}`);
    console.log(`📅 Date range: ${startDate} to ${endDate}`);

    if (!plantId || !startDate || !endDate) {
      return res.status(400).json({ error: "Plant ID, start date, and end date are required" });
    }

    // Retrieve sensor data for date range
    const snapshot = await db.collection("sensor_data")
      .where("plantId", "==", plantId)
      .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(new Date(startDate)))
      .where("timestamp", "<=", admin.firestore.Timestamp.fromDate(new Date(endDate)))
      .orderBy("timestamp", "desc")
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "No data found for the selected range" });
    }

    // Process readings
    let readings = [];
    let totalTemperature = 0, totalMoisture = 0, totalHumidity = 0;
    let moistureStats = { dry: 0, moist: 0, wet: 0 };
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      readings.push({
        ...data,
        timestamp: data.timestamp.toDate()
      });
      
      totalTemperature += data.temperature || 0;
      totalMoisture += data.moisture || 0;
      totalHumidity += data.humidity || 0;
      
      if (data.moistureStatus === 'DRY') moistureStats.dry++;
      if (data.moistureStatus === 'MOIST') moistureStats.moist++;
      if (data.moistureStatus === 'WET') moistureStats.wet++;
    });

    const reportData = {
      plantId,
      plantName: "Plant Monitor Report",
      readingsCount: readings.length,
      averageTemperature: readings.length ? totalTemperature / readings.length : 0,
      averageMoisture: readings.length ? totalMoisture / readings.length : 0,
      averageHumidity: readings.length ? totalHumidity / readings.length : 0,
      moistureStats,
      readings,
    };

    // Generate and send PDF
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
    
    doc.pipe(res);

    // Add content to PDF
    doc.fontSize(24).text('Plant Monitoring Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Report Period: ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`);
    doc.moveDown();
    
    // Add readings
    doc.fontSize(14).text('Sensor Readings');
    doc.moveDown();
    
    readings.forEach(reading => {
      doc.text(`Date: ${reading.timestamp.toLocaleDateString()}`);
      doc.text(`Temperature: ${reading.temperature}°C`);
      doc.text(`Moisture: ${reading.moisture}%`);
      doc.text(`Humidity: ${reading.humidity}%`);
      doc.moveDown();
    });

    doc.end();

  } catch (error) {
    console.error("❌ Error generating report:", error);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// ✅ Start the Server
const server = app.listen(port, () => {
  console.log(`✅ Server started at http://localhost:${port}`);
});

// Handle upgrade requests for WebSocket
server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});
