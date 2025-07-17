const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const morgan = require("morgan");
require("dotenv").config();
const PDFDocument = require("pdfkit");
const moment = require('moment-timezone');

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
app.use(morgan(':date[iso] :method :url :status :response-time ms'));

// Track recent requests to prevent duplicates
const recentRequests = new Map();
const REQUEST_EXPIRY = 60000; // Clear requests older than 1 minute

// Cleanup old requests periodically
setInterval(() => {
    const cutoff = Date.now() - REQUEST_EXPIRY;
    for (const [key, timestamp] of recentRequests) {
        if (timestamp < cutoff) {
            recentRequests.delete(key);
        }
    }
}, 60000);

// ✅ Default Route
app.get("/", (req, res) => {
  res.send("🚀 Welcome to the Plant Monitoring API! Use the correct endpoints.");
});

// ✅ Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "✅ Server is running" });
});

// Helper functions
async function saveSensorData(data) {
  const docRef = await db.collection("sensor_data").add({
    ...data,
    timestamp: moment().tz('Asia/Manila').toDate()
  });
  return docRef;
}

async function getLatestReading(plantId) {
  const snapshot = await db.collection("sensor_data")
    .where("plantId", "==", plantId)
    .orderBy("timestamp", "desc")
    .limit(1)
    .get();
  
  return snapshot.empty ? null : snapshot.docs[0].data();
}

// Function to determine moisture status
function getMoistureStatus(moisture) {
  if (moisture === 1023) return "NO DATA";
  if (moisture >= 1000) return "SENSOR ERROR";
  if (moisture > 600 && moisture < 1000) return "DRY";
  if (moisture > 370 && moisture <= 600) return "HUMID";
  if (moisture <= 370) return "WET";
  return "NO DATA";
}

// Add new helper functions
async function getReadingsInRange(plantId, startDate, endDate) {
  const snapshot = await db.collection("sensor_data")
    .where("plantId", "==", plantId)
    .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(new Date(startDate)))
    .where("timestamp", "<=", admin.firestore.Timestamp.fromDate(new Date(endDate)))
    .orderBy("timestamp", "desc")
    .get();

  return snapshot.docs.map(doc => ({
    ...doc.data(),
    id: doc.id,
    timestamp: doc.data().timestamp.toDate()
  }));
}

async function getAllReadingsInRange(plantId, startDate, endDate, progressCallback = null) {
  const readings = [];
  let lastDoc = null;
  const batchSize = 500; // Adjust based on your needs
  
  while (true) {
    let query = db.collection("sensor_data")
      .where("plantId", "==", plantId)
      .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(new Date(startDate)))
      .where("timestamp", "<=", admin.firestore.Timestamp.fromDate(new Date(endDate)))
      .orderBy("timestamp", "desc")
      .limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    
    if (snapshot.empty) break;

    const batch = snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id,
      timestamp: doc.data().timestamp.toDate()
    }));
    
    readings.push(...batch);
    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    if (progressCallback) {
      progressCallback(readings.length);
    }

    if (snapshot.docs.length < batchSize) break;
  }

  return readings;
}

function calculateStats(readings) {
  return readings.reduce((stats, reading) => {
    stats.totalTemperature += reading.temperature || 0;
    stats.totalHumidity += reading.humidity || 0;
    stats.totalMoisture += reading.moisture || 0;
    stats.moistureStatus[reading.moistureStatus.toLowerCase()]++;
    stats.waterStateCount += reading.waterState ? 1 : 0;
    stats.fertilizerStateCount += reading.fertilizerState ? 1 : 0;
    return stats;
  }, {
    totalTemperature: 0,
    totalHumidity: 0,
    totalMoisture: 0,
    moistureStatus: { dry: 0, moist: 0, wet: 0 },
    waterStateCount: 0,
    fertilizerStateCount: 0
  });
}

