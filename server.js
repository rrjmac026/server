require('dotenv').config();
const { MongoClient } = require('mongodb');

if (!process.env.MONGODB_URI) {
    throw new Error('Please define MONGODB_URI in your environment');
}

let client;
let db;

async function connectToDatabase() {
    if (db) return db;

    if (!client) {
        client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
    }
    
    db = client.db(process.env.MONGODB_DB_NAME || 'plantmonitoringdb');
    return db;
}

const getCollection = async (collection) => {
    const db = await connectToDatabase();
    return db.collection(collection);
};

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const PDFDocument = require("pdfkit");
const moment = require('moment-timezone');

const app = express();
const port = process.env.PORT || 3000;

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
    const collection = await getCollection('sensor_data');
    const result = await collection.insertOne({
        ...data,
        timestamp: moment().tz('Asia/Manila').toDate()
    });
    return result;
}

function isSensorDataStale(timestamp) {
  const now = moment();
  const readingTime = moment(timestamp);
  return now.diff(readingTime, 'seconds') > 90;  // Changed to 35 seconds (30s ESP32 interval + 5s buffer)
}

async function getLatestReading(plantId) {
    const collection = await getCollection('sensor_data');
    const reading = await collection.findOne(
        { plantId },
        { sort: { timestamp: -1 } }
    );
    
    if (!reading) return null;
    
    const isStale = isSensorDataStale(reading.timestamp);
    const isConnected = !isStale && reading.isConnected === true;
    
    return {
        ...reading,
        isConnected,
        isOnline: isConnected,
        moisture: isConnected ? reading.moisture : 0,
        temperature: isConnected ? reading.temperature : 0,
        humidity: isConnected ? reading.humidity : 0,
        moistureStatus: !isConnected ? "OFFLINE" : getMoistureStatus(reading.moisture)
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
  const collection = await getCollection('sensor_data');
  
  const readings = await collection.find({
    plantId,
    timestamp: {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    }
  }).sort({ timestamp: -1 }).toArray();

  return readings;
}

async function getAllReadingsInRange(plantId, startDate, endDate, progressCallback = null) {
    const collection = await getCollection('sensor_data');
    
    // Parse dates and set them to start/end of day
    const start = moment(startDate).startOf('day').toDate();
    const end = moment(endDate).endOf('day').toDate();
    
    console.log('Debug - Date Range:', {
        originalStart: startDate,
        originalEnd: endDate,
        parsedStart: start,
        parsedEnd: end,
        plantId: plantId
    });

    const cursor = collection.find({
        plantId: plantId,
        timestamp: {
            $gte: start,
            $lte: end
        }
    }).sort({ timestamp: -1 });

    const readings = await cursor.toArray();
    console.log(`Debug - Found ${readings.length} readings`);
    
    if (progressCallback) {
        progressCallback(readings.length);
    }
    
    return readings.map(reading => ({
        ...reading,
        timestamp: reading.timestamp instanceof Date ? reading.timestamp : new Date(reading.timestamp)
    }));
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
    const result = await saveSensorData(data);
    res.status(201).json({ message: "Sensor data saved", id: result.insertedId });
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

    // Set up PDF response
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
      
      const doc = new PDFDocument();
      doc.pipe(res);

      doc.fontSize(24).text('Plant Monitoring Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12)
          .text(`Plant ID: ${plantId}`)
          .text(`Report Period: ${moment(start).format('YYYY-MM-DD HH:mm')} to ${moment(end).format('YYYY-MM-DD HH:mm')}`);
      doc.moveDown();

      // Fetch readings first
      const readings = await getAllReadingsInRange(plantId, start, end);
      
      if (!readings || readings.length === 0) {
          doc.fontSize(12).text('No data found for the specified period.');
          doc.end();
          return;
      }

      // Calculate statistics
      let stats = {
          totalTemperature: 0,
          totalHumidity: 0,
          totalMoisture: 0,
          moistureStatus: { dry: 0, humid: 0, wet: 0 },
          waterStateCount: 0,
          fertilizerStateCount: 0
      };

      readings.forEach(reading => {
          stats.totalTemperature += parseFloat(reading.temperature) || 0;
          stats.totalHumidity += parseFloat(reading.humidity) || 0;
          stats.totalMoisture += parseFloat(reading.moisture) || 0;
          if (reading.moistureStatus) {
              const status = reading.moistureStatus.toLowerCase();
              stats.moistureStatus[status] = (stats.moistureStatus[status] || 0) + 1;
          }
          stats.waterStateCount += reading.waterState ? 1 : 0;
          stats.fertilizerStateCount += reading.fertilizerState ? 1 : 0;
      });

      // Write statistics
      doc.fontSize(14).text('Statistics:', { underline: true });
      doc.fontSize(12)
          .text(`Total Readings: ${readings.length}`)
          .text(`Average Temperature: ${(stats.totalTemperature / readings.length).toFixed(2)}°C`)
          .text(`Average Humidity: ${(stats.totalHumidity / readings.length).toFixed(2)}%`)
          .text(`Average Moisture: ${(stats.totalMoisture / readings.length).toFixed(2)}%`);
      doc.moveDown();

      // Write recent readings
      doc.fontSize(14).text('Recent Readings:', { underline: true });
      readings.slice(0, 10).forEach(reading => {
          doc.fontSize(12)
              .text(`Time: ${moment(reading.timestamp).format('YYYY-MM-DD HH:mm:ss')}`)
              .text(`Temperature: ${reading.temperature}°C`)
              .text(`Humidity: ${reading.humidity}%`)
              .text(`Moisture: ${reading.moisture}%`)
              .text(`Status: ${reading.moistureStatus}`);
          doc.moveDown();
      });

      doc.end();
    } else {
      // JSON format
      const readings = await getAllReadingsInRange(plantId, start, end);
      const stats = calculateStats(readings);
      res.json({ 
          totalReadings: readings.length,
          stats,
          recentReadings: readings.slice(0, 10)
      });
    }

  } catch (error) {
    console.error("❌ Report generation error:", error);
    res.status(500).json({ error: "Failed to generate report", details: error.message });
  }
});

