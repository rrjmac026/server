const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const PDFDocument = require("pdfkit");

const app = express();
const port = process.env.PORT || 3000;

// Handle Missing Firestore Credentials Gracefully
if (!process.env.FIREBASE_CREDENTIALS) {
  console.error("FIREBASE_CREDENTIALS is missing. Make sure to set it in environment variables.");
  process.exit(1);
}

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Middleware Setup
app.use(cors());
app.use(express.json());

// Log All Requests for Debugging
app.use((req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (Object.keys(req.body).length) {
    console.error("Request Body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

// ======================
// Health Check Route
// ======================
app.get("/api/health", (req, res) => {
  res.json({ status: "Server is running" });
});

// ======================
// Plants Routes
// ======================
app.get("/api/plants", async (req, res) => {
  try {
    console.error("Fetching all plants");
    const plantsSnapshot = await db.collection("plants").get();

    if (plantsSnapshot.empty) {
      console.error("No plants found");
      return res.json([]);
    }

    const plants = plantsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    console.error(`Found ${plants.length} plants`);
    res.json(plants);
  } catch (error) {
    console.error("Error fetching plants:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/plants/:plantId", async (req, res) => {
  try {
    const { plantId } = req.params;
    console.error(`Fetching plant ${plantId}`);

    const plantDoc = await db.collection("plants").doc(plantId).get();

    if (!plantDoc.exists) {
      console.error(`Plant ${plantId} not found`);
      return res.status(404).json({ error: "Plant not found" });
    }

    const plant = {
      id: plantDoc.id,
      ...plantDoc.data(),
    };

    console.error(`Found plant ${plantId}`);
    res.json(plant);
  } catch (error) {
    console.error("Error fetching plant:", error);
    res.status(500).json({ error: error.message });
  }
});

// ======================
// Sensor Data Routes
// ======================
app.post("/api/sensor-data", async (req, res) => {
  try {
    const { moisture, temperature, plantId } = req.body;
    console.error(`Received sensor data for plant ${plantId}:`);
    console.error(`Moisture: ${moisture}%, Temperature: ${temperature}°C`);

    // Validate input
    if (typeof moisture !== "number" || typeof temperature !== "number" || typeof plantId !== "string") {
      return res.status(400).json({ error: "Invalid input data" });
    }

    const timestamp = admin.firestore.Timestamp.now();

    const docRef = await db.collection("sensor_data").add({
      moisture,
      temperature,
      plantId,
      timestamp,
    });

    console.error(`Sensor data stored with timestamp ${timestamp.toDate()} (ID: ${docRef.id})`);
    res.json({ message: "Sensor data recorded successfully", id: docRef.id });
  } catch (error) {
    console.error("Error storing sensor data:", error);
    res.status(500).json({ error: error.message });
  }
});

// ======================
// Report Routes
// ======================
app.get("/api/reports/:plantId", async (req, res) => {
  try {
    const { plantId } = req.params;
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Start and end date are required." });
    }

    console.error(`Generating report for plant ${plantId} from ${start} to ${end}`);

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

    console.error(`Found ${snapshot.size} readings`);

    if (snapshot.empty) {
      return res.status(404).json({ error: "No data found for the specified period" });
    }

    let totalMoisture = 0;
    let totalTemperature = 0;
    const readings = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      totalMoisture += data.moisture;
      totalTemperature += data.temperature;
      readings.push({
        ...data,
        timestamp: data.timestamp.toDate(),
      });
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

    console.error("Generated report:", report);
    res.json(report);
  } catch (error) {
    console.error("Error generating report:", error);
    res.status(500).json({ error: "Error generating report: " + error.message });
  }
});

// ======================
// Generate PDF Report
// ======================
app.get("/api/reports/:plantId/download", async (req, res) => {
  try {
    const { plantId } = req.params;
    const { start, end } = req.query;

    console.error(`Generating PDF report for plant ${plantId}`);

    const startDate = new Date(start);
    const endDate = new Date(end);

    const snapshot = await db
      .collection("sensor_data")
      .where("plantId", "==", plantId)
      .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(startDate))
      .where("timestamp", "<=", admin.firestore.Timestamp.fromDate(endDate))
      .orderBy("timestamp")
      .get();

    const doc = new PDFDocument();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=plant_report_${plantId}_${start}_to_${end}.pdf`);

    doc.pipe(res);

    doc.fontSize(25).text("Plant Report", { align: "center" }).moveDown();
    doc.fontSize(14).text(`Plant ID: ${plantId}`).text(`Period: ${start} to ${end}`).moveDown();

    if (!snapshot.empty) {
      let totalMoisture = 0;
      let totalTemperature = 0;
      const readings = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        totalMoisture += data.moisture;
        totalTemperature += data.temperature;
        readings.push({
          ...data,
          timestamp: data.timestamp.toDate(),
        });
      });

      const avgMoisture = totalMoisture / readings.length;
      const avgTemperature = totalTemperature / readings.length;

      doc.text(`Average Moisture: ${avgMoisture.toFixed(1)}%`)
        .text(`Average Temperature: ${avgTemperature.toFixed(1)}°C`)
        .text(`Number of Readings: ${readings.length}`)
        .moveDown();

      doc.fontSize(12).text("Detailed Readings:", { underline: true }).moveDown();

      readings.forEach((reading, index) => {
        if (index > 0 && index % 20 === 0) doc.addPage();
        doc.text(
          `${new Date(reading.timestamp).toLocaleString()}: Moisture: ${reading.moisture.toFixed(1)}%, Temperature: ${reading.temperature.toFixed(1)}°C`
        );
      });
    } else {
      doc.text("No readings found for this period");
    }

    doc.moveDown().fontSize(10).text("Generated by Plant Monitoring System", { align: "center" });
    doc.end();

    console.error("PDF generated and sent successfully");
  } catch (error) {
    console.error("Error generating PDF:", error);
    res.status(500).json({ error: "Error generating PDF: " + error.message });
  }
});

// ======================
// Test Data Setup Route
// ======================
app.post("/api/setup-test-data", async (req, res) => {
  try {
    const plantsSnapshot = await db.collection("plants").get();

    if (plantsSnapshot.empty) {
      await db.collection("plants").doc("plant123").set({
        name: "Test Plant",
        type: "Indoor Plant",
        userId: "testuser",
        lastWatered: Date.now(),
        soilMoisture: 65,
        temperature: 22,
      });

      console.error("Test data created");
      res.json({ message: "Test data created successfully" });
    } else {
      res.json({ message: "Test data already exists" });
    }
  } catch (error) {
    console.error("Error setting up test data:", error);
    res.status(500).json({ error: error.message });
  }
});

// ======================
// Start Server
// ======================
app.listen(port, () => {
  console.error(`Server running on port ${port}`);
});