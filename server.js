const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// ✅ 1. Handle Missing Firestore Credentials Gracefully
if (!process.env.FIREBASE_CREDENTIALS) {
  console.error("❌ FIREBASE_CREDENTIALS is missing. Make sure to set it in environment variables.");
  process.exit(1); // Exit the app to prevent unexpected behavior
}

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ✅ Middleware
app.use(cors());
app.use(express.json());

// ✅ 2. Handle JSON Parsing Errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError) {
    return res.status(400).json({ error: "Invalid JSON format" });
  }
  next();
});

// ✅ 3. Health Check Route
app.get("/api/health", (req, res) => {
  res.json({ status: "Server is running" });
});

// ✅ 4. Get All Plants
app.get("/api/plants", async (req, res) => {
  try {
    const plantsSnapshot = await db.collection("plants").get();
    const plants = plantsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(plants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ 5. Store Sensor Data with Validation
app.post("/api/sensor-data", async (req, res) => {
  try {
    const { moisture, temperature, plantId } = req.body;

    // ✅ Validate input
    if (
      typeof moisture !== "number" ||
      typeof temperature !== "number" ||
      typeof plantId !== "string"
    ) {
      return res.status(400).json({ error: "Invalid input data" });
    }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    await db.collection("sensor_data").add({
      moisture,
      temperature,
      plantId,
      timestamp,
    });

    // ✅ Trigger a notification if moisture is low
    if (moisture < 30) {
      await createNotification(plantId, "Low moisture level detected!");
    }

    res.json({ message: "Sensor data recorded successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ 6. Get Notifications for a User (Fix Firestore Query Issue)
app.get("/api/notifications/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // ✅ Ensure Firestore index exists (Firestore requires a composite index for `where()` + `orderBy()`)
    const notificationsSnapshot = await db
      .collection("notifications")
      .where("userId", "==", userId)
      .orderBy("timestamp", "desc") // Firestore requires an index for this
      .limit(50)
      .get();

    const notifications = notificationsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ 7. Create Notifications in Firestore
async function createNotification(plantId, message) {
  try {
    const plantDoc = await db.collection("plants").doc(plantId).get();

    if (!plantDoc.exists) {
      console.error(`❌ Plant with ID ${plantId} not found.`);
      return;
    }

    const { userId } = plantDoc.data(); // Extract userId from the plant document

    await db.collection("notifications").add({
      userId,
      plantId,
      message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    console.log(`✅ Notification sent to user ${userId}: ${message}`);
  } catch (error) {
    console.error("❌ Error creating notification:", error);
  }
}

// ✅ 8. Start Express Server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
