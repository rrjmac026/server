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

    res.json({
      message: "✅ Sensor data recorded successfully",
      plantId: plantId
    });
  } catch (error) {
    console.error("❌ Error storing data:", error.message);
    res.status(500).json({ error: "❌ Internal Server Error: " + error.message });
  }
});

// Function to determine moisture status
function getMoistureStatus(moisture) {
  if (moisture >= 70) return "WET";
  if (moisture >= 40) return "MOIST";
  return "DRY";
}

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
      return res.json({ moisture: 0, temperature: 0, humidity: 0, moistureStatus: "NO_DATA" });
    }

    const latestReading = latestReadingQuery.docs[0].data();
    res.json(latestReading);
  } catch (error) {
    console.error("❌ Error fetching latest sensor data:", error.message);
    res.status(500).json({ error: "❌ Internal Server Error" });
  }
});

// ==========================
// 📄 Generate PDF Report
// ==========================
async function generatePDFReport(data, startDate, endDate, res) {
  const doc = new PDFDocument();

  // Set headers for PDF response
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=plant-report-${data.plantId}.pdf`);

  // Add title
  doc.fontSize(20).text("Plant Monitoring Report", { align: "center" }).moveDown();

  // Add date range
  doc.fontSize(12).text(`Report Period: ${startDate} to ${endDate}`, { align: "center" }).moveDown();

  // Add plant info
  doc.fontSize(16).text("Plant Information").moveDown();
  doc.fontSize(12).text(`Plant ID: ${data.plantId}`).text(`Plant Name: ${data.plantName}`).moveDown();

  // Add sensor data averages
  doc.fontSize(16).text("Sensor Data Averages").moveDown();
  doc.fontSize(12)
    .text(`Average Temperature: ${data.averageTemperature.toFixed(2)}°C`)
    .text(`Average Moisture: ${data.averageMoisture.toFixed(2)}%`)
    .text(`Average Humidity: ${data.averageHumidity.toFixed(2)}%`)
    .moveDown();

  // Pipe the PDF to the response
  doc.pipe(res);
  doc.end();
}

// ✅ PDF Report Endpoint
app.get("/api/reports/:plantId", async (req, res) => {
  try {
      const { plantId } = req.params;
      const { start, end } = req.query;

      console.log(`📊 Generating report for plant ${plantId}`);
      console.log(`📅 Date range: ${start} to ${end}`);

      if (!plantId || !start || !end) {
          return res.status(400).json({ error: "Plant ID, start date, and end date are required" });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      const sensorDataQuery = await db.collection("sensor_data")
          .where("plantId", "==", plantId)
          .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(startDate))
          .where("timestamp", "<=", admin.firestore.Timestamp.fromDate(endDate))
          .orderBy("timestamp", "desc") // ✅ Ensure query matches Firestore index
          .get();

      const readings = sensorDataQuery.docs.map(doc => doc.data());
      const count = readings.length;
      let totalTemp = 0, totalMoisture = 0, totalHumidity = 0;

      readings.forEach(reading => {
          totalTemp += reading.temperature || 0;
          totalMoisture += reading.moisture || 0;
          totalHumidity += reading.humidity || 0;
      });

      const reportData = {
        plantId,
        plantName: `Plant ${plantId}`,
        startDate: start,
        endDate: end,
        averageTemperature: count ? Number((totalTemp / count).toFixed(2)) : 0,
        averageMoisture: count ? Number((totalMoisture / count).toFixed(2)) : 0,
        averageHumidity: count ? Number((totalHumidity / count).toFixed(2)) : 0,
        readingsCount: count
    };
    

      await generatePDFReport(reportData, start, end, res);

  } catch (error) {
      res.status(500).json({ error: "Error generating report", details: error.message });
  }
});

// ✅ Start Server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
