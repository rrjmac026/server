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

      // Enhanced PDF Header with Logo
      try {
        // Add logo
        doc.image('d:/Bayot FIles/Desktop/Server/assets/ic_new_icon.png', 50, 45, {
          width: 50,
          height: 50
        });
      } catch (error) {
        console.warn('Warning: Logo file not found', error);
      }

      // Header Design
      doc.font('Helvetica-Bold')
         .fontSize(24)
         .text('Plant Monitoring System', 120, 50)
         .fontSize(16)
         .text('Detailed Report', 120, 75);

      // Add decorative line
      doc.moveTo(50, 110)
         .lineTo(550, 110)
         .strokeColor('#2e7d32')
         .lineWidth(2)
         .stroke();

      // Report Details with better formatting
      doc.moveDown(2)
         .font('Helvetica')
         .fontSize(12)
         .fillColor('#000000');

      // Create a table-like structure for report details
      const startX = 50;
      let startY = doc.y;
      
      // Left column
      doc.text('Plant ID:', startX, startY)
         .font('Helvetica-Bold')
         .text(plantId, startX + 100, startY)
         .font('Helvetica');

      // Right column
      doc.text('Generated:', 300, startY)
         .font('Helvetica-Bold')
         .text(moment().tz('Asia/Manila').format('YYYY-MM-DD LT'), 380, startY)
         .font('Helvetica');

      // Second row
      startY += 25;
      doc.text('Period:', startX, startY)
         .font('Helvetica-Bold')
         .text(`${moment(start).tz('Asia/Manila').format('YYYY-MM-DD')} to ${moment(end).tz('Asia/Manila').format('YYYY-MM-DD')}`, 
               startX + 100, startY)
         .font('Helvetica');

      // Add another decorative line
      doc.moveDown(2)
         .moveTo(50, doc.y)
         .lineTo(550, doc.y)
         .strokeColor('#2e7d32')
         .lineWidth(1)
         .stroke()
         .moveDown();

      // Rest of your PDF generation code...
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

      readings.forEach((reading, index) => {
        // Check if we need a new page
        if (doc.y > (doc.page.height - BOTTOM_MARGIN - READING_HEIGHT)) {
          doc.addPage();
          currentPage++;
          
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

      // Enhanced PDF Header with Logo
      try {
        // Add logo
        doc.image('d:/Bayot FIles/Desktop/Server/assets/ic_new_icon.png', 50, 45, {
          width: 50,
          height: 50
        });
      } catch (error) {
        console.warn('Warning: Logo file not found', error);
      }

      // Header Design
      doc.font('Helvetica-Bold')
         .fontSize(24)
         .text('Plant Monitoring System', 120, 50)
         .fontSize(16)
         .text('Detailed Report', 120, 75);

      // Add decorative line
      doc.moveTo(50, 110)
         .lineTo(550, 110)
         .strokeColor('#2e7d32')
         .lineWidth(2)
         .stroke();

      // Report Details with better formatting
      doc.moveDown(2)
         .font('Helvetica')
         .fontSize(12)
         .fillColor('#000000');

      // Create a table-like structure for report details
      const startX = 50;
      let startY = doc.y;
      
      // Left column
      doc.text('Plant ID:', startX, startY)
         .font('Helvetica-Bold')
         .text(plantId, startX + 100, startY)
         .font('Helvetica');

      // Right column
      doc.text('Generated:', 300, startY)
         .font('Helvetica-Bold')
         .text(moment().tz('Asia/Manila').format('YYYY-MM-DD LT'), 380, startY)
         .font('Helvetica');

      // Second row
      startY += 25;
      doc.text('Period:', startX, startY)
         .font('Helvetica-Bold')
         .text(`${moment(start).tz('Asia/Manila').format('YYYY-MM-DD')} to ${moment(end).tz('Asia/Manila').format('YYYY-MM-DD')}`, 
               startX + 100, startY)
         .font('Helvetica');

      // Add another decorative line
      doc.moveDown(2)
         .moveTo(50, doc.y)
         .lineTo(550, doc.y)
         .strokeColor('#2e7d32')
         .lineWidth(1)
         .stroke()
         .moveDown();

      // Rest of your PDF generation code...
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

// Add helper functions after the existing helper functions and before the routes
function drawRoundedRect(doc, x, y, width, height, radius) {
  doc.roundedRect(x, y, width, height, radius);
}

function addGradientBackground(doc, x, y, width, height, color1, color2) {
  const steps = 20;
  for (let i = 0; i < steps; i++) {
    const opacity = 0.1 - (i * 0.005);
    doc.fillColor(color1, opacity)
       .rect(x, y + (i * height / steps), width, height / steps)
       .fill();
  }
}

function createStatsCard(doc, x, y, width, height, title, value, subtitle, color) {
  // Card background with shadow effect
  doc.fillColor('#f8f9ff', 0.8)
     .roundedRect(x + 2, y + 2, width, height, 8)
     .fill();
  
  // Main card
  doc.fillColor('#ffffff')
     .roundedRect(x, y, width, height, 8)
     .fill()
     .strokeColor('#e2e8f0')
     .lineWidth(1)
     .stroke();
  
  // Colored accent bar
  doc.fillColor(color)
     .rect(x, y, width, 4)
     .fill();
  
  // Title
  doc.fillColor('#1a202c')
     .font('Helvetica-Bold')
     .fontSize(10)
     .text(title, x + 15, y + 20, { width: width - 30 });
  
  // Value
  doc.fillColor(color)
     .font('Helvetica-Bold')
     .fontSize(24)
     .text(value, x + 15, y + 35, { width: width - 30 });
  
  // Subtitle
  doc.fillColor('#718096')
     .font('Helvetica')
     .fontSize(9)
     .text(subtitle, x + 15, y + 65, { width: width - 30 });
}

function createDataVisualization(doc, x, y, width, height, data, title) {
  // Background
  doc.fillColor('#ffffff')
     .roundedRect(x, y, width, height, 8)
     .fill()
     .strokeColor('#e2e8f0')
     .lineWidth(1)
     .stroke();
  
  // Title
  doc.fillColor('#2d3748')
     .font('Helvetica-Bold')
     .fontSize(12)
     .text(title, x + 20, y + 15);
  
  // Simple bar chart representation
  const chartY = y + 40;
  const chartHeight = height - 60;
  const barWidth = (width - 60) / data.length;
  
  data.forEach((item, index) => {
    const barHeight = (item.value / Math.max(...data.map(d => d.value))) * chartHeight;
    const barX = x + 20 + (index * barWidth);
    const barY = chartY + chartHeight - barHeight;
    
    // Bar
    doc.fillColor(item.color || '#4299e1')
       .rect(barX + 5, barY, barWidth - 10, barHeight)
       .fill();
    
    // Label
    doc.fillColor('#718096')
       .font('Helvetica')
       .fontSize(8)
       .text(item.label, barX, chartY + chartHeight + 5, { 
         width: barWidth, 
         align: 'center' 
       });
  });
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