// ==========================
// ✅ Receive POST Sensor Data (from ESP32)
// ==========================
app.post("/api/sensor-data", async (req, res) => {
  const startTime = Date.now();
  const { moisture, pumpState, temperature, humidity, requestId, deviceId, timestamp } = req.body;

  // Log incoming request
  console.log(`\n📥 Incoming data at ${new Date().toISOString()}`);
  console.log(`RequestID: ${requestId}`);
  console.log(`DeviceID: ${deviceId}`);
  console.log(`Data: `, req.body);

  // Check for duplicate request
  if (recentRequests.has(requestId)) {
      console.log(`⚠️ Duplicate request detected: ${requestId}`);
      return res.status(409).json({ error: 'Duplicate request' });
  }

  try {
      // Add document with requestId as the document ID to ensure uniqueness
      const docRef = admin.firestore().collection('readings').doc(requestId);
      await docRef.set({
          moisture,
          pumpState,
          temperature,
          humidity,
          deviceId,
          timestamp,
          requestId,
          serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
          processingTime: Date.now() - startTime
      });

      // Record this request
      recentRequests.set(requestId, Date.now());

      console.log(`✅ Data saved successfully (${Date.now() - startTime}ms)`);
      res.status(200).json({ success: true });

  } catch (error) {
      console.error('❌ Error saving data:', error);
      res.status(500).json({ error: 'Failed to save data' });
  }
});

// ==========================
// ✅ Receive Sensor Data
// ==========================
app.get("/api/sensor-data", async (req, res) => {
  try {
    const { plantId } = req.query;
    if (!plantId) {
      return res.status(400).json({ error: "Missing plantId" });
    }

    const latestReading = await getLatestReading(plantId);

    if (!latestReading) {
      return res.status(404).json({
        error: 'No sensor data found',
        moisture: 0, 
        temperature: 0, 
        humidity: 0, 
        moistureStatus: "NO_DATA" 
      });
    }

    const response = {
      moisture: latestReading.moisture || 0,
      temperature: latestReading.temperature || 0,
      humidity: latestReading.humidity || 0,
      moistureStatus: latestReading.moistureStatus || "NO_DATA",
      timestamp: moment(latestReading.timestamp).tz('Asia/Manila').format()
    };

    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching sensor data:", error.message);
    res.status(500).json({ error: "Failed to load sensor data" });
  }
});


// ==========================
// ✅ Get Latest Sensor Data
// ==========================
app.get("/api/plants/:plantId/latest-sensor-data", async (req, res) => {
  try {
    const { plantId } = req.params;
    console.log(`📡 Fetching latest sensor data for plant ${plantId}`);

    const latestReading = await getLatestReading(plantId);

    if (!latestReading) {
      return res.status(404).json({ 
        error: 'No sensor data found',
        moisture: 0, 
        temperature: 0, 
        humidity: 0, 
        moistureStatus: "NO_DATA" 
      });
    }

    const response = {
      moisture: latestReading.moisture || 0,
      temperature: latestReading.temperature || 0,
      humidity: latestReading.humidity || 0,
      moistureStatus: latestReading.moistureStatus || "NO_DATA",
      timestamp: moment(latestReading.timestamp).tz('Asia/Manila').format()
    };
    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching latest sensor data:", error.message);
    res.status(500).json({ error: "Failed to load sensor data" });
  }
});

