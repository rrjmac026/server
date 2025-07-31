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
// ✅ PDF Report Endpoint - FIXED TO SHOW ALL READINGS
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

    console.log('Debug - Report Request:', { plantId, start, end, format });

    // Fetch all readings first
    const readings = await getAllReadingsInRange(plantId, start, end);
    console.log(`Debug - Total readings found: ${readings.length}`);

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
      
      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);

      let currentY = drawPageHeader(doc, 1, 'Plant Monitoring Report');
      currentY += 20;

      // Report details in a centered table
      const reportDetailsWidth = 400;
      const startX = (doc.page.width - reportDetailsWidth) / 2;
      
      // Details table
      doc.rect(startX, currentY, reportDetailsWidth, 60)
         .fillColor('#f9f9f9')
         .fill();
      
      doc.font('Helvetica')
         .fontSize(10)
         .fillColor('#000000');
      
      // Details rows
      const detailsData = [
        ['Plant ID:', plantId, 'Generated:', moment().tz('Asia/Manila').format('YYYY-MM-DD LT')],
        ['Period:', `${moment(start).format('YYYY-MM-DD')} to ${moment(end).format('YYYY-MM-DD')}`, '', '']
      ];
      
      detailsData.forEach((row, i) => {
        const rowY = currentY + (i * 25) + 10;
        doc.font('Helvetica-Bold').text(row[0], startX + 20, rowY);
        doc.font('Helvetica').text(row[1], startX + 80, rowY);
        doc.font('Helvetica-Bold').text(row[2], startX + 220, rowY);
        doc.font('Helvetica').text(row[3], startX + 280, rowY);
      });
      
      currentY += 80;

      // Readings table
      const tableWidth = doc.page.width - 100;
      const tableX = 50;
      
      const headers = ['Date & Time', 'Temperature', 'Humidity', 'Moisture', 'Status'];
      currentY = drawTableHeader(doc, headers, tableX, currentY, tableWidth);
      
      readings.forEach((reading, index) => {
        if (currentY > doc.page.height - 70) {
          doc.addPage();
          currentY = drawPageHeader(doc, Math.floor(index / 20) + 2);
          currentY = drawTableHeader(doc, headers, tableX, currentY, tableWidth);
        }
        
        const rowData = [
          moment(reading.timestamp).format('YYYY-MM-DD HH:mm:ss'),
          `${reading.temperature || 'N/A'}°C`,
          `${reading.humidity || 'N/A'}%`,
          `${reading.moisture || 'N/A'}%`,
          reading.moistureStatus || 'N/A'
        ];
        
        currentY = drawTableRow(doc, rowData, tableX, currentY, tableWidth);
      });
      
      drawPageFooter(doc, moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss'));
      
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

      let currentY = drawPageHeader(doc, 1, 'Plant Monitoring Report');
      currentY += 20;

      // Report details in a centered table
      const reportDetailsWidth = 400;
      const startX = (doc.page.width - reportDetailsWidth) / 2;
      
      // Details table
      doc.rect(startX, currentY, reportDetailsWidth, 60)
         .fillColor('#f9f9f9')
         .fill();
      
      doc.font('Helvetica')
         .fontSize(10)
         .fillColor('#000000');
      
      // Details rows
      const detailsData = [
        ['Plant ID:', plantId, 'Generated:', moment().tz('Asia/Manila').format('YYYY-MM-DD LT')],
        ['Period:', `${moment(start).format('YYYY-MM-DD')} to ${moment(end).format('YYYY-MM-DD')}`, '', '']
      ];
      
      detailsData.forEach((row, i) => {
        const rowY = currentY + (i * 25) + 10;
        doc.font('Helvetica-Bold').text(row[0], startX + 20, rowY);
        doc.font('Helvetica').text(row[1], startX + 80, rowY);
        doc.font('Helvetica-Bold').text(row[2], startX + 220, rowY);
        doc.font('Helvetica').text(row[3], startX + 280, rowY);
      });
      
      currentY += 80;

      // Readings table
      const tableWidth = doc.page.width - 100;
      const tableX = 50;
      
      const headers = ['Date & Time', 'Temperature', 'Humidity', 'Moisture', 'Status'];
      currentY = drawTableHeader(doc, headers, tableX, currentY, tableWidth);
      
      readings.forEach((reading, index) => {
        if (currentY > doc.page.height - 70) {
          doc.addPage();
          currentY = drawPageHeader(doc, Math.floor(index / 20) + 2);
          currentY = drawTableHeader(doc, headers, tableX, currentY, tableWidth);
        }
        
        const rowData = [
          moment(reading.timestamp).format('YYYY-MM-DD HH:mm:ss'),
          `${reading.temperature || 'N/A'}°C`,
          `${reading.humidity || 'N/A'}%`,
          `${reading.moisture || 'N/A'}%`,
          reading.moistureStatus || 'N/A'
        ];
        
        currentY = drawTableRow(doc, rowData, tableX, currentY, tableWidth);
      });
      
      drawPageFooter(doc, moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss'));
      
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

// Add these helper functions after the existing helper functions
function drawTableHeader(doc, headers, x, y, width) {
  const cellWidth = width / headers.length;
  
  // Header background
  doc.fillColor('#2e7d32')
     .rect(x, y, width, 20)
     .fill();

  // Header text
  headers.forEach((header, i) => {
    doc.fillColor('#ffffff')
       .font('Helvetica-Bold')
       .fontSize(10)
       .text(header, 
             x + (i * cellWidth) + 5, 
             y + 5,
             { width: cellWidth - 10 });
  });
  
  return y + 25; // Return next Y position
}

function drawTableRow(doc, data, x, y, width) {
  const cellWidth = width / data.length;
  
  // Alternate row background
  doc.fillColor('#f9f9f9', 0.5)
     .rect(x, y, width, 20)
     .fill();

  // Row data
  data.forEach((cell, i) => {
    doc.fillColor('#000000')
       .font('Helvetica')
       .fontSize(9)
       .text(cell.toString(), 
             x + (i * cellWidth) + 5, 
             y + 5,
             { width: cellWidth - 10 });
  });
  
  return y + 22; // Return next Y position
}

function drawPageHeader(doc, pageNumber, title) {
  const pageWidth = doc.page.width;
  
  // Title container
  doc.rect(50, 30, pageWidth - 100, 70)
     .fill('#f9f9f9');
  
  // Title section - adjusted positioning since there's no logo
  doc.font('Helvetica-Bold')
     .fontSize(24)
     .fillColor('#2e7d32')
     .text('Plant Monitoring System', 60, 40)
     .fontSize(16)
     .fillColor('#666666')
     .text('Detailed Report', 60, 65);
  
  // Page number
  doc.fontSize(10)
     .fillColor('#999999')
     .text(`Page ${pageNumber}`, pageWidth - 100, 40, { align: 'right' });
     
  return 120; // Return Y position after header
}

function drawPageFooter(doc, timestamp) {
  const pageWidth = doc.page.width;
  const footerY = doc.page.height - 50;
  
  // Footer line
  doc.moveTo(50, footerY)
     .lineTo(pageWidth - 50, footerY)
     .strokeColor('#2e7d32')
     .strokeOpacity(0.5)
     .stroke();
  
  // Footer text
  doc.fontSize(8)
     .fillColor('#666666')
     .text(
       `Generated on ${timestamp} - Plant Monitoring System`,
       50,
       footerY + 10,
       { align: 'center', width: pageWidth - 100 }
     );
}

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

// ==========================
// ✅ Event Logging Endpoints
// ==========================

// Add after other helper functions
async function saveEventLog(eventData) {
    const collection = await getCollection('events');
    return await collection.insertOne({
        ...eventData,
        timestamp: moment().tz('Asia/Manila').toDate()
    });
}

// Add new endpoint for event logging
app.post("/api/events", async (req, res) => {
    try {
        const eventData = req.body;
        
        if (!eventData.plantId || !eventData.type || !eventData.action) {
            return res.status(400).json({ error: "Missing required event data" });
        }

        const result = await saveEventLog(eventData);
        res.status(201).json({ message: "Event logged", id: result.insertedId });
    } catch (error) {
        console.error("❌ Error logging event:", error);
        res.status(500).json({ error: "Failed to log event" });
    }
});

// Replace existing /api/reports/:plantId endpoint
app.get("/api/reports/:plantId", async (req, res) => {
    try {
        const { plantId } = req.params;
        const { start, end, format = 'pdf' } = req.query;

        if (!start || !end) {
            return res.status(400).json({ error: "Start and end dates required" });
        }

        // Get sensor readings and events
        const startDate = moment(start).startOf('day').toDate();
        const endDate = moment(end).endOf('day').toDate();

        const [readings, events] = await Promise.all([
            getAllReadingsInRange(plantId, startDate, endDate),
            getCollection('events').then(collection =>
                collection.find({
                    plantId,
                    timestamp: { $gte: startDate, $lte: endDate }
                }).toArray()
            )
        ]);

        // Calculate statistics
        const stats = {
            readings: calculateReadingStats(readings),
            watering: calculateEventStats(events, 'watering'),
            fertilizer: calculateEventStats(events, 'fertilizer')
        };

        if (format === 'json') {
            return res.json({
                plantId,
                period: { start: startDate, end: endDate },
                stats,
                details: {
                    readings,
                    events: events.map(e => ({
                        ...e,
                        timestamp: moment(e.timestamp).format('YYYY-MM-DD HH:mm:ss')
                    }))
                }
            });
        }

        // Generate PDF report
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);

        const doc = new PDFDocument({ margin: 50 });
        doc.pipe(res);

        // Generate enhanced PDF report with events
        generateEnhancedPDFReport(doc, {
            plantId,
            startDate,
            endDate,
            stats,
            readings,
            events
        });

        doc.end();

    } catch (error) {
        console.error("❌ Error generating report:", error);
        res.status(500).json({ error: "Failed to generate report" });
    }
});

// Add new helper functions for report generation
function calculateReadingStats(readings) {
    return {
        total: readings.length,
        averages: readings.reduce((acc, r) => ({
            temperature: acc.temperature + (r.temperature || 0),
            humidity: acc.humidity + (r.humidity || 0),
            moisture: acc.moisture + (r.moisture || 0),
            count: acc.count + 1
        }), { temperature: 0, humidity: 0, moisture: 0, count: 0 }),
        moistureStatus: readings.reduce((acc, r) => {
            acc[r.moistureStatus] = (acc[r.moistureStatus] || 0) + 1;
            return acc;
        }, {})
    };
}

function calculateEventStats(events, type) {
    const typeEvents = events.filter(e => e.type === type);
    return {
        total: typeEvents.length,
        byAction: typeEvents.reduce((acc, e) => {
            acc[e.action] = (acc[e.action] || 0) + 1;
            return acc;
        }, {}),
        firstEvent: typeEvents[0]?.timestamp,
        lastEvent: typeEvents[typeEvents.length - 1]?.timestamp
    };
}

function generateEnhancedPDFReport(doc, data) {
    let currentY = drawPageHeader(doc, 1, 'Plant Monitoring Report');
    currentY += 20;

    // General stats summary
    drawReportSummary(doc, data, currentY);
    
    // Watering and Fertilizer Logs Page
    doc.addPage();
    currentY = drawPageHeader(doc, 2, 'System Activity Logs');
    
    // Watering Events Table
    doc.fontSize(14).text('Watering Activity Log', { underline: true });
    currentY = doc.y + 10;
    
    const waterHeaders = ['Date & Time', 'Action', 'Details'];
    const waterWidth = doc.page.width - 100;
    currentY = drawTableHeader(doc, waterHeaders, 50, currentY, waterWidth);
    
    data.events
        .filter(e => e.type === 'watering')
        .forEach(event => {
            const rowData = [
                moment(event.timestamp).format('YYYY-MM-DD HH:mm:ss'),
                event.action.toUpperCase(),
                event.details || '-'
            ];
            currentY = drawTableRow(doc, rowData, 50, currentY, waterWidth);
            
            // Add new page if needed
            if (currentY > doc.page.height - 100) {
                doc.addPage();
                currentY = drawPageHeader(doc, 3, 'System Activity Logs');
                currentY = drawTableHeader(doc, waterHeaders, 50, currentY, waterWidth);
            }
        });

    // Fertilizer Events Table
    doc.addPage();
    currentY = drawPageHeader(doc, 4, 'System Activity Logs');
    doc.fontSize(14).text('Fertilizer Activity Log', { underline: true });
    currentY = doc.y + 10;
    
    const fertHeaders = ['Date & Time', 'Action', 'Details'];
    currentY = drawTableHeader(doc, fertHeaders, 50, currentY, waterWidth);
    
    data.events
        .filter(e => e.type === 'fertilizer')
        .forEach(event => {
            const rowData = [
                moment(event.timestamp).format('YYYY-MM-DD HH:mm:ss'),
                event.action.toUpperCase(),
                event.details || '-'
            ];
            currentY = drawTableRow(doc, rowData, 50, currentY, waterWidth);
            
            // Add new page if needed
            if (currentY > doc.page.height - 100) {
                doc.addPage();
                currentY = drawPageHeader(doc, 5, 'System Activity Logs');
                currentY = drawTableHeader(doc, fertHeaders, 50, currentY, waterWidth);
            }
        });

    // Sensor Readings Page
    doc.addPage();
    currentY = drawPageHeader(doc, 6, 'Sensor Readings');
    
    // Add sensor readings table (existing code)
    const readingsHeaders = ['Date & Time', 'Temperature', 'Humidity', 'Moisture', 'Status'];
    currentY = drawTableHeader(doc, readingsHeaders, 50, currentY, waterWidth);
    
    readings.forEach((reading, index) => {
        const rowData = [
            moment(reading.timestamp).format('YYYY-MM-DD HH:mm:ss'),
            `${reading.temperature || 'N/A'}°C`,
            `${reading.humidity || 'N/A'}%`,
            `${reading.moisture || 'N/A'}%`,
            reading.moistureStatus || 'N/A'
        ];
        
        currentY = drawTableRow(doc, rowData, 50, currentY, waterWidth);
        
        // Add new page if needed
        if (currentY > doc.page.height - 70) {
            doc.addPage();
            currentY = drawPageHeader(doc, Math.floor(index / 20) + 7);
            currentY = drawTableHeader(doc, readingsHeaders, 50, currentY, waterWidth);
        }
    });
    
    drawPageFooter(doc, moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss'));
}


// Add new helper function for report summary
function drawReportSummary(doc, data, startY) {
    const stats = data.stats;
    const summaryWidth = doc.page.width - 100;
    
    doc.fontSize(12).text('Activity Summary', { underline: true });
    doc.fontSize(10);
    
    // Watering Stats
    doc.text(`Watering Events: ${stats.watering.total}`, 50, doc.y + 10);
    if (stats.watering.byAction) {
        Object.entries(stats.watering.byAction).forEach(([action, count]) => {
            doc.text(`  - ${action}: ${count}`, 70, doc.y + 5);
        });
    }
    
    // Fertilizer Stats
    doc.text(`Fertilizer Events: ${stats.fertilizer.total}`, 50, doc.y + 10);
    if (stats.fertilizer.byAction) {
        Object.entries(stats.fertilizer.byAction).forEach(([action, count]) => {
            doc.text(`  - ${action}: ${count}`, 70, doc.y + 5);
        });
    }
    
    // Sensor Reading Stats
    const avgTemp = stats.readings.averages.temperature / stats.readings.averages.count;
    const avgHumidity = stats.readings.averages.humidity / stats.readings.averages.count;
    const avgMoisture = stats.readings.averages.moisture / stats.readings.averages.count;
    
    doc.text('Sensor Reading Averages:', 50, doc.y + 15);
    doc.text(`  - Temperature: ${avgTemp.toFixed(1)}°C`, 70, doc.y + 5);
    doc.text(`  - Humidity: ${avgHumidity.toFixed(1)}%`, 70, doc.y + 5);
    doc.text(`  - Moisture: ${avgMoisture.toFixed(1)}%`, 70, doc.y + 5);
}

// ==========================
// ✅ Start the Server
// ==========================
app.listen(port, () => {
  console.log(`✅ Server started at http://localhost:${port}`);
});