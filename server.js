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
// 📄 Generate PDF Report
// ==========================
async function generatePDFReport(data, startDate, endDate, res) {
  const doc = new PDFDocument();

  // Set headers for PDF response
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=plant-report-${data.plantId}.pdf`);

  // Add title and logo
  doc.fontSize(24).text("Plant Monitoring Report", { align: "center" }).moveDown();
  
  // Add date range
  doc.fontSize(14).text(`Report Period: ${startDate} to ${endDate}`, { align: "center" }).moveDown();

  // Add plant info
  doc.fontSize(18).text("Plant Information", { underline: true }).moveDown();
  doc.fontSize(12)
    .text(`Plant ID: ${data.plantId}`)
    .text(`Plant Name: ${data.plantName}`)
    .text(`Total Readings: ${data.readingsCount}`)
    .moveDown();

  // Add sensor data averages
  doc.fontSize(18).text("Sensor Data Analysis", { underline: true }).moveDown();
  doc.fontSize(12)
    .text(`Average Temperature: ${data.averageTemperature.toFixed(2)}°C`)
    .text(`Average Moisture: ${data.averageMoisture.toFixed(2)}%`) 
    .text(`Average Humidity: ${data.averageHumidity.toFixed(2)}%`)
    .moveDown();

  // Add watering/fertilizing events
  doc.fontSize(18).text("Maintenance Events", { underline: true }).moveDown();
  doc.fontSize(12)
    .text(`Watering Events: ${data.wateringCount}`)
    .text(`Fertilizing Events: ${data.fertilizingCount}`)
    .moveDown();

  // Add moisture status distribution
  doc.fontSize(18).text("Moisture Status Distribution", { underline: true }).moveDown();
  doc.fontSize(12)
    .text(`Dry Readings: ${data.moistureStats.dry}`)
    .text(`Moist Readings: ${data.moistureStats.moist}`) 
    .text(`Wet Readings: ${data.moistureStats.wet}`)
    .moveDown();

  // Add data table
  doc.fontSize(18).text("Sensor Readings", { underline: true }).moveDown();
  doc.fontSize(12);
  const readings = data.readings;
  doc.table({
    headers: ['Date', 'Temperature', 'Moisture', 'Humidity'],
    rows: readings.map(reading => [
      reading.timestamp.toDate().toLocaleDateString(),
      `${reading.temperature}°C`,
      `${reading.moisture}%`,
      `${reading.humidity}%`
    ])
  });

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

    // Retrieve sensor data for date range
    const snapshot = await db.collection("sensor_data")
      .where("plantId", "==", plantId)
      .where("timestamp", ">=", new Date(start))
      .where("timestamp", "<=", new Date(end))
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "No data found for the selected range" });
    }

    let readings = [];
    let totalTemperature = 0, totalMoisture = 0, totalHumidity = 0;
    let moistureStats = { dry: 0, moist: 0, wet: 0 };
    let wateringCount = 0, fertilizingCount = 0;

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      readings.push(data);
      totalTemperature += data.temperature;
      totalMoisture += data.moisture;
      totalHumidity += data.humidity;
      if (data.moistureStatus === 'DRY') moistureStats.dry++;
      if (data.moistureStatus === 'MOIST') moistureStats.moist++;
      if (data.moistureStatus === 'WET') moistureStats.wet++;
      
      // Placeholder for counting events like watering/fertilizing (you may track these separately)
      if (data.moistureStatus === "DRY") wateringCount++;
      if (data.moistureStatus === "MOIST") fertilizingCount++;
    });

    const reportData = {
      plantId,
      plantName: "Your Plant Name",  // Replace with the plant name retrieved from the database
      readingsCount: readings.length,
      averageTemperature: totalTemperature / readings.length,
      averageMoisture: totalMoisture / readings.length,
      averageHumidity: totalHumidity / readings.length,
      moistureStats,
      wateringCount,
      fertilizingCount,
      readings,
    };

    generatePDFReport(reportData, start, end, res);

  } catch (error) {
    console.error("❌ Error generating report:", error);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// ✅ Start the Server
app.listen(port, () => {
  console.log(`✅ Server started at http://localhost:${port}`);
});