// ==========================
// ✅ PDF Report Endpoint
// ==========================
app.get("/api/reports", async (req, res) => {
  try {
    const { plantId, start, end, format = 'pdf' } = req.query;
    
    if (!plantId || !start || !end) {
      return res.status(400).json({
        error: "Missing parameters",
        example: "/api/reports?plantId=123&start=2024-01-01&end=2024-01-31&format=pdf|json"
      });
    }

    // Set up response headers early for PDF streaming
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
      
      const doc = new PDFDocument();
      doc.pipe(res);

      // Start writing the PDF header
      doc.fontSize(24).text('Plant Monitoring Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12)
        .text(`Plant ID: ${plantId}`)
        .text(`Report Period: ${moment(start).tz('Asia/Manila').format('YYYY-MM-DD LT')} to ${moment(end).tz('Asia/Manila').format('YYYY-MM-DD LT')}`);
      doc.moveDown();
      
      let totalReadings = 0;
      let stats = {
        totalTemperature: 0,
        totalHumidity: 0,
        totalMoisture: 0,
        moistureStatus: { dry: 0, humid: 0, wet: 0 },
        waterStateCount: 0,
        fertilizerStateCount: 0
      };

      // Use pagination with progress updates
      await getAllReadingsInRange(plantId, start, end, (count) => {
        totalReadings = count;
        doc.fontSize(12).text(`Processing... ${count} readings found`, { color: 'blue' });
      });

      // Fetch all readings with progress tracking
      const readings = await getAllReadingsInRange(plantId, start, end);
      
      if (readings.length === 0) {
        doc.fontSize(12).text('No data found for the specified period.');
        doc.end();
        return;
      }

      // Calculate final statistics
      readings.forEach(reading => {
        stats.totalTemperature += reading.temperature || 0;
        stats.totalHumidity += reading.humidity || 0;
        stats.totalMoisture += reading.moisture || 0;
        stats.moistureStatus[reading.moistureStatus.toLowerCase()]++;
        stats.waterStateCount += reading.waterState ? 1 : 0;
        stats.fertilizerStateCount += reading.fertilizerState ? 1 : 0;
      });

      // Write statistics
      doc.fontSize(14).text('Statistics:', { underline: true });
      doc.fontSize(12)
        .text(`Total Readings: ${readings.length}`)
        .text(`Average Temperature: ${(stats.totalTemperature / readings.length).toFixed(2)}°C`)
        .text(`Average Humidity: ${(stats.totalHumidity / readings.length).toFixed(2)}%`)
        .text(`Average Moisture: ${(stats.totalMoisture / readings.length).toFixed(2)}%`)
        .text(`Water System Activations: ${stats.waterStateCount}`)
        .text(`Fertilizer System Activations: ${stats.fertilizerStateCount}`);
      doc.moveDown();

      // Write recent readings (last 10)
      doc.fontSize(14).text('Recent Readings:', { underline: true });
      readings.slice(0, 10).forEach(reading => {
        doc.fontSize(12)
          .text(`Time: ${moment(reading.timestamp).tz('Asia/Manila').format('YYYY-MM-DD LT')}`)
          .text(`Temperature: ${reading.temperature}°C`)
          .text(`Humidity: ${reading.humidity}%`)
          .text(`Moisture: ${reading.moisture}%`)
          .text(`Status: ${reading.moistureStatus}`)
          .text(`Water: ${reading.waterState ? "ON" : "OFF"}`)
          .text(`Fertilizer: ${reading.fertilizerState ? "ON" : "OFF"}`);
        doc.moveDown();
      });

      doc.end();
    } else {
      // For JSON format, return paginated data with stats
      const readings = await getAllReadingsInRange(plantId, start, end);
      const stats = calculateStats(readings);
      res.json({ 
        totalReadings: readings.length,
        stats,
        recentReadings: readings.slice(0, 10) // Only send recent readings in JSON
      });
    }

  } catch (error) {
    console.error("❌ Report generation error:", error);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// ==========================
// ✅ PDF Report Endpoint (with URL params)
// ==========================
app.get("/api/reports/:plantId", async (req, res) => {
  try {
    const { plantId } = req.params;
    const { start, end, format = 'pdf' } = req.query;
    
    if (!start || !end) {
      return res.status(400).json({
        error: "Missing parameters",
        example: "/api/reports/PLANT123?start=2024-01-01&end=2024-01-31&format=pdf|json"
      });
    }

    // Set up response headers early for PDF streaming
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
      
      const doc = new PDFDocument();
      doc.pipe(res);

      // Start writing the PDF header
      doc.fontSize(24).text('Plant Monitoring Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12)
        .text(`Plant ID: ${plantId}`)
        .text(`Report Period: ${moment(start).tz('Asia/Manila').format('YYYY-MM-DD LT')} to ${moment(end).tz('Asia/Manila').format('YYYY-MM-DD LT')}`);
      doc.moveDown();
      
      let totalReadings = 0;
      let stats = {
        totalTemperature: 0,
        totalHumidity: 0,
        totalMoisture: 0,
        moistureStatus: { dry: 0, humid: 0, wet: 0 },
        waterStateCount: 0,
        fertilizerStateCount: 0
      };

      // Use pagination with progress updates
      await getAllReadingsInRange(plantId, start, end, (count) => {
        totalReadings = count;
        doc.fontSize(12).text(`Processing... ${count} readings found`, { color: 'blue' });
      });

      // Fetch all readings with progress tracking
      const readings = await getAllReadingsInRange(plantId, start, end);
      
      if (readings.length === 0) {
        doc.fontSize(12).text('No data found for the specified period.');
        doc.end();
        return;
      }

      // Calculate final statistics
      readings.forEach(reading => {
        stats.totalTemperature += reading.temperature || 0;
        stats.totalHumidity += reading.humidity || 0;
        stats.totalMoisture += reading.moisture || 0;
        stats.moistureStatus[reading.moistureStatus.toLowerCase()]++;
        stats.waterStateCount += reading.waterState ? 1 : 0;
        stats.fertilizerStateCount += reading.fertilizerState ? 1 : 0;
      });

      // Write statistics
      doc.fontSize(14).text('Statistics:', { underline: true });
      doc.fontSize(12)
        .text(`Total Readings: ${readings.length}`)
        .text(`Average Temperature: ${(stats.totalTemperature / readings.length).toFixed(2)}°C`)
        .text(`Average Humidity: ${(stats.totalHumidity / readings.length).toFixed(2)}%`)
        .text(`Average Moisture: ${(stats.totalMoisture / readings.length).toFixed(2)}%`)
        .text(`Water System Activations: ${stats.waterStateCount}`)
        .text(`Fertilizer System Activations: ${stats.fertilizerStateCount}`);
      doc.moveDown();

      // Write recent readings (last 10)
      doc.fontSize(14).text('Recent Readings:', { underline: true });
      readings.slice(0, 10).forEach(reading => {
        doc.fontSize(12)
          .text(`Time: ${moment(reading.timestamp).tz('Asia/Manila').format('YYYY-MM-DD LT')}`)
          .text(`Temperature: ${reading.temperature}°C`)
          .text(`Humidity: ${reading.humidity}%`)
          .text(`Moisture: ${reading.moisture}%`)
          .text(`Status: ${reading.moistureStatus}`)
          .text(`Water: ${reading.waterState ? "ON" : "OFF"}`)
          .text(`Fertilizer: ${reading.fertilizerState ? "ON" : "OFF"}`);
        doc.moveDown();
      });

      doc.end();
    } else {
      // For JSON format, return paginated data with stats
      const readings = await getAllReadingsInRange(plantId, start, end);
      const stats = calculateStats(readings);
      res.json({ 
        totalReadings: readings.length,
        stats,
        recentReadings: readings.slice(0, 10) // Only send recent readings in JSON
      });
    }

  } catch (error) {
    console.error("❌ Report generation error:", error);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// Add new report endpoints
app.get("/api/reports/stats", async (req, res) => {
  try {
    const { plantId, start, end } = req.query;
    
    if (!plantId || !start || !end) {
      return res.status(400).json({
        error: "Missing parameters",
        example: "/api/reports/stats?plantId=123&start=2024-01-01&end=2024-01-31"
      });
    }

    const readings = await getReadingsInRange(plantId, start, end);
    
    if (readings.length === 0) {
      return res.status(404).json({ error: "No data found" });
    }

    const stats = calculateStats(readings);
    const count = readings.length;

    res.json({
      period: { start, end },
      readingCount: count,
      averages: {
        temperature: stats.totalTemperature / count,
        humidity: stats.totalHumidity / count,
        moisture: stats.totalMoisture / count
      },
      moistureStatus: stats.moistureStatus,
      systemStats: {
        waterActivations: stats.waterStateCount,
        fertilizerActivations: stats.fertilizerStateCount
      },
      lastReading: readings[0]
    });

  } catch (error) {
    console.error("❌ Error generating stats:", error);
    res.status(500).json({ error: "Failed to generate stats" });
  }
});

// ==========================
// ✅ Scheduling Functions
// ==========================

// Helper function to validate schedule data
function validateScheduleData(data) {
  const { plantId, type, time, days, duration, enabled, label } = data;
  
  if (!plantId) return 'Plant ID is required';
  if (!type || !['watering', 'fertilizing'].includes(type)) return 'Valid type (watering or fertilizing) is required';
  if (!time || !time.match(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)) return 'Valid time in HH:MM format is required';
  if (!days || !Array.isArray(days) || days.length === 0) return 'At least one day of the week is required';
  if (!duration || duration < 1 || duration > 60) return 'Duration must be between 1 and 60 minutes';
  // Label is optional, no validation needed
  
  return null; // No validation errors
}

// Create a new schedule
app.post('/api/schedules', async (req, res) => {
  try {
    const scheduleData = req.body;
    
    // Validate schedule data
    const validationError = validateScheduleData(scheduleData);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    
    // Add timestamp
    scheduleData.createdAt = admin.firestore.FieldValue.serverTimestamp();
    
    // Save to Firestore
    const docRef = await db.collection('schedules').add(scheduleData);
    
    res.status(201).json({ 
      success: true, 
      id: docRef.id,
      schedule: scheduleData 
    });
  } catch (error) {
    console.error('❌ Error creating schedule:', error);
    res.status(500).json({ error: 'Failed to create schedule' });
  }
});

// Get all schedules for a plant
app.get('/api/schedules/:plantId', async (req, res) => {
  try {
    const { plantId } = req.params;
    const { enabled } = req.query; // Optional query parameter to filter by enabled status
    
    // Create base query
    let query = db.collection('schedules').where('plantId', '==', plantId);
    
    // Add enabled filter if specified
    if (enabled !== undefined) {
      const enabledBool = enabled === 'true';
      query = query.where('enabled', '==', enabledBool);
    }
    
    // Add ordering
    const schedulesSnapshot = await query.orderBy('createdAt', 'desc').get();

    const schedules = schedulesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt ? doc.data().createdAt.toDate() : null
    }));

    res.json({ schedules });
  } catch (error) {
    console.error('❌ Error fetching schedules:', error);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

// Update a schedule
app.put('/api/schedules/:scheduleId', async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const updateData = req.body;
    
    // Validate update data
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No update data provided' });
    }
    
    // Update in Firestore
    await db.collection('schedules').doc(scheduleId).update({
      ...updateData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({ success: true, id: scheduleId });
  } catch (error) {
    console.error('❌ Error updating schedule:', error);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

// Delete a schedule
app.delete('/api/schedules/:scheduleId', async (req, res) => {
  try {
    const { scheduleId } = req.params;
    
    // Delete from Firestore
    await db.collection('schedules').doc(scheduleId).delete();
    
    res.json({ success: true, id: scheduleId });
  } catch (error) {
    console.error('❌ Error deleting schedule:', error);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

// Note: The polling endpoint for schedules has been merged with the main GET endpoint
// Use /api/schedules/:plantId?enabled=true to get only enabled schedules

// Add after other helper functions
async function cleanupOldData() {
    // Keep data for last 30 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    
    try {
        const oldData = await db.collection("sensor_data")
            .where("timestamp", "<", cutoffDate)
            .get();

        console.log(`🧹 Cleaning up ${oldData.docs.length} old records`);
        
        const batch = db.batch();
        oldData.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        
        await batch.commit();
    } catch (error) {
        console.error("❌ Cleanup error:", error);
    }
}

// Add cleanup schedule (runs daily)
setInterval(cleanupOldData, 24 * 60 * 60 * 1000);

// Add a diagnostic endpoint
app.get('/diagnostic', (req, res) => {
    res.json({
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        recentRequestsCount: recentRequests.size,
        processId: process.pid,
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage()
    });
});

// ✅ Start the Server
app.listen(port, () => {
  console.log(`✅ Server started at http://localhost:${port}`);
});