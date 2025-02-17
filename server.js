const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Handle Missing Firestore Credentials Gracefully
if (!process.env.FIREBASE_CREDENTIALS) {
  console.error("❌ FIREBASE_CREDENTIALS is missing. Make sure to set it in environment variables.");
  process.exit(1);
}

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Middleware
app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (Object.keys(req.body).length) {
    console.error("📩 Request Body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

// Health Check Route
app.get("/api/health", (req, res) => {
  res.json({ status: "Server is running" });
});

// Get All Plants
app.get("/api/plants", async (req, res) => {
  try {
    const plantsSnapshot = await db.collection("plants").get();
    const plants = plantsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json(plants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Store Sensor Data with Validation
app.post("/api/sensor-data", async (req, res) => {
  try {
    const { moisture, temperature, plantId } = req.body;
    if (typeof moisture !== "number" || typeof temperature !== "number" || typeof plantId !== "string") {
      return res.status(400).json({ error: "Invalid input data" });
    }
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("sensor_data").add({ moisture, temperature, plantId, timestamp });
    res.json({ message: "Sensor data recorded successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Plant Report with Index Check
app.get("/api/reports/:plantId", async (req, res) => {
  try {
    const { plantId } = req.params;
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: "Start and end date are required." });
    }
    
    // Check if Firestore index is ready
    const indexStatus = await db.collection("sensor_data")
      .where("plantId", "==", plantId)
      .orderBy("timestamp")
      .limit(1)
      .get()
      .then(() => "ready")
      .catch(error => (error.code === 9 ? "building" : "error"));

    if (indexStatus === "building") {
      return res.status(503).json({ error: "Database index is being built. Please try again later." });
    }

    // Query sensor data
    const startDate = new Date(start);
    const endDate = new Date(end);
    const snapshot = await db.collection("sensor_data")
      .where("plantId", "==", plantId)
      .where("timestamp", ">=", startDate)
      .where("timestamp", "<=", endDate)
      .orderBy("timestamp")
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "No data found for the specified period" });
    }

    // Calculate averages
    let totalMoisture = 0;
    let totalTemperature = 0;
    const readings = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      totalMoisture += data.moisture;
      totalTemperature += data.temperature;
      readings.push(data);
    });

    const report = {
      plantId,
      startDate,
      endDate,
      averageMoisture: totalMoisture / readings.length,
      averageTemperature: totalTemperature / readings.length,
      wateringCount: readings.length,
      fertilizingCount: 0,
      historicalData: readings,
    };
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: "Error generating report: " + error.message });
  }
});

// Handle JSON Parsing Errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError) {
    return res.status(400).json({ error: "Invalid JSON format" });
  }
  next();
});

// Start Express Server
app.listen(port, () => {
  console.error(`🚀 Server running on port ${port}`);
});