// ==========================
// ✅ PDF Report Endpoint (with URL params) - FIXED VERSION
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

    console.log('Debug - Report Request:', { plantId, start, end, format });

    // Fetch all readings first
    const readings = await getAllReadingsInRange(plantId, start, end);
    console.log(`Debug - Total readings found: ${readings.length}`);

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
      
      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);

      // PDF Header
      doc.fontSize(20).text('Plant Monitoring Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12)
        .text(`Plant ID: ${plantId}`)
        .text(`Report Period: ${moment(start).tz('Asia/Manila').format('YYYY-MM-DD LT')} to ${moment(end).tz('Asia/Manila').format('YYYY-MM-DD LT')}`)
        .text(`Generated: ${moment().tz('Asia/Manila').format('YYYY-MM-DD LT')}`);
      doc.moveDown();
      
      if (readings.length === 0) {
        doc.fontSize(12).text('No data found for the specified period.');
        doc.end();
        return;
      }

      // Calculate statistics
      let stats = {
        totalTemperature: 0,
        totalHumidity: 0,
        totalMoisture: 0,
        moistureStatus: { dry: 0, humid: 0, wet: 0 },
        waterStateCount: 0,
        fertilizerStateCount: 0
      };

      readings.forEach(reading => {
        stats.totalTemperature += reading.temperature || 0;
        stats.totalHumidity += reading.humidity || 0;
        stats.totalMoisture += reading.moisture || 0;
        const status = (reading.moistureStatus || 'unknown').toLowerCase();
        stats.moistureStatus[status] = (stats.moistureStatus[status] || 0) + 1;
        stats.waterStateCount += reading.waterState ? 1 : 0;
        stats.fertilizerStateCount += reading.fertilizerState ? 1 : 0;
      });

      // Write statistics
      doc.fontSize(16).text('Summary Statistics:', { underline: true });
      doc.fontSize(12)
        .text(`Total Readings: ${readings.length}`)
        .text(`Average Temperature: ${(stats.totalTemperature / readings.length).toFixed(2)}°C`)
        .text(`Average Humidity: ${(stats.totalHumidity / readings.length).toFixed(2)}%`)
        .text(`Average Moisture: ${(stats.totalMoisture / readings.length).toFixed(2)}%`)
        .text(`Water System Activations: ${stats.waterStateCount}`)
        .text(`Fertilizer System Activations: ${stats.fertilizerStateCount}`);
      doc.moveDown(2);

      // Write ALL readings
      doc.fontSize(16).text('All Sensor Readings:', { underline: true });
      doc.moveDown();

      // Constants for pagination
      const READING_HEIGHT = 85; // Height needed for each reading entry
      const BOTTOM_MARGIN = 100; // Space to leave at bottom of page
      let currentPage = 1;
      let readingsOnCurrentPage = 0;

      readings.forEach((reading, index) => {
        // Check if we need a new page
        if (doc.y > (doc.page.height - BOTTOM_MARGIN - READING_HEIGHT)) {
          doc.addPage();
          currentPage++;
          readingsOnCurrentPage = 0;
          
          // Add page header
          doc.fontSize(10).text(`Page ${currentPage} - Plant Monitoring Report`, { align: 'right' });
          doc.moveDown();
        }

        // Write reading data with better formatting
        doc.fontSize(11)
          .text(`Reading ${index + 1} - ${moment(reading.timestamp).tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss')}`, { underline: true })
          .fontSize(10)
          .text(`Temperature: ${reading.temperature || 'N/A'}°C | Humidity: ${reading.humidity || 'N/A'}% | Moisture: ${reading.moisture || 'N/A'}%`)
          .text(`Status: ${reading.moistureStatus || 'N/A'} | Water: ${reading.waterState ? "ON" : "OFF"} | Fertilizer: ${reading.fertilizerState ? "ON" : "OFF"}`);
        
        doc.moveDown(0.5);
        readingsOnCurrentPage++;
      });

      // Add footer on last page
      doc.fontSize(10).text(`Report generated on ${moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss')}`, { align: 'center' });

      doc.end();
    } else {
      // JSON format - return all readings
      const stats = calculateStats(readings);
      res.json({ 
        totalReadings: readings.length,
        stats,
        allReadings: readings
      });
    }

  } catch (error) {
    console.error("❌ Report generation error:", error);
    res.status(500).json({ error: "Failed to generate report", details: error.message });
  }
});

// Add after the helper functions section
// ==========================
// ✅ Audit Logs Endpoints
// ==========================

// Create audit log
app.post('/api/audit-logs', async (req, res) => {
    try {
        const collection = await getCollection('audit_logs');
        const result = await collection.insertOne({
            ...req.body,
            timestamp: new Date()
        });
        res.status(201).json({ message: 'Audit log created', id: result.insertedId });
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