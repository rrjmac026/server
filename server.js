const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const PDFDocument = require("pdfkit");

const app = express();
const port = process.env.PORT || 3000;

// ✅ Check if Firestore credentials exist
if (!process.env.FIREBASE_CREDENTIALS) {
  console.error("❌ FIREBASE_CREDENTIALS is missing. Set it in environment variables.");
  process.exit(1);
}

// ✅ Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();

// ==========================
// 🔧 Middleware Setup
// ==========================
app.use(cors({ origin: "*" })); // ✅ Allow requests from any origin (ESP32)
app.use(express.json()); // ✅ Enable JSON request parsing
app.use(express.urlencoded({ extended: true })); // ✅ Enable URL-encoded request parsing

// ✅ Default Route (Fix for "Cannot GET /")
app.get("/", (req, res) => {
  res.send("🚀 Welcome to the Plant Monitoring API! Use the correct endpoints.");
});

// ✅ Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "✅ Server is running" });
});

// ==========================
// ✅ Receive Sensor Data from ESP32
// ==========================
app.post("/api/sensor-data", async (req, res) => {
  try {
    console.log("📩 Received Sensor Data:", req.body);

    const { moisture, temperature, humidity, plantId, moistureStatus } = req.body;
    if (!moisture || !temperature || !humidity || !plantId || !moistureStatus) {
      return res.status(400).json({ error: "❌ Invalid input data" });
    }

    await db.collection("sensor_data").add({
      moisture, temperature, humidity, plantId, moistureStatus,
      timestamp: admin.firestore.Timestamp.now(),
    });

    console.log("✅ Data stored in Firestore!");
    res.json({ message: "Sensor data recorded successfully" });
  } catch (error) {
    console.error("❌ Error storing data:", error);
    res.status(500).json({ error: error.message });
  }
});


// ==========================
// ✅ Get All Plants
// ==========================
app.get("/api/plants", async (req, res) => {
  try {
    console.log("📡 Fetching all plants...");
    const plantsSnapshot = await db.collection("plants").get();

    if (plantsSnapshot.empty) {
      console.log("⚠️ No plants found");
      return res.json([]);
    }

    const plants = plantsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    console.log(`✅ Found ${plants.length} plants`);
    res.json(plants);
  } catch (error) {
    console.error("❌ Error fetching plants:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get Single Plant Data
app.get("/api/plants/:plantId", async (req, res) => {
  try {
    const { plantId } = req.params;
    console.log(`📡 Fetching plant ${plantId}`);

    const plantDoc = await db.collection("plants").doc(plantId).get();

    if (!plantDoc.exists) {
      console.error(`⚠️ Plant ${plantId} not found`);
      return res.status(404).json({ error: "Plant not found" });
    }

    const plant = { id: plantDoc.id, ...plantDoc.data() };
    console.log(`✅ Found plant ${plantId}`);
    res.json(plant);
  } catch (error) {
    console.error("❌ Error fetching plant:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================
// ✅ Generate Reports
// ==========================
app.get("/api/reports/:plantId", async (req, res) => {
  try {
    const { plantId } = req.params;
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "❌ Start and end date are required." });
    }

    console.log(`📊 Generating report for plant ${plantId} from ${start} to ${end}`);

    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    const snapshot = await db
      .collection("sensor_data")
      .where("plantId", "==", plantId)
      .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(startDate))
      .where("timestamp", "<=", admin.firestore.Timestamp.fromDate(endDate))
      .orderBy("timestamp")
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "No data found for the specified period" });
    }

    const readings = snapshot.docs.map((doc) => doc.data());

    res.json({
      plantId,
      startDate,
      endDate,
      totalReadings: readings.length,
      historicalData: readings,
    });
  } catch (error) {
    console.error("❌ Error generating report:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================
// ✅ Test Data Setup
// ==========================
app.post("/api/setup-test-data", async (req, res) => {
  try {
    console.log("🔄 Setting up test data...");

    await db.collection("plants").doc("plant123").set({
      name: "Test Plant",
      type: "Indoor Plant",
      userId: "testuser",
      lastWatered: Date.now(),
      soilMoisture: 65,
      temperature: 22,
    });

    console.log("✅ Test data created");
    res.json({ message: "✅ Test data created successfully" });
  } catch (error) {
    console.error("❌ Error setting up test data:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================
// 🚀 Start Server
// ==========================
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
