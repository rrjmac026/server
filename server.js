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

// Add this right after initializing Firebase
let defaultPlantId = null;

// Initialize function to ensure default plant exists
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
// 🔧 Middleware Setup
// ==========================
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
// ✅ Receive Sensor Data from ESP32
// ==========================
app.post("/api/sensor-data", async (req, res) => {
    try {
        console.log("📩 Received Sensor Data:", req.body);
        let { moisture, temperature, humidity, plantId, moistureStatus } = req.body;

        // Use default plant ID if none provided
        if (!plantId && defaultPlantId) {
            plantId = defaultPlantId;
            console.log(`Using default plant ID: ${plantId}`);
        }

        // Ensure we have a plant ID
        if (!plantId) {
            await initializeDefaultPlant(); // Try to create default plant
            if (defaultPlantId) {
                plantId = defaultPlantId;
            } else {
                return res.status(400).json({ error: "No plant ID available" });
            }
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

        // Get the most recent sensor reading without requiring plant verification
        const latestReadingQuery = await db.collection("sensor_data")
            .where("plantId", "==", plantId)
            .orderBy("timestamp", "desc")
            .limit(1)
            .get();

        if (latestReadingQuery.empty) {
            return res.json({
                moisture: 0,
                temperature: 0,
                humidity: 0,
                plantId: plantId,
                moistureStatus: "NO_DATA",
                timestamp: admin.firestore.Timestamp.now()
            });
        }

        const latestReading = latestReadingQuery.docs[0].data();
        console.log(`✅ Found latest sensor data for plant ${plantId}`);
        res.json(latestReading);
    } catch (error) {
        console.error("❌ Error fetching latest sensor data:", error.message);
        res.status(500).json({ error: "❌ Error fetching latest sensor data: " + error.message });
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
// 🚀 Start Server
// ==========================
app.listen(port, async () => {
    await initializeDefaultPlant();
    console.log(`🚀 Server running on port ${port}`);
}); 