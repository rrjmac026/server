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
app.get("/api/audit-logs/export", async (req, res) => {
  try {
    const { start, end, type, plantId, format = 'pdf' } = req.query;

    // Force content type and headers for PDF
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
      // Force content type and attachment
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=audit_logs_${moment().format('YYYY-MM-DD')}.pdf`);
      
      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);

      // Draw header
      let currentY = drawPageHeader(doc, 1, 'Audit Logs Report');
      currentY += 30;

      // Report metadata section
      const reportWidth = doc.page.width - 100;
      const startX = 50;

      // Add metadata box
      doc.rect(startX, currentY, reportWidth, 60)
         .fillColor('#f5f5f5')
         .fill()
         .strokeColor('#000000')
         .stroke();

      // Add metadata content
      doc.fillColor('#000000')
         .fontSize(10)
         .font('Helvetica-Bold')
         .text(`Plant ID: ${plantId || 'All Plants'}`, startX + 15, currentY + 15)
         .text(`Period: ${start && end ? `${moment(start).format('YYYY-MM-DD')} to ${moment(end).format('YYYY-MM-DD')}` : 'All Time'}`, startX + 15, currentY + 35);

      currentY += 80;

      // Table headers
      const headers = ['Timestamp', 'Type', 'Action', 'Status', 'Details'];
      const colWidths = [
        reportWidth * 0.20, // Timestamp
        reportWidth * 0.15, // Type
        reportWidth * 0.20, // Action
        reportWidth * 0.15, // Status
        reportWidth * 0.30  // Details
      ];

      // Draw table header
      doc.fillColor('#1a4e1a')
         .rect(startX, currentY, reportWidth, 20)
         .fill();

      let xPos = startX;
      headers.forEach((header, i) => {
        doc.fillColor('#ffffff')
           .font('Helvetica-Bold')
           .fontSize(10)
           .text(header, xPos + 5, currentY + 5, {
             width: colWidths[i],
             align: 'left'
           });
        xPos += colWidths[i];
      });

      currentY += 20;

      // Draw table rows
      logs.forEach((log, index) => {
        // Check if we need a new page
        if (currentY > doc.page.height - 50) {
          doc.addPage();
          currentY = 50;
          
          // Redraw header on new page
          doc.fillColor('#1a4e1a')
             .rect(startX, currentY, reportWidth, 20)
             .fill();

          xPos = startX;
          headers.forEach((header, i) => {
            doc.fillColor('#ffffff')
               .font('Helvetica-Bold')
               .fontSize(10)
               .text(header, xPos + 5, currentY + 5, {
               width: colWidths[i],
               align: 'left'
            });
            xPos += colWidths[i];
          });
          currentY += 20;
        }

        // Alternate row colors
        if (index % 2 === 0) {
          doc.fillColor('#f9f9f9')
             .rect(startX, currentY, reportWidth, 20)
             .fill();
        }

        // Draw row data
        xPos = startX;
        [
          moment(log.timestamp).format('YYYY-MM-DD HH:mm'),
          log.type || '-',
          log.action || '-',
          log.status || '-',
          log.details || '-'
        ].forEach((text, i) => {
          doc.fillColor('#000000')
             .font('Helvetica')
             .fontSize(9)
             .text(text, xPos + 5, currentY + 5, {
               width: colWidths[i] - 10,
               align: 'left',
               lineBreak: false
             });
          xPos += colWidths[i];
        });

        currentY += 20;
      });

      // Add footer
      drawPageFooter(doc, moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss'));

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
