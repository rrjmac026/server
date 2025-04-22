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

    // ✅ Fix: Explicitly check for undefined/null values (accepts 0 values)
    if (
      moisture === undefined || temperature === undefined ||
      humidity === undefined || !plantId || !moistureStatus
    ) {
      return res.status(400).json({ error: "❌ Invalid input data - missing fields" });
    }

    // ✅ Fix: Store in Firestore & confirm success
    const docRef = await db.collection("sensor_data").add({
      moisture, temperature, humidity, plantId, moistureStatus,
      timestamp: admin.firestore.Timestamp.now(),
    });

    if (!docRef.id) {
      throw new Error("❌ Firestore write failed");
    }

    console.log(`✅ Data stored in Firestore! (Doc ID: ${docRef.id})`);
    res.json({ message: "✅ Sensor data recorded successfully" });
  } catch (error) {
    console.error("❌ Error storing data:", error.message);
    res.status(500).json({ error: "❌ Internal Server Error: " + error.message });
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
    console.error("❌ Error fetching plants:", error.message);
    res.status(500).json({ error: "❌ Error fetching plants: " + error.message });
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
    console.error("❌ Error fetching plant:", error.message);
    res.status(500).json({ error: "❌ Error fetching plant: " + error.message });
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
    console.error("❌ Error generating report:", error.message);
    res.status(500).json({ error: "❌ Error generating report: " + error.message });
  }
});


// ==========================
// 🚀 Start Server
// ==========================
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
