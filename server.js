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
        // Ensure waterState and fertilizerState are boolean values
        waterState: Boolean(data.waterState),
        fertilizerState: Boolean(data.fertilizerState),
        timestamp: moment().tz('Asia/Manila').toDate()
    });

    // Also log this as an audit event
    const auditCollection = await getCollection('audit_logs');
    await auditCollection.insertOne({
        plantId: data.plantId,
        type: 'sensor',
        action: 'read',
        status: 'success',
        timestamp: moment().tz('Asia/Manila').toDate(),
        details: 'Sensor reading recorded',
        sensorData: {
            moisture: data.moisture,
            temperature: data.temperature,
            humidity: data.humidity,
            moistureStatus: data.moistureStatus,
            waterState: Boolean(data.waterState),
            fertilizerState: Boolean(data.fertilizerState),
            isConnected: data.isConnected
        }
    });

    return result;
}

function isSensorDataStale(timestamp) {
  const now = moment();
  const readingTime = moment(timestamp);
  return now.diff(readingTime, 'seconds') > 40;  // Changed to 35 seconds (30s ESP32 interval + 5s buffer)
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
    
    // Convert string dates to MongoDB Date objects and set time to start/end of day
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    
    console.log('Debug - Query params:', {
        plantId,
        startDate: start,
        endDate: end
    });

    const readings = await collection.find({
        plantId: plantId,  // Explicitly match plantId
        timestamp: {
            $gte: start,
            $lte: end
        }
    }).sort({ timestamp: -1 }).toArray();

    console.log(`Debug - Found ${readings.length} readings`);
    
    if (progressCallback) {
        progressCallback(readings.length);
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

    // Update validation to include states
    if (!data.plantId || data.moisture == null || data.temperature == null || 
        data.humidity == null || data.waterState == null || data.fertilizerState == null) {
      return res.status(400).json({ error: "Incomplete sensor data" });
    }

    // Add explicit connection state from ESP32
    data.isConnected = true;
    data.moistureStatus = getMoistureStatus(data.moisture);
    data.waterState = Boolean(data.waterState);
    data.fertilizerState = Boolean(data.fertilizerState);

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
        waterState: false,
        fertilizerState: false,
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
      waterState: latestReading.isConnected ? latestReading.waterState : false,
      fertilizerState: latestReading.isConnected ? latestReading.fertilizerState : false,
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

    // Create audit log entry for report generation
    const auditCollection = await getCollection('audit_logs');
    await auditCollection.insertOne({
      plantId: plantId,
      type: 'report',
      action: 'generate',
      status: 'success',
      timestamp: moment().tz('Asia/Manila').toDate(),
      details: `Generated ${format.toUpperCase()} report from ${start} to ${end}`,
    });

    console.log('Debug - Report Request:', { plantId, start, end, format });

    // Fetch all readings first
    const readings = await getAllReadingsInRange(plantId, start, end);
    console.log(`Debug - Total readings found: ${readings?.length || 0}`);

    if (!readings || readings.length === 0) {
      console.log('Debug - No readings found for criteria:', { plantId, start, end });
      if (format === 'json') {
        return res.json({ 
          totalReadings: 0,
          stats: calculateStats([]),
          allReadings: []
        });
      }
    }

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
         .fillColor('#e8e8e8') // Darker background
         .fill();
      
      // Add border to details table
      doc.rect(startX, currentY, reportDetailsWidth, 80)
         .strokeColor('#000000')
         .lineWidth(1)
         .stroke();
      
      doc.font('Helvetica')
         .fontSize(11) // Slightly larger font
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
    
    // Log failed report generation
    try {
      const auditCollection = await getCollection('audit_logs');
      await auditCollection.insertOne({
        plantId: req.query.plantId,
        type: 'report',
        action: 'generate',
        status: 'failed',
        timestamp: moment().tz('Asia/Manila').toDate(),
        details: `Failed to generate report: ${error.message}`,
      });
    } catch (auditError) {
      console.error("Failed to log report generation error:", auditError);
    }

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

    // Fetch all readings with debug logging
    const readings = await getAllReadingsInRange(plantId, start, end);
    console.log(`Debug - Total readings found: ${readings?.length || 0}`);

    if (!readings || readings.length === 0) {
      console.log('Debug - No readings found for criteria:', { plantId, start, end });
      if (format === 'json') {
        return res.json({ 
          totalReadings: 0,
          stats: calculateStats([]),
          allReadings: []
        });
      }
    }

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
    
    // Log failed report generation
    try {
      const auditCollection = await getCollection('audit_logs');
      await auditCollection.insertOne({
        plantId: req.query.plantId,
        type: 'report',
        action: 'generate',
        status: 'failed',
        timestamp: moment().tz('Asia/Manila').toDate(),
        details: `Failed to generate report: ${error.message}`,
      });
    } catch (auditError) {
      console.error("Failed to log report generation error:", auditError);
    }

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

    // Fetch all readings with debug logging
    const readings = await getAllReadingsInRange(plantId, start, end);
    console.log(`Debug - Total readings found: ${readings?.length || 0}`);

    if (!readings || readings.length === 0) {
      console.log('Debug - No readings found for criteria:', { plantId, start, end });
      if (format === 'json') {
        return res.json({ 
          totalReadings: 0,
          stats: calculateStats([]),
          allReadings: []
        });
      }
    }

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
    
    // Log failed report generation
    try {
      const auditCollection = await getCollection('audit_logs');
      await auditCollection.insertOne({
        plantId: req.query.plantId,
        type: 'report',
        action: 'generate',
        status: 'failed',
        timestamp: moment().tz('Asia/Manila').toDate(),
        details: `Failed to generate report: ${error.message}`,
      });
    } catch (auditError) {
      console.error("Failed to log report generation error:", auditError);
    }

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

    // Fetch all readings with debug logging
    const readings = await getAllReadingsInRange(plantId, start, end);
    console.log(`Debug - Total readings found: ${readings?.length || 0}`);

    if (!readings || readings.length === 0) {
      console.log('Debug - No readings found for criteria:', { plantId, start, end });
      if (format === 'json') {
        return res.json({ 
          totalReadings: 0,
          stats: calculateStats([]),
          allReadings: []
        });
      }
    }

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
    
    // Log failed report generation
    try {
      const auditCollection = await getCollection('audit_logs');
      await auditCollection.insertOne({
        plantId: req.query.plantId,
        type: 'report',
        action: 'generate',
        status: 'failed',
        timestamp: moment().tz('Asia/Manila').toDate(),
        details: `Failed to generate report: ${error.message}`,
      });
    } catch (auditError) {
      console.error("Failed to log report generation error:", auditError);
    }

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

    // Fetch all readings with debug logging
    const readings = await getAllReadingsInRange(plantId, start, end);
    console.log(`Debug - Total readings found: ${readings?.length || 0}`);

    if (!readings || readings.length === 0) {
      console.log('Debug - No readings found for criteria:', { plantId, start, end });
      if (format === 'json') {
        return res.json({ 
          totalReadings: 0,
          stats: calculateStats([]),
          allReadings: []
        });
      }
    }

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
    
    // Log failed report generation
    try {
      const auditCollection = await getCollection('audit_logs');
      await auditCollection.insertOne({
        plantId: req.query.plantId,
        type: 'report',
        action: 'generate',
        status: 'failed',
        timestamp: moment().tz('Asia/Manila').toDate(),
        details: `Failed to generate report: ${error.message}`,
      });
    } catch (auditError) {
      console.error("Failed to log report generation error:", auditError);
    }

    res.status(500).json({ 
      error: "Failed to generate report", 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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
  
  // Skip this row if it would overflow the page
  if (y > doc.page.height - 75) {
    return null; // Return null to indicate need for new page
  }
  
  // Draw row background
  doc.fillColor('#f0f0f0')
     .rect(x, y, width, rowHeight)
     .fill();

  // Draw row border
  doc.strokeColor('#000000')
     .lineWidth(0.8)
     .rect(x, y, width, rowHeight)
     .stroke();

  // Draw cell contents
  let currentX = x;
  data.forEach((cell, i) => {
    if (i > 0) {
      doc.moveTo(currentX, y)
         .lineTo(currentX, y + rowHeight)
         .stroke();
    }
    
    doc.fillColor('#000000')
       .font('Helvetica')
       .fontSize(9)
       .text(
         cell.toString(),
         currentX + 3,
         y + 6,
         {
           width: cellWidths[i] - 6,
           align: 'center',
           lineBreak: false
         }
       );
    
    currentX += cellWidths[i];
  });
  
  return y + rowHeight + 2;
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
  const footerY = doc.page.height - 50;
  
  // Footer line
  doc.moveTo(50, footerY)
     .lineTo(pageWidth - 50, footerY)
     .strokeColor('#000000')
     .strokeOpacity(1)
     .lineWidth(1.5)
     .stroke();
  
  // Footer text with fixed positions
  doc.fontSize(9)
     .fillColor('#000000');

  // Left aligned text
  doc.text(
    `Generated on ${timestamp}`,
    50,
    footerY + 10,
    { width: 200, align: 'left' }
  );

  // Center aligned text
  doc.text(
    'Plant Monitoring System',
    pageWidth / 2 - 100,
    footerY + 10,
    { width: 200, align: 'center' }
  );

  // Right aligned text
  doc.text(
    'Confidential Report',
    pageWidth - 250,
    footerY + 10,
    { width: 200, align: 'right' }
  );
}

// ========================== 
// ✅ Audit Log Endpoints
// ==========================

// Create audit log
app.post("/api/audit-logs", async (req, res) => {
  try {
    const data = req.body;
    const validationError = validateAuditLog(data);
    
    if (validationError) {
        return res.status(400).json({ 
            success: false, 
            error: validationError 
        });
    }

    const collection = await getCollection('audit_logs');
    const logData = sanitizeAuditLog({
        ...data,
        timestamp: moment().tz('Asia/Manila').toDate()
    });

    const result = await collection.insertOne(logData);
    
    res.status(201).json({ 
        success: true,
        id: result.insertedId,
        data: logData 
    });
  } catch (error) {
    console.error("Error creating audit log:", error);
    res.status(500).json({ 
        success: false, 
        error: "Failed to create audit log" 
    });
  }
});

// Get audit logs
app.get("/api/audit-logs", async (req, res) => {
  try {
    const collection = await getCollection('audit_logs');
    const { 
        start, 
        end, 
        type, 
        action, 
        status,
        plantId,
        page = 1, 
        limit = 20,
        sort = 'desc' 
    } = req.query;
    
    console.log('Fetching audit logs with params:', {
        start, end, type, action, status, plantId, page, limit, sort
    });
    
    let query = {};
    
    // Apply filters
    if (plantId) query.plantId = plantId;
    if (type) query.type = type.toLowerCase();
    if (action) query.action = action.toLowerCase();
    if (status) query.status = status.toLowerCase();
    
    // Date range filter
    if (start || end) {
        query.timestamp = {};
        if (start) query.timestamp.$gte = new Date(start);
        if (end) query.timestamp.$lte = new Date(end);
    }

    console.log('MongoDB query:', JSON.stringify(query, null, 2));
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Fetch logs and total count
    const [logs, total] = await Promise.all([
        collection.find(query)
            .sort({ timestamp: sort === 'asc' ? 1 : -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .toArray(),
        collection.countDocuments(query)
    ]);

    console.log(`Found ${logs.length} logs out of ${total} total`);
    
    res.json({
        success: true,
        logs: logs.map(log => ({
            ...log,
            timestamp: log.timestamp
        })),
        pagination: {
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit)),
            limit: parseInt(limit)
        }
    });
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    res.status(500).json({ 
        success: false, 
        error: "Failed to fetch audit logs",
        logs: [] 
    });
  }
});

// Export audit logs (Add this before the Start Server section)
// Enhanced Export audit logs endpoint - Replace the existing one
app.get("/api/audit-logs/export", async (req, res) => {
  try {
    const { start, end, type, plantId, format = 'pdf' } = req.query;

    if (format.toLowerCase() === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=audit_logs_${moment().format('YYYY-MM-DD')}.pdf`);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Pragma', 'no-cache');
    }

    const collection = await getCollection('audit_logs');
    let query = {};
    
    if (plantId) query.plantId = plantId;
    if (type) query.type = type.toLowerCase();
    
    if (start || end) {
      query.timestamp = {};
      if (start) query.timestamp.$gte = new Date(start);
      if (end) query.timestamp.$lte = new Date(end);
    }

    const logs = await collection.find(query)
      .sort({ timestamp: -1 })
      .toArray();

    if (format.toLowerCase() === 'pdf') {
      const doc = new PDFDocument({ 
        margin: 40,
        size: 'A4'
      });
      doc.pipe(res);

      let currentY = drawEnhancedAuditHeader(doc, 1);
      currentY = drawAuditSummarySection(doc, currentY, logs, plantId, start, end, type);
      currentY = drawAuditLogsTable(doc, currentY, logs);
      
      drawEnhancedFooter(doc);
      doc.end();
      return;
    }

    // JSON format as fallback
    res.json({
      success: true,
      logs: logs.map(log => ({
        ...log,
        timestamp: moment(log.timestamp).tz('Asia/Manila').format()
      }))
    });
  } catch (error) {
    console.error("Error exporting audit logs:", error);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        error: "Failed to export audit logs" 
      });
    }
  }
});

// Enhanced helper functions for better PDF design
function drawEnhancedAuditHeader(doc, pageNumber) {
  const pageWidth = doc.page.width;
  const headerHeight = 120;
  
  // Modern gradient-like header background
  doc.rect(0, 0, pageWidth, headerHeight)
     .fillColor('#2c5530')
     .fill();
  
  // Add subtle pattern overlay
  doc.rect(0, 0, pageWidth, headerHeight)
     .fillColor('#34633a')
     .fillOpacity(0.3)
     .fill();
  
  // Reset opacity
  doc.fillOpacity(1);
  
  // Company logo area (circular background)
  const logoX = 60;
  const logoY = 30;
  const logoRadius = 25;
  
  doc.circle(logoX, logoY, logoRadius)
     .fillColor('#ffffff')
     .fillOpacity(0.15)
     .fill()
     .fillOpacity(1);
  
  // Logo text/icon - Using text instead of emoji
  doc.fontSize(16)
     .fillColor('#ffffff')
     .font('Helvetica-Bold')
     .text('PM', logoX - 8, logoY - 8);
  
  // Main title
  doc.fontSize(28)
     .fillColor('#ffffff')
     .font('Helvetica-Bold')
     .text('AUDIT LOGS REPORT', 120, 25);
  
  // Subtitle with modern styling
  doc.fontSize(14)
     .fillColor('#e8f5e8')
     .font('Helvetica')
     .text('Plant Monitoring System • Activity Tracking', 120, 60);
  
  // Page indicator with modern design
  const pageIndicatorX = pageWidth - 120;
  doc.rect(pageIndicatorX, 25, 80, 25)
     .fillColor('#ffffff')
     .fillOpacity(0.1)
     .fill()
     .fillOpacity(1)
     .strokeColor('#ffffff')
     .strokeOpacity(0.3)
     .lineWidth(1)
     .stroke();
  
  doc.fontSize(12)
     .fillColor('#ffffff')
     .font('Helvetica-Bold')
     .text(`Page ${pageNumber}`, pageIndicatorX, 32, { 
       width: 80, 
       align: 'center' 
     });
  
  // Bottom border line with gradient effect
  doc.moveTo(0, headerHeight)
     .lineTo(pageWidth, headerHeight)
     .strokeColor('#1a4d1f')
     .lineWidth(3)
     .stroke();
  
  return headerHeight + 30;
}

function drawAuditSummarySection(doc, startY, logs, plantId, start, end, type) {
  const sectionWidth = doc.page.width - 80;
  const sectionX = 40;
  let currentY = startY;
  
  // Section title
  doc.fontSize(18)
     .fillColor('#2c5530')
     .font('Helvetica-Bold')
     .text('Report Summary', sectionX, currentY);
  
  currentY += 35;
  
  // Summary cards container
  const cardHeight = 80;
  const cardWidth = (sectionWidth - 30) / 3;
  
  // Card 1: Total Logs
  drawSummaryCard(doc, sectionX, currentY, cardWidth, cardHeight, 
    'Total Logs', logs.length.toString(), '#4CAF50', 'LOGS');
  
  // Card 2: Date Range
  const dateRange = start && end ? 
    `${moment(start).format('MMM DD')} - ${moment(end).format('MMM DD, YYYY')}` : 
    'All Time';
  drawSummaryCard(doc, sectionX + cardWidth + 15, currentY, cardWidth, cardHeight,
    'Date Range', dateRange, '#2196F3', 'DATE');
  
  // Card 3: Plant/Type Info
  const filterInfo = plantId ? `Plant ${plantId}` : (type ? type.toUpperCase() : 'All Types');
  drawSummaryCard(doc, sectionX + (cardWidth + 15) * 2, currentY, cardWidth, cardHeight,
    'Filter', filterInfo, '#FF9800', 'FILTER');
  
  currentY += cardHeight + 30;
  
  // Activity breakdown if we have logs
  if (logs.length > 0) {
    currentY = drawActivityBreakdown(doc, sectionX, currentY, sectionWidth, logs);
  }
  
  return currentY + 20;
}

function drawSummaryCard(doc, x, y, width, height, title, value, color, icon) {
  // Card shadow
  doc.rect(x + 2, y + 2, width, height)
     .fillColor('#000000')
     .fillOpacity(0.1)
     .fill()
     .fillOpacity(1);
  
  // Card background
  doc.rect(x, y, width, height)
     .fillColor('#ffffff')
     .fill()
     .strokeColor('#e0e0e0')
     .lineWidth(1)
     .stroke();
  
  // Colored top border
  doc.rect(x, y, width, 4)
     .fillColor(color)
     .fill();
  
  // Icon background
  const iconSize = 30;
  const iconX = x + 15;
  const iconY = y + 15;
  
  doc.circle(iconX + iconSize/2, iconY + iconSize/2, iconSize/2)
     .fillColor(color)
     .fillOpacity(0.1)
     .fill()
     .fillOpacity(1);
  
  // Icon
  doc.fontSize(9)
     .fillColor(color)
     .font('Helvetica-Bold')
     .text(icon, iconX + 5, iconY + 12);
  
  // Title
  doc.fontSize(10)
     .fillColor('#666666')
     .font('Helvetica')
     .text(title.toUpperCase(), iconX + iconSize + 10, iconY + 5);
  
  // Value
  doc.fontSize(16)
     .fillColor('#333333')
     .font('Helvetica-Bold')
     .text(value, iconX + iconSize + 10, iconY + 20, {
       width: width - iconSize - 40,
       lineBreak: false
     });
}

function drawActivityBreakdown(doc, x, y, width, logs) {
  // Count activities by type and status
  const breakdown = logs.reduce((acc, log) => {
    const key = `${log.type}-${log.status}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  
  // Activity breakdown title
  doc.fontSize(14)
     .fillColor('#2c5530')
     .font('Helvetica-Bold')
     .text('Activity Breakdown', x, y);
  
  y += 25;
  
  // Create breakdown bars
  const maxCount = Math.max(...Object.values(breakdown));
  const barHeight = 20;
  const barSpacing = 25;
  
  Object.entries(breakdown).forEach(([key, count], index) => {
    const [type, status] = key.split('-');
    const barWidth = (count / maxCount) * (width * 0.6);
    const barY = y + (index * barSpacing);
    
    // Status color
    const statusColor = getStatusColor(status);
    
    // Bar background
    doc.rect(x, barY, width * 0.6, barHeight)
       .fillColor('#f5f5f5')
       .fill();
    
    // Bar fill
    doc.rect(x, barY, barWidth, barHeight)
       .fillColor(statusColor)
       .fillOpacity(0.8)
       .fill()
       .fillOpacity(1);
    
    // Label
    doc.fontSize(10)
       .fillColor('#333333')
       .font('Helvetica')
       .text(`${type.toUpperCase()} (${status})`, x + width * 0.65, barY + 6);
    
    // Count
    doc.fontSize(10)
       .fillColor('#666666')
       .font('Helvetica-Bold')
       .text(count.toString(), x + width * 0.85, barY + 6);
  });
  
  return y + (Object.keys(breakdown).length * barSpacing) + 20;
}

function getStatusColor(status) {
  const colors = {
    'success': '#4CAF50',
    'failed': '#f44336',
    'warning': '#FF9800',
    'info': '#2196F3'
  };
  return colors[status] || '#9E9E9E';
}

function drawAuditLogsTable(doc, startY, logs) {
  let currentY = startY;
  const pageWidth = doc.page.width;
  const tableX = 40;
  const tableWidth = pageWidth - 80;
  
  // Table title
  doc.fontSize(18)
     .fillColor('#2c5530')
     .font('Helvetica-Bold')
     .text('Detailed Activity Log', tableX, currentY);
  
  currentY += 35;
  
  // If no logs, show message
  if (logs.length === 0) {
    doc.rect(tableX, currentY, tableWidth, 60)
       .fillColor('#f8f9fa')
       .fill()
       .strokeColor('#dee2e6')
       .lineWidth(1)
       .stroke();
    
    doc.fontSize(14)
       .fillColor('#6c757d')
       .font('Helvetica')
       .text('No audit logs found for the selected criteria.', 
             tableX, currentY + 20, { 
               width: tableWidth, 
               align: 'center' 
             });
    
    return currentY + 60;
  }
  
  // Enhanced table headers
  const headers = ['Timestamp', 'Type', 'Action', 'Status', 'Details', 'Data'];
  const colWidths = [
    tableWidth * 0.18, // Timestamp
    tableWidth * 0.12, // Type  
    tableWidth * 0.12, // Action
    tableWidth * 0.10, // Status
    tableWidth * 0.28, // Details
    tableWidth * 0.20  // Data
  ];
  
  currentY = drawEnhancedTableHeader(doc, headers, colWidths, tableX, currentY, tableWidth);
  
  // Table rows with enhanced styling
  logs.forEach((log, index) => {
    // Check for page break
    if (currentY > doc.page.height - 100) {
      doc.addPage();
      currentY = 60;
      currentY = drawEnhancedTableHeader(doc, headers, colWidths, tableX, currentY, tableWidth);
    }
    
    currentY = drawEnhancedTableRow(doc, log, colWidths, tableX, currentY, tableWidth, index);
  });
  
  return currentY;
}

function drawEnhancedTableHeader(doc, headers, colWidths, x, y, width) {
  const headerHeight = 35;
  
  // Header background with gradient effect
  doc.rect(x, y, width, headerHeight)
     .fillColor('#2c5530')
     .fill();
  
  // Add subtle highlight
  doc.rect(x, y, width, 3)
     .fillColor('#4CAF50')
     .fill();
  
  // Header text
  let currentX = x;
  headers.forEach((header, i) => {
    // Column separator line (except for first column)
    if (i > 0) {
      doc.moveTo(currentX, y)
         .lineTo(currentX, y + headerHeight)
         .strokeColor('#ffffff')
         .strokeOpacity(0.2)
         .lineWidth(1)
         .stroke()
         .strokeOpacity(1);
    }
    
    doc.fillColor('#ffffff')
       .font('Helvetica-Bold')
       .fontSize(11)
       .text(header.toUpperCase(), 
             currentX + 8, 
             y + 12, 
             { 
               width: colWidths[i] - 16, 
               align: 'left',
               lineBreak: false
             });
    
    currentX += colWidths[i];
  });
  
  return y + headerHeight;
}

function drawEnhancedTableRow(doc, log, colWidths, x, y, width, index) {
  const baseRowHeight = 45;
  const detailsText = log.details || '-';
  const sensorDataText = log.sensorData ? formatEnhancedSensorData(log.sensorData) : '-';
  
  // Calculate dynamic row height based on content
  const detailsHeight = estimateEnhancedTextHeight(detailsText, colWidths[4] - 16, doc);
  const dataHeight = estimateEnhancedTextHeight(sensorDataText, colWidths[5] - 16, doc);
  const rowHeight = Math.max(baseRowHeight, detailsHeight + 20, dataHeight + 20);
  
  // Alternating row colors with subtle styling
  const bgColor = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
  doc.rect(x, y, width, rowHeight)
     .fillColor(bgColor)
     .fill();
  
  // Row border
  doc.rect(x, y, width, rowHeight)
     .strokeColor('#e9ecef')
     .lineWidth(0.5)
     .stroke();
  
  // Status indicator (colored left border)
  const statusColor = getStatusColor(log.status);
  doc.rect(x, y, 4, rowHeight)
     .fillColor(statusColor)
     .fill();
  
  // Cell data
  const cellData = [
    moment(log.timestamp).format('MMM DD\nHH:mm'),
    (log.type || '-').toUpperCase(),
    (log.action || '-').toUpperCase(),
    log.status || '-',
    detailsText,
    sensorDataText
  ];
  
  // Draw cell content
  let currentX = x;
  cellData.forEach((text, i) => {
    // Column separator
    if (i > 0) {
      doc.moveTo(currentX, y)
         .lineTo(currentX, y + rowHeight)
         .strokeColor('#e9ecef')
         .lineWidth(0.5)
         .stroke();
    }
    
    // Status badge styling for status column
    if (i === 3 && text !== '-') {
      drawStatusBadge(doc, currentX + 8, y + 12, text, statusColor);
    } else {
      // Regular text
      const fontSize = i === 0 ? 9 : (i === 4 || i === 5 ? 8 : 10);
      const fontWeight = (i === 1 || i === 2) ? 'Helvetica-Bold' : 'Helvetica';
      
      doc.fillColor('#333333')
         .font(fontWeight)
         .fontSize(fontSize)
         .text(text, 
               currentX + 8, 
               y + 10, 
               { 
                 width: colWidths[i] - 16, 
                 align: 'left',
                 lineBreak: true,
                 height: rowHeight - 20
               });
    }
    
    currentX += colWidths[i];
  });
  
  return y + rowHeight;
}

function drawStatusBadge(doc, x, y, status, color) {
  const badgeWidth = 60;
  const badgeHeight = 18;
  
  // Badge background
  doc.rect(x, y, badgeWidth, badgeHeight)
     .fillColor(color)
     .fillOpacity(0.1)
     .fill()
     .strokeColor(color)
     .strokeOpacity(0.3)
     .lineWidth(1)
     .stroke()
     .fillOpacity(1)
     .strokeOpacity(1);
  
  // Badge text
  doc.fillColor(color)
     .font('Helvetica-Bold')
     .fontSize(9)
     .text(status.toUpperCase(), x, y + 5, {
       width: badgeWidth,
       align: 'center'
     });
}

function formatEnhancedSensorData(sensorData) {
  if (!sensorData) return '-';
  
  const items = [];
  if (sensorData.moisture !== undefined) items.push(`Moisture: ${sensorData.moisture}%`);
  if (sensorData.temperature !== undefined) items.push(`Temp: ${sensorData.temperature}C`);
  if (sensorData.humidity !== undefined) items.push(`Humidity: ${sensorData.humidity}%`);
  if (sensorData.moistureStatus) items.push(`Status: ${sensorData.moistureStatus}`);
  if (sensorData.waterState !== undefined) items.push(`Water: ${sensorData.waterState ? 'ON' : 'OFF'}`);
  if (sensorData.fertilizerState !== undefined) items.push(`Fertilizer: ${sensorData.fertilizerState ? 'ON' : 'OFF'}`);
  
  return items.join('\n');
}

function estimateEnhancedTextHeight(text, maxWidth, doc) {
  const fontSize = 8;
  const lineHeight = fontSize * 1.4;
  
  if (!text || text === '-') return lineHeight;
  
  const lines = text.split('\n');
  let totalLines = 0;
  
  lines.forEach(line => {
    const words = line.split(' ');
    let currentLine = '';
    let lineCount = 1;
    
    words.forEach(word => {
      const testLine = currentLine + word + ' ';
      const width = doc.widthOfString(testLine, { fontSize });
      
      if (width > maxWidth) {
        currentLine = word + ' ';
        lineCount++;
      } else {
        currentLine = testLine;
      }
    });
    
    totalLines += lineCount;
  });
  
  return totalLines * lineHeight;
}

function drawEnhancedFooter(doc) {
  const pageWidth = doc.page.width;
  const footerY = doc.page.height - 60;
  const timestamp = moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss');
  
  // Footer background
  doc.rect(0, footerY - 10, pageWidth, 70)
     .fillColor('#f8f9fa')
     .fill();
  
  // Top border
  doc.moveTo(0, footerY - 10)
     .lineTo(pageWidth, footerY - 10)
     .strokeColor('#2c5530')
     .lineWidth(2)
     .stroke();
  
  // Footer content
  doc.fontSize(9)
     .fillColor('#666666')
     .font('Helvetica');
  
  // Left: Generation time
  doc.text(`Generated on ${timestamp}`, 40, footerY + 5);
  
  // Center: Company/system name
  doc.text('Plant Monitoring System', pageWidth / 2 - 60, footerY + 5);
  
  // Right: Confidentiality notice
  doc.text('Confidential Report', pageWidth - 140, footerY + 5);
  
  // Bottom line with contact info
  doc.fontSize(8)
     .fillColor('#999999')
     .text('For questions about this report, contact your system administrator', 
           40, footerY + 25, { width: pageWidth - 80, align: 'center' });
}

// Get audit log types
app.get("/api/audit-logs/types", async (req, res) => {
    try {
        const collection = await getCollection('audit_logs');
        const types = await collection.distinct('type');
        
        res.json({
            success: true,
            types: types.filter(t => t).map(t => String(t).toLowerCase())
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: "Failed to fetch log types",
            types: []
        });
    }
});

// Get audit log actions
app.get("/api/audit-logs/actions", async (req, res) => {
    try {
        const collection = await getCollection('audit_logs');
        const actions = await collection.distinct('action');
        
        res.json({
            success: true,
            actions: actions.filter(a => a).map(a => String(a).toLowerCase())
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: "Failed to fetch actions",
            actions: []
        });
    }
});

// Add these helper functions near the other helper functions
function validateAuditLog(data) {
    const requiredFields = ['plantId', 'type', 'action'];
    for (const field of requiredFields) {
        if (!data[field]) {
            return `Missing required field: ${field}`;
        }
    }
    return null;
}

function sanitizeAuditLog(log) {
    return {
        ...log,
        type: String(log.type || '').toLowerCase(),
        action: String(log.action || '').toLowerCase(),
        status: String(log.status || 'success').toLowerCase(),
        timestamp: log.timestamp || new Date(),
        details: log.details || null,
        sensorData: log.sensorData || null
    };
}

// ==========================
// ✅ Scheduling Functions
// ==========================

// Helper function to validate schedule data
// Update your validateScheduleData function in your server:

function validateScheduleData(data) {
  // Basic validation
  if (!data) return 'Schedule data is required';
  if (!data.plantId) return 'Plant ID is required';
  if (!data.type || !['watering', 'fertilizing'].includes(data.type)) {
    return 'Valid type (watering or fertilizing) is required';
  }
  if (!data.time || !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(data.time)) {
    return 'Valid time in HH:MM format is required';
  }
  
  // Type-specific validation
  if (data.type === 'watering') {
    if (!Array.isArray(data.days) || data.days.length === 0) {
      return 'At least one day of the week is required for watering schedule';
    }
    // Ensure calendarDays is empty for watering
    data.calendarDays = [];
  }
  
  if (data.type === 'fertilizing') {
    if (!Array.isArray(data.calendarDays) || data.calendarDays.length === 0) {
      return 'At least one calendar day is required for fertilizing schedule';
    }
    
    // Validate calendar days are numbers between 1-31
    for (const day of data.calendarDays) {
      const dayNum = parseInt(day);
      if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
        return 'Calendar days must be numbers between 1 and 31';
      }
    }
    // Ensure days is empty for fertilizing
    data.days = [];
  }
  
  if (typeof data.duration !== 'number' || data.duration < 1 || data.duration > 60) {
    return 'Duration must be between 1 and 60 minutes';
  }
  
  return null; // No validation errors
}

// Also update your POST /api/schedules endpoint to better handle the data:

app.post('/api/schedules', async (req, res) => {
  try {
    console.log('📥 Received schedule data:', JSON.stringify(req.body, null, 2));
    
    const validationError = validateScheduleData(req.body);
    if (validationError) {
      console.log('❌ Validation error:', validationError);
      return res.status(400).json({ 
        success: false, 
        error: validationError 
      });
    }

    const collection = await getCollection('schedules');
    const scheduleData = {
      ...req.body,
      enabled: req.body.enabled ?? true,
      createdAt: moment().tz('Asia/Manila').toDate(),
      updatedAt: moment().tz('Asia/Manila').toDate()
    };
    
    console.log('💾 Saving schedule to database:', JSON.stringify(scheduleData, null, 2));
    
    const result = await collection.insertOne(scheduleData);
    const insertedSchedule = {
      ...scheduleData,
      _id: result.insertedId,
      id: result.insertedId.toString()
    };

    // Create audit log entry
    const auditCollection = await getCollection('audit_logs');
    await auditCollection.insertOne({
      plantId: scheduleData.plantId,
      type: 'schedule',
      action: 'create',
      status: 'success',
      timestamp: moment().tz('Asia/Manila').toDate(),
      details: `Created ${scheduleData.type} schedule`,
      scheduleData: scheduleData
    });

    console.log('✅ Schedule created successfully with ID:', result.insertedId.toString());

    res.status(201).json({ 
      success: true, 
      id: result.insertedId.toString(),
      schedule: insertedSchedule
    });
  } catch (error) {
    console.error('❌ Error creating schedule:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create schedule',
      details: error.message 
    });
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

// Helper function for schedule execution
async function executeSchedule(schedule) {
    try {
        const collection = await getCollection('schedules');
        const sensorData = await getLatestReading(schedule.plantId);
        
        // Check if device is online
        if (!sensorData.isConnected) {
            throw new Error('Device is offline');
        }

        // Log execution start
        const auditCollection = await getCollection('audit_logs');
        await auditCollection.insertOne({
            plantId: schedule.plantId,
            type: 'schedule',
            action: 'execute',
            status: 'start',
            timestamp: moment().tz('Asia/Manila').toDate(),
            details: `Starting ${schedule.type} schedule execution`,
            scheduleData: schedule
        });

        // Update schedule status to executing
        await collection.updateOne(
            { _id: new require('mongodb').ObjectId(schedule.id) },
            { $set: { 
                status: 'executing',
                lastExecuted: moment().tz('Asia/Manila').toDate()
            }}
        );

        // For watering schedules, check moisture threshold if in auto mode
        if (schedule.type === 'watering' && 
            schedule.settings?.moistureMode === 'auto' && 
            sensorData.moisture <= schedule.settings.moistureThreshold) {
            
            // Send command to ESP32
            await sendCommandToESP32(schedule.plantId, {
                command: 'startWatering',
                duration: schedule.duration * 60 // Convert to seconds
            });
        }
        
        // For fertilizing schedules
        if (schedule.type === 'fertilizing') {
            await sendCommandToESP32(schedule.plantId, {
                command: 'startFertilizing',
                duration: schedule.duration * 60,
                amount: schedule.settings?.fertilizerAmount || 50
            });
        }

        // Log successful execution
        await auditCollection.insertOne({
            plantId: schedule.plantId,
            type: 'schedule',
            action: 'execute',
            status: 'success',
            timestamp: moment().tz('Asia/Manila').toDate(),
            details: `Completed ${schedule.type} schedule execution`,
            scheduleData: schedule
        });

    } catch (error) {
        console.error(`Schedule execution failed: ${error.message}`);
        
        // Log execution failure
        const auditCollection = await getCollection('audit_logs');
        await auditCollection.insertOne({
            plantId: schedule.plantId,
            type: 'schedule',
            action: 'execute',
            status: 'failed',
            timestamp: moment().tz('Asia/Manila').toDate(),
            details: `Failed to execute ${schedule.type} schedule: ${error.message}`,
            scheduleData: schedule
        });

        throw error;
    }
}

// Function to send commands to ESP32
async function sendCommandToESP32(plantId, command) {
    try {
        // Get the latest sensor data to verify connection
        const sensorData = await getLatestReading(plantId);
        if (!sensorData.isConnected) {
            throw new Error('ESP32 device is offline');
        }

        // Send command through MQTT or your preferred communication method
        // This is a placeholder - implement your actual ESP32 communication here
        console.log(`Sending command to ESP32 for plant ${plantId}:`, command);
        
        // Log command sent
        const auditCollection = await getCollection('audit_logs');
        await auditCollection.insertOne({
            plantId: plantId,
            type: 'device',
            action: 'command',
            status: 'sent',
            timestamp: moment().tz('Asia/Manila').toDate(),
            details: `Sent ${command.command} command to device`,
            command: command
        });

        return true;
    } catch (error) {
        console.error(`Failed to send command to ESP32: ${error.message}`);
        throw error;
    }
}

// Schedule execution endpoint
app.post("/api/schedules/:scheduleId/execute", async (req, res) => {
    try {
        const { scheduleId } = req.params;
        const collection = await getCollection('schedules');
        const schedule = await collection.findOne({ 
            _id: new require('mongodb').ObjectId(scheduleId)
        });

        if (!schedule) {
            return res.status(404).json({ error: "Schedule not found" });
        }

        await executeSchedule(schedule);
        res.json({ success: true, message: "Schedule executed successfully" });
    } catch (error) {
        console.error("Schedule execution error:", error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Schedule status endpoint
app.get("/api/schedules/:scheduleId/status", async (req, res) => {
    try {
        const { scheduleId } = req.params;
        const collection = await getCollection('schedules');
        const schedule = await collection.findOne({ 
            _id: new require('mongodb').ObjectId(scheduleId)
        });

        if (!schedule) {
            return res.status(404).json({ error: "Schedule not found" });
        }

        res.json({
            status: schedule.status || 'idle',
            lastExecuted: schedule.lastExecuted,
            enabled: schedule.enabled
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ✅ Start the Server
app.listen(port, () => {
  console.log(`✅ Server started at http://localhost:${port}`);
});

// Add these helper functions for the PDF export
function formatSensorData(sensorData) {
  if (!sensorData) return '-';
  
  const lines = [];
  if (sensorData.moisture !== undefined) lines.push(`Moisture: ${sensorData.moisture}%`);
  if (sensorData.temperature !== undefined) lines.push(`Temp: ${sensorData.temperature}°C`);
  if (sensorData.humidity !== undefined) lines.push(`Humidity: ${sensorData.humidity}%`);
  if (sensorData.moistureStatus) lines.push(`Status: ${sensorData.moistureStatus}`);
  if (sensorData.waterState !== undefined) lines.push(`Water: ${sensorData.waterState ? 'ON' : 'OFF'}`);
  if (sensorData.fertilizerState !== undefined) lines.push(`Fertilizer: ${sensorData.fertilizerState ? 'ON' : 'OFF'}`);
  
  return lines.join('\n');
}

function estimateTextHeight(text, doc) {
  const fontSize = 9;
  const lineHeight = fontSize * 1.2;
  const maxWidth = 150; // Adjust based on your column width
  
  const words = text.split(' ');
  let currentLine = '';
  let lines = 1;
  
  for (const word of words) {
    const testLine = currentLine + word + ' ';
    const width = doc.widthOfString(testLine);
    
    if (width > maxWidth) {
      currentLine = word + ' ';
      lines++;
    } else {
      currentLine = testLine;
    }
  }
  
  return lines * lineHeight;
}