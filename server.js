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
    try {
        const collection = await getCollection('sensor_data');
        console.log('Query params:', {
            plantId,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString()
        });
        
        const cursor = collection.find({
            plantId,
            timestamp: {
                $gte: startDate,
                $lte: endDate
            }
        }).sort({ timestamp: -1 });

        const readings = await cursor.toArray();
        console.log(`Found ${readings.length} readings`);
        
        if (progressCallback) {
            progressCallback(readings.length);
        }
        
        return readings;
    } catch (error) {
        console.error('Error in getAllReadingsInRange:', error);
        throw error;
    }
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
// ==========================
// ✅ Get Latest Sensor Data
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

    // Fix: Parse dates correctly and set time to start/end of day
    const startDate = moment(start).startOf('day').toDate();
    const endDate = moment(end).endOf('day').toDate();

    console.log('Debug - Report Request:', { 
      plantId, 
      startDate: startDate.toISOString(), 
      endDate: endDate.toISOString() 
    });

    // Fix: Use the corrected dates in the query
    const readings = await getAllReadingsInRange(plantId, startDate, endDate);
    console.log(`Debug - Total readings found: ${readings.length}`);

    if (readings.length === 0) {
      if (format === 'pdf') {
        // Return a PDF with "No Data" message
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
        
        const doc = new PDFDocument({ margin: 50 });
        doc.pipe(res);
        
        drawPageHeader(doc, 1, 'Plant Monitoring Report');
        
        doc.moveDown(2)
           .font('Helvetica-Bold')
           .fontSize(14)
           .text('No Data Available', { align: 'center' })
           .moveDown()
           .font('Helvetica')
           .fontSize(12)
           .text(`No readings found for Plant ${plantId} between ${moment(startDate).format('YYYY-MM-DD')} and ${moment(endDate).format('YYYY-MM-DD')}`, {
             align: 'center'
           });
        
        drawPageFooter(doc, moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss'));
        doc.end();
        return;
      } else {
        return res.json({ 
          totalReadings: 0,
          stats: null,
          message: 'No readings found for the specified date range'
        });
      }
    }

    // Rest of the existing PDF generation code...
    // ...existing code...
  } catch (error) {
    console.error("❌ Report generation error:", error);
    res.status(500).json({ 
      error: "Failed to generate report", 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    });
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
      currentY += 30; // Increased spacing after header

      // Report details in a centered table
      const reportDetailsWidth = 400;
      const startX = (doc.page.width - reportDetailsWidth) / 2;
      
      // Details table background
      doc.rect(startX, currentY, reportDetailsWidth, 80) // Increased height
         .fillColor('#f9f9f9')
         .fill();
      
      doc.font('Helvetica')
         .fontSize(10)
         .fillColor('#000000');
      
      // Details rows with better spacing
      const detailsData = [
        ['Plant ID:', plantId, 'Generated:', moment().tz('Asia/Manila').format('YYYY-MM-DD LT')],
        ['Period:', `${moment(start).format('YYYY-MM-DD')} to ${moment(end).format('YYYY-MM-DD')}`, 'Total Records:', readings.length.toString()]
      ];
      
      detailsData.forEach((row, i) => {
        const rowY = currentY + (i * 30) + 15; // Better vertical spacing
        doc.font('Helvetica-Bold').text(row[0], startX + 20, rowY);
        doc.font('Helvetica').text(row[1], startX + 100, rowY); // Adjusted X position
        doc.font('Helvetica-Bold').text(row[2], startX + 220, rowY);
        doc.font('Helvetica').text(row[3], startX + 300, rowY); // Adjusted X position
      });
      
      currentY += 100; // Increased spacing after details

      // Readings table with better spacing
      const tableWidth = doc.page.width - 100;
      const tableX = 50;
      
      const headers = ['Date & Time', 'Temperature', 'Humidity', 'Moisture', 'Status', 'Watering', 'Fertilizer'];
      currentY = drawTableHeader(doc, headers, tableX, currentY, tableWidth);
      
      readings.forEach((reading, index) => {
        if (currentY > doc.page.height - 100) { // More space for footer
          doc.addPage();
          currentY = drawPageHeader(doc, Math.floor(index / 15) + 2); // Fewer rows per page
          currentY = drawTableHeader(doc, headers, tableX, currentY, tableWidth);
        }
        
        const rowData = [
          moment(reading.timestamp).format('MM-DD HH:mm'), // Shorter date format
          `${reading.temperature || 'N/A'}°C`,
          `${reading.humidity || 'N/A'}%`,
          `${reading.moisture || 'N/A'}%`,
          reading.moistureStatus || 'N/A',
          reading.wateringStatus || '-',
          reading.fertilizerStatus || '-'
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

// FIXED HELPER FUNCTIONS with proper positioning
function drawTableHeader(doc, headers, x, y, width) {
  const cellWidths = [
    width * 0.20, // Date & Time - 20%
    width * 0.12, // Temperature - 12%
    width * 0.12, // Humidity - 12%
    width * 0.12, // Moisture - 12%
    width * 0.15, // Status - 15%
    width * 0.145, // Watering - 14.5%
    width * 0.145  // Fertilizer - 14.5%
  ];
  
  // Header background - darker color
  doc.fillColor('#1a4e1a')
     .rect(x, y, width, 25) // Increased height
     .fill();

  // Header border
  doc.strokeColor('#000000')
     .lineWidth(1)
     .rect(x, y, width, 25)
     .stroke();

  // Header text with proper positioning
  let currentX = x;
  headers.forEach((header, i) => {
    doc.fillColor('#ffffff')
       .font('Helvetica-Bold')
       .fontSize(10) // Slightly larger font for better readability
       .text(header, 
             currentX + 3, // Small padding
             y + 7, // Centered vertically
             { 
               width: cellWidths[i] - 6, // Account for padding
               align: 'center',
               lineBreak: false
             });
    currentX += cellWidths[i];
  });
  
  return y + 30; // Return next Y position with spacing
}

function drawTableRow(doc, data, x, y, width) {
  const cellWidths = [
    width * 0.20, // Date & Time - 20%
    width * 0.12, // Temperature - 12%
    width * 0.12, // Humidity - 12%
    width * 0.12, // Moisture - 12%
    width * 0.15, // Status - 15%
    width * 0.145, // Watering - 14.5%
    width * 0.145  // Fertilizer - 14.5%
  ];
  
  const rowHeight = 22;
  
  // Alternate row background - lighter but still visible
  doc.fillColor('#f0f0f0')
     .rect(x, y, width, rowHeight)
     .fill();

  // Row borders - dark for better definition
  doc.strokeColor('#000000')
     .lineWidth(0.8)
     .rect(x, y, width, rowHeight)
     .stroke();

  // Row data with proper positioning
  let currentX = x;
  data.forEach((cell, i) => {
    // Vertical line separators - dark
    if (i > 0) {
      doc.moveTo(currentX, y)
         .lineTo(currentX, y + rowHeight)
         .strokeColor('#000000')
         .lineWidth(0.8)
         .stroke();
    }
    
    doc.fillColor('#000000') // Pure black text
       .font('Helvetica')
       .fontSize(9) // Slightly larger font for better readability
       .text(cell.toString(), 
             currentX + 3, // Small padding
             y + 6, // Centered vertically
             { 
               width: cellWidths[i] - 6, // Account for padding
               align: 'center',
               lineBreak: false
             });
    currentX += cellWidths[i];
  });
  
  return y + rowHeight + 2; // Return next Y position with small spacing
}

function drawPageHeader(doc, pageNumber, title) {
  const pageWidth = doc.page.width;
  
  // Title container with darker styling
  doc.rect(50, 30, pageWidth - 100, 80)
     .fillColor('#e0e0e0') // Darker background
     .fill();
  
  // Border for header - darker
  doc.rect(50, 30, pageWidth - 100, 80)
     .strokeColor('#000000')
     .lineWidth(2)
     .stroke();
  
  // Title section with darker colors
  doc.font('Helvetica-Bold')
     .fontSize(22)
     .fillColor('#1a4e1a') // Darker green
     .text('Plant Monitoring System', 70, 45, { align: 'left' })
     .fontSize(14)
     .fillColor('#333333') // Darker gray
     .text('Detailed Monitoring Report', 70, 70, { align: 'left' });
  
  // Page number with darker color
  doc.fontSize(10)
     .fillColor('#000000') // Pure black
     .text(`Page ${pageNumber}`, pageWidth - 120, 45, { align: 'right', width: 60 });
     
  return 130; // Return Y position after header with more spacing
}

function drawPageFooter(doc, timestamp) {
  const pageWidth = doc.page.width;
  const footerY = doc.page.height - 60; // More space from bottom
  
  // Footer line - darker
  doc.moveTo(50, footerY)
     .lineTo(pageWidth - 50, footerY)
     .strokeColor('#000000')
     .strokeOpacity(1)
     .lineWidth(1.5)
     .stroke();
  
  // Footer text with darker colors
  doc.fontSize(9) // Slightly larger font
     .fillColor('#000000') // Pure black
     .text(
       `Generated on ${timestamp}`,
       50,
       footerY + 10,
       { align: 'left' }
     )
     .text(
       'Plant Monitoring System',
       50,
       footerY + 10,
       { align: 'center', width: pageWidth - 100 }
     )
     .text(
       'Confidential Report',
       50,
       footerY + 10,
       { align: 'right', width: pageWidth - 100 }
     );
}

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
    const collection = await getCollection('schedules');
    const scheduleData = {
      ...req.body,
      createdAt: new Date()
    };
    
    const result = await collection.insertOne(scheduleData);
    res.status(201).json({ 
      success: true, 
      id: result.insertedId,
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
    const { enabled } = req.query;
    const collection = await getCollection('schedules');
    
    // Build query
    let query = { plantId };
    if (enabled !== undefined) {
      query.enabled = enabled === 'true';
    }
    
    // Add sorting
    const schedules = await collection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

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
    const collection = await getCollection('schedules');
    const { ObjectId } = require('mongodb');
    
    const result = await collection.updateOne(
      { _id: new ObjectId(scheduleId) },
      { 
        $set: {
          ...req.body,
          updatedAt: new Date()
        }
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    
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
    const collection = await getCollection('schedules');
    const { ObjectId } = require('mongodb');
    
    const result = await collection.deleteOne({ _id: new ObjectId(scheduleId) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    
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