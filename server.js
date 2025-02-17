const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const router = express.Router();

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

// Log all requests (Ensures logging middleware runs before routes)
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
    const plants = plantsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    console.error(`🌱 Retrieved ${plants.length} plants`);
    res.json(plants);
  } catch (error) {
    console.error("❌ Error fetching plants:", error);
    res.status(500).json({ error: error.message });
  }
});

// Store Sensor Data with Validation
app.post("/api/sensor-data", async (req, res) => {
  try {
    const { moisture, temperature, plantId } = req.body;

    if (typeof moisture !== "number" || typeof temperature !== "number" || typeof plantId !== "string") {
      console.error("❌ Validation Error: Invalid input data");
      return res.status(400).json({ error: "Invalid input data" });
    }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const newDoc = await db.collection("sensor_data").add({
      moisture,
      temperature,
      plantId,
      timestamp,
    });

    console.error(`✅ Sensor data stored (ID: ${newDoc.id}) for plant ${plantId}`);

    if (moisture < 30) {
      console.error(`⚠️ Low moisture detected for Plant ID: ${plantId}. Creating notification.`);
      await createNotification(plantId, "Low moisture level detected!");
    }

    res.json({ message: "Sensor data recorded successfully" });
  } catch (error) {
    console.error("❌ Error storing sensor data:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get Plant Report
router.get("/api/reports/:plantId", async (req, res) => {
  try {
    const { plantId } = req.params;
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Start and end date are required." });
    }

    const sensorDataSnapshot = await db
      .collection("sensor_data")
      .where("plantId", "==", plantId)
      .where("timestamp", ">=", new Date(start))
      .where("timestamp", "<=", new Date(end))
      .get();

    const sensorData = sensorDataSnapshot.docs.map((doc) => doc.data());

    if (sensorData.length === 0) {
      return res.status(404).json({ error: "No data found for the given date range." });
    }

    const report = {
      plantId,
      startDate: new Date(start),
      endDate: new Date(end),
      averageMoisture: calculateAverage(sensorData.map((d) => d.moisture)),
      averageTemperature: calculateAverage(sensorData.map((d) => d.temperature)),
      wateringCount: 0,
      fertilizingCount: 0,
      historicalData: sensorData,
    };

    res.json(report);
  } catch (error) {
    console.error("❌ Error generating report:", error);
    res.status(500).json({ error: "Error generating report" });
  }
});

// Helper function to calculate average
function calculateAverage(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b) / values.length;
}

// Download Report as PDF (Placeholder)
router.get("/api/reports/:plantId/download", async (req, res) => {
  try {
    const { plantId } = req.params;
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Start and end date are required." });
    }

    console.error(`📄 PDF report requested for Plant ID: ${plantId} from ${start} to ${end}`);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=plant_report_${plantId}.pdf`);

    res.status(501).json({ error: "PDF generation not implemented yet" });
  } catch (error) {
    console.error("❌ Error generating PDF report:", error);
    res.status(500).json({ error: "Error generating PDF report" });
  }
});

// Get Notifications for a User
app.get("/api/notifications/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const notificationsSnapshot = await db
      .collection("notifications")
      .where("userId", "==", userId)
      .orderBy("timestamp", "desc")
      .limit(50)
      .get();

    const notifications = notificationsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    console.error(`🔔 Retrieved ${notifications.length} notifications for user ${userId}`);
    res.json(notifications);
  } catch (error) {
    console.error("❌ Error fetching notifications:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create Notifications in Firestore
async function createNotification(plantId, message) {
  try {
    const plantDoc = await db.collection("plants").doc(plantId).get();

    if (!plantDoc.exists) {
      console.error(`❌ Plant with ID ${plantId} not found.`);
      return;
    }

    const { userId } = plantDoc.data();
    const notificationRef = await db.collection("notifications").add({
      userId,
      plantId,
      message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    console.error(`✅ Notification sent to user ${userId} (ID: ${notificationRef.id}): ${message}`);
  } catch (error) {
    console.error("❌ Error creating notification:", error);
  }
}

// Handle JSON Parsing Errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError) {
    console.error("❌ JSON Parsing Error:", err);
    return res.status(400).json({ error: "Invalid JSON format" });
  }
  next();
});

// Import and use external routes
const reportRoutes = require("./routes/reports");
app.use(reportRoutes);

// Use the router AFTER defining all routes
app.use(router);

app.listen(port, () => {
  console.error(`🚀 Server running on port ${port}`);
});
