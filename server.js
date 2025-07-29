const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
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

function isSensorDataStale(timestamp) {
  const now = moment();
  const readingTime = moment(timestamp);
  return now.diff(readingTime, 'seconds') > 35;  // Changed to 35 seconds (30s ESP32 interval + 5s buffer)
}

async function getLatestReading(plantId) {
  const snapshot = await db.collection("sensor_data")
    .where("plantId", "==", plantId)
    .orderBy("timestamp", "desc")
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  
  const data = snapshot.docs[0].data();
  const isStale = isSensorDataStale(data.timestamp.toDate());
  
  // Only consider data valid if it's not stale and explicitly marked as connected
  const isConnected = !isStale && data.isConnected === true;
  
  return {
    ...data,
    timestamp: data.timestamp,
    isConnected,
    isOnline: isConnected,
    moisture: isConnected ? data.moisture : 0,
    temperature: isConnected ? data.temperature : 0,
    humidity: isConnected ? data.humidity : 0,
    moistureStatus: !isConnected ? "OFFLINE" : getMoistureStatus(data.moisture)
  };
}

// Function to determine moisture status
function getMoistureStatus(moisture) {
  if (!moisture || moisture === null) return "NO DATA";
  if (moisture === 1023) return "SENSOR ERROR";
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
  try {
    const data = req.body;

    // Optional: Validate incoming data
    if (!data.plantId || data.moisture == null || data.temperature == null || data.humidity == null) {
      return res.status(400).json({ error: "Incomplete sensor data" });
    }

    // Add explicit connection state from ESP32
    data.isConnected = true;  // ESP32 only sends data when connected
    data.moistureStatus = getMoistureStatus(data.moisture);

    // Save to Firestore
    const savedDoc = await saveSensorData(data);
    res.status(201).json({ message: "Sensor data saved", id: savedDoc.id });
  } catch (error) {
    console.error("❌ Error saving sensor data:", error.message);
    res.status(500).json({ error: "Failed to save sensor data" });
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
        moistureStatus: "OFFLINE",
        isOnline: false,
        isConnected: false,
        timestamp: null
      });
    }

    const response = {
      moisture: latestReading.isConnected ? latestReading.moisture : 0,
      temperature: latestReading.isConnected ? latestReading.temperature : 0,
      humidity: latestReading.isConnected ? latestReading.humidity : 0,
      moistureStatus: latestReading.moistureStatus,
      timestamp: moment(latestReading.timestamp.toDate()).tz('Asia/Manila').format(),
      isOnline: latestReading.isConnected,
      isConnected: latestReading.isConnected
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

// Add after the helper functions section
// ==========================
// ✅ Audit Logs Endpoints
// ==========================

// Create audit log
app.post('/api/audit-logs', async (req, res) => {
  try {
    const logData = {
      ...req.body,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    await db.collection('audit_logs').add(logData);
    res.status(201).json({ message: 'Audit log created' });
  } catch (error) {
    console.error('❌ Error creating audit log:', error);
    res.status(500).json({ error: 'Failed to create audit log' });
  }
});

// Get audit logs with filtering
app.get('/api/audit-logs', async (req, res) => {
  try {
    const { startDate, endDate, type, action, limit = 50, page = 1 } = req.query;
    
    let query = db.collection('audit_logs').orderBy('timestamp', 'desc');
    
    if (startDate) {
      query = query.where('timestamp', '>=', new Date(startDate));
    }
    if (endDate) {
      query = query.where('timestamp', '<=', new Date(endDate));
    }
    if (type) {
      query = query.where('type', '==', type);
    }
    if (action) {
      query = query.where('action', '==', action);
    }
    
    const snapshot = await query.get();
    const logs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
    
    res.json({ logs, total: logs.length });
  } catch (error) {
    console.error('❌ Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// Get audit log actions
app.get('/api/audit-logs/actions', async (req, res) => {
  try {
    const snapshot = await db.collection('audit_logs')
      .select('action')
      .get();
    
    const actions = [...new Set(snapshot.docs.map(doc => doc.data().action))];
    res.json({ actions });
  } catch (error) {
    console.error('❌ Error fetching audit log actions:', error);
    res.status(500).json({ error: 'Failed to fetch audit log actions' });
  }
});

// Get audit logs stats
app.get('/api/audit-logs/stats', async (req, res) => {
  try {
    const snapshot = await db.collection('audit_logs').get();
    const logs = snapshot.docs.map(doc => doc.data());
    
    const stats = {
      total: logs.length,
      byType: {},
      byAction: {},
      byStatus: {
        success: logs.filter(log => !log.error).length,
        error: logs.filter(log => log.error).length
      }
    };
    
    logs.forEach(log => {
      stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;
      stats.byAction[log.action] = (stats.byAction[log.action] || 0) + 1;
    });
    
    res.json(stats);
  } catch (error) {
    console.error('❌ Error fetching audit log stats:', error);
    res.status(500).json({ error: 'Failed to fetch audit log stats' });
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

// ✅ Start the Server
app.listen(port, () => {
  console.log(`✅ Server started at http://localhost:${port}`);
});