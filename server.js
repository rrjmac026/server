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
// ✅ Receive Sensor Data from ESP32
// ==========================
app.post("/api/sensor-data", async (req, res) => {
  try {
    console.log("📩 Received Sensor Data:", req.body);
    const { moisture, temperature, humidity, plantId, moistureStatus } = req.body;

    if (
      moisture === undefined || temperature === undefined ||
      humidity === undefined || !plantId || !moistureStatus
    ) {
      return res.status(400).json({ error: "❌ Invalid input data - missing fields" });
    }

    const docRef = await db.collection("sensor_data").add({
      moisture, temperature, humidity, plantId, moistureStatus,
      timestamp: admin.firestore.Timestamp.now(),
    });

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

    const plants = plantsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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

    res.json({ id: plantDoc.id, ...plantDoc.data() });
  } catch (error) {
    console.error("❌ Error fetching plant:", error.message);
    res.status(500).json({ error: "❌ Error fetching plant: " + error.message });
  }
});

// ==========================
// ✅ Get Latest Sensor Data
// ==========================
app.get("/api/plants/:plantId/latest-sensor-data", async (req, res) => {
  try {
    const { plantId } = req.params;
    console.log(`📡 Fetching latest sensor data for plant ${plantId}`);

    // First verify the plant exists
    const plantDoc = await db.collection("plants").doc(plantId).get();
    if (!plantDoc.exists) {
      console.error(`⚠️ Plant ${plantId} not found`);
      return res.status(404).json({ error: "Plant not found" });
    }

    // Get the most recent sensor reading
    const latestReadingQuery = await db.collection("sensor_data")
      .where("plantId", "==", plantId)
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    if (latestReadingQuery.empty) {
      console.log(`⚠️ No sensor data found for plant ${plantId}`);
      return res.status(404).json({ error: "No sensor data found" });
    }

    const latestReading = latestReadingQuery.docs[0].data();
    console.log(`✅ Found latest sensor data for plant ${plantId}`);
    
    // Format the response
    const sensorData = {
      moisture: latestReading.moisture,
      temperature: latestReading.temperature,
      humidity: latestReading.humidity,
      plantId: plantId,
      timestamp: latestReading.timestamp,
      moistureStatus: latestReading.moistureStatus
    };

    res.json(sensorData);
  } catch (error) {
    console.error("❌ Error fetching latest sensor data:", error.message);
    res.status(500).json({ error: "❌ Error fetching latest sensor data: " + error.message });
  }
});

// ==========================
// ✅ Create New Plant
// ==========================
app.post("/api/plants", async (req, res) => {
  try {
    console.log("🌱 Creating new plant:", req.body);
    const { name, type, description } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: "❌ Plant name and type are required" });
    }

    const plantData = {
      name,
      type,
      description: description || "",
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    };

    const docRef = await db.collection("plants").add(plantData);

    console.log(`✅ Plant created successfully! (ID: ${docRef.id})`);
    res.status(201).json({ id: docRef.id, ...plantData });
  } catch (error) {
    console.error("❌ Error creating plant:", error.message);
    res.status(500).json({ error: "❌ Error creating plant: " + error.message });
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

    const startTimestamp = admin.firestore.Timestamp.fromDate(new Date(start));
    const endTimestamp = admin.firestore.Timestamp.fromDate(new Date(end));

    const snapshot = await db.collection("sensor_data")
      .where("plantId", "==", plantId)
      .where("timestamp", ">=", startTimestamp)
      .where("timestamp", "<=", endTimestamp)
      .orderBy("timestamp")
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "No data found for the specified period" });
    }

    res.json({
      plantId,
      startDate: startTimestamp.toDate(),
      endDate: endTimestamp.toDate(),
      totalReadings: snapshot.size,
      historicalData: snapshot.docs.map(doc => doc.data()),
    });
  } catch (error) {
    console.error("❌ Error generating report:", error.message);
    res.status(500).json({ error: "❌ Error generating report: " + error.message });
  }
});

// ==========================
// ✅ Get Latest Sensor Data for a Plant
// ==========================
app.get("/api/plants/:plantId/latest", async (req, res) => {
  try {
    const { plantId } = req.params;
    console.log(`📡 Fetching latest data for plant ${plantId}`);

    const plantDoc = db.collection("plants").doc(plantId);
    
    const [plantSnap, latestReadingSnap] = await Promise.all([
      plantDoc.get(),
      db.collection("sensor_data")
        .where("plantId", "==", plantId)
        .orderBy("timestamp", "desc")
        .limit(1)
        .get()
    ]);

    if (!plantSnap.exists) {
      return res.status(404).json({ error: "Plant not found" });
    }

    const latestReading = latestReadingSnap.empty ? null : latestReadingSnap.docs[0].data();
    res.json({ ...plantSnap.data(), lastReading: latestReading });
  } catch (error) {
    console.error("❌ Error fetching latest data:", error.message);
    res.status(500).json({ error: "❌ Error: " + error.message });
  }
});

// ==========================
// 🚀 Start Server
// ==========================
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
