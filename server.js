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
        if (!currentY || currentY > doc.page.height - 90) { // Increased margin for footer
          // Add footer to current page if it's not the first page
          if (currentY) {
            drawPageFooter(doc, moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss'));
          }
          
          // Add new page
          if (currentY) {
            doc.addPage();
          }
          
          // Reset Y position and add header
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
        
        const newY = drawTableRow(doc, rowData, tableX, currentY, tableWidth);
        if (newY === false) {
          // Need a new page
          drawPageFooter(doc, moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss'));
          doc.addPage();
          currentY = drawPageHeader(doc, Math.floor(index / 20) + 2);
          currentY = drawTableHeader(doc, headers, tableX, currentY, tableWidth);
          currentY = drawTableRow(doc, rowData, tableX, currentY, tableWidth);
        } else {
          currentY = newY;
        }
      });
      
      // Add footer to the last page
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
        if (!currentY || currentY > doc.page.height - 90) { // Increased margin for footer
          // Add footer to current page if it's not the first page
          if (currentY) {
            drawPageFooter(doc, moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss'));
          }
          
          // Add new page
          if (currentY) {
            doc.addPage();
          }
          
          // Reset Y position and add header
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
        
        const newY = drawTableRow(doc, rowData, tableX, currentY, tableWidth);
        if (newY === false) {
          // Need a new page
          drawPageFooter(doc, moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss'));
          doc.addPage();
          currentY = drawPageHeader(doc, Math.floor(index / 20) + 2);
          currentY = drawTableHeader(doc, headers, tableX, currentY, tableWidth);
          currentY = drawTableRow(doc, rowData, tableX, currentY, tableWidth);
        } else {
          currentY = newY;
        }
      });
      
      // Add footer to the last page
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
  const FOOTER_SPACE = 50; // Reserve space for footer
  
  // Check if we need a new page (including space for footer)
  if (y > doc.page.height - FOOTER_SPACE) {
    return false;  // Signal that we need a new page
  }
  
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
  
  // Logo and title container
  doc.rect(50, 30, pageWidth - 100, 70)
     .fill('#f9f9f9');
  
  // Add logo
  try {
    doc.image('d:/Bayot FIles/Desktop/Server/assets/ic_new_icon.png', 60, 35, {
      width: 50,
      height: 50
    });
  } catch (error) {
    console.warn('Warning: Logo file not found', error);
  }
  
  // Title section
  doc.font('Helvetica-Bold')
     .fontSize(24)
     .fillColor('#2e7d32')
     .text('Plant Monitoring System', 120, 40)
     .fontSize(16)
     .fillColor('#666666')
     .text('Detailed Report', 120, 65);
  
  // Page number
  doc.fontSize(10)
     .fillColor('#999999')
     .text(`Page ${pageNumber}`, pageWidth - 100, 40, { align: 'right' });
     
  return 120; // Return Y position after header
}

function drawPageFooter(doc, timestamp) {
  const pageWidth = doc.page.width;
  const footerY = doc.page.height - 40;  // Moved up for more space
  
  // Save graphics state
  doc.save();
  
  // Clear any existing content in footer area
  doc.rect(0, footerY - 10, pageWidth, 50)
     .fill('#ffffff');
  
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
  
  // Restore graphics state
  doc.restore();
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

// ✅ Start the Server
app.listen(port, () => {
  console.log(`✅ Server started at http://localhost:${port}`);
});