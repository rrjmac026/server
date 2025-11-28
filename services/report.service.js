const moment = require('moment-timezone');
const PDFDocument = require('pdfkit');
const { getCollection } = require('../config/database');
const auditService = require('./audit.service');
const pdfUtils = require('../utils/pdf.utils');
const crypto = require('crypto');

// ✅ TIMEZONE: All timestamps use Asia/Manila (Philippines Time)
const TIMEZONE = 'Asia/Manila';

// Deduplication configuration for reports
const REPORT_DEDUP_WINDOW_MS = 30000; // 30 seconds - prevent duplicate report generation
const reportCache = new Map(); // In-memory cache for report requests

function generateReportIdempotencyKey(plantId, startDate, endDate, format) {
  const keyData = `${plantId}-${startDate}-${endDate}-${format}`;
  return crypto.createHash('md5').update(keyData).digest('hex');
}

async function isDuplicateReport(plantId, startDate, endDate, format) {
  const idempotencyKey = generateReportIdempotencyKey(plantId, startDate, endDate, format);
  const cachedReport = reportCache.get(idempotencyKey);
  
  if (cachedReport) {
    const timeSinceCache = Date.now() - cachedReport.timestamp;
    if (timeSinceCache < REPORT_DEDUP_WINDOW_MS) {
      return {
        isDuplicate: true,
        cachedData: cachedReport.data,
        message: 'Duplicate report request detected within deduplication window'
      };
    } else {
      // Cache expired, remove it
      reportCache.delete(idempotencyKey);
    }
  }
  
  return { isDuplicate: false };
}

async function cacheReportData(plantId, startDate, endDate, format, data) {
  const idempotencyKey = generateReportIdempotencyKey(plantId, startDate, endDate, format);
  reportCache.set(idempotencyKey, {
    data,
    timestamp: Date.now(),
    plantId,
    startDate,
    endDate,
    format
  });
  
  // Auto-cleanup after deduplication window
  setTimeout(() => {
    reportCache.delete(idempotencyKey);
  }, REPORT_DEDUP_WINDOW_MS);
}

async function getAllReadingsInRange(plantId, startDate, endDate) {
  const collection = await getCollection('sensor_data');
  
  // ✅ FIXED: Convert dates using Philippines timezone
  const start = moment.tz(startDate, TIMEZONE).startOf('day').toDate();
  const end = moment.tz(endDate, TIMEZONE).endOf('day').toDate();
  
  console.log(`📅 Querying sensor data for ${plantId}:`, {
    startDate: moment(start).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss'),
    endDate: moment(end).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss'),
    timezone: TIMEZONE
  });

  const readings = await collection.find({
    plantId: plantId,
    timestamp: {
      $gte: start,
      $lte: end
    }
  }).sort({ timestamp: -1 }).toArray();
  
  console.log(`📊 Found ${readings.length} sensor readings`);
  return readings;
}

function calculateStats(readings) {
  if (!readings || readings.length === 0) {
    return {
      totalTemperature: 0,
      totalHumidity: 0,
      totalMoisture: 0,
      avgTemperature: 0,
      avgHumidity: 0,
      avgMoisture: 0,
      moistureStatus: { dry: 0, humid: 0, wet: 0 },
      waterStateCount: 0,
      fertilizerStateCount: 0
    };
  }

  const stats = readings.reduce((acc, reading) => {
    acc.totalTemperature += reading.temperature || 0;
    acc.totalHumidity += reading.humidity || 0;
    acc.totalMoisture += reading.moisture || 0;
    
    const status = (reading.moistureStatus || '').toLowerCase();
    if (status === 'dry') acc.moistureStatus.dry++;
    else if (status === 'humid') acc.moistureStatus.humid++;
    else if (status === 'wet') acc.moistureStatus.wet++;
    
    acc.waterStateCount += reading.waterState ? 1 : 0;
    acc.fertilizerStateCount += reading.fertilizerState ? 1 : 0;
    return acc;
  }, {
    totalTemperature: 0,
    totalHumidity: 0,
    totalMoisture: 0,
    moistureStatus: { dry: 0, humid: 0, wet: 0 },
    waterStateCount: 0,
    fertilizerStateCount: 0
  });

  // Calculate averages
  const count = readings.length;
  stats.avgTemperature = parseFloat((stats.totalTemperature / count).toFixed(2));
  stats.avgHumidity = parseFloat((stats.totalHumidity / count).toFixed(2));
  stats.avgMoisture = parseFloat((stats.totalMoisture / count).toFixed(2));

  return stats;
}

async function generateReport(req, res, plantId, start, end, format) {
  // Check for duplicate report request
  const dupCheck = await isDuplicateReport(plantId, start, end, format);
  
  if (dupCheck.isDuplicate) {
    console.log(`⚠️  Duplicate report request detected for plantId: ${plantId}`);
    
    if (format === 'json') {
      return res.json({
        isDuplicate: true,
        message: dupCheck.message,
        cachedReport: dupCheck.cachedData
      });
    } else if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
      res.setHeader('X-Report-Cache', 'HIT');
      return res.end(dupCheck.cachedData);
    }
  }

  const readings = await getAllReadingsInRange(plantId, start, end);

  // Log report generation AFTER getting readings - using Philippines time
  await auditService.createAuditLog({
    plantId: plantId,
    type: 'report',
    action: 'generate',
    status: 'success',
    details: `Generated ${format.toUpperCase()} report from ${start} to ${end} (${readings.length} readings)`
  });

  if (!readings || readings.length === 0) {
    if (format === 'json') {
      const emptyReport = {
        isDuplicate: false,
        totalReadings: 0,
        stats: calculateStats([]),
        allReadings: [],
        generatedAt: moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss'),
        timezone: TIMEZONE
      };
      
      // Cache empty report
      await cacheReportData(plantId, start, end, format, emptyReport);
      
      return res.json(emptyReport);
    } else if (format === 'pdf') {
      // Handle empty PDF report
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
      res.setHeader('X-Report-Cache', 'MISS');
      
      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);
      pdfUtils.generateReportPDF(doc, plantId, start, end, []);
      doc.end();
      return;
    }
  }

  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=plant-report-${plantId}.pdf`);
    res.setHeader('X-Report-Cache', 'MISS');
    
    const doc = new PDFDocument({ margin: 50 });
    
    // Collect PDF data for caching
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', async () => {
      const pdfBuffer = Buffer.concat(chunks);
      
      // Cache PDF data
      await cacheReportData(plantId, start, end, format, pdfBuffer);
    });
    
    doc.pipe(res);
    pdfUtils.generateReportPDF(doc, plantId, start, end, readings);
    doc.end();
  } else {
    // JSON format
    const stats = calculateStats(readings);
    const jsonReport = {
      isDuplicate: false,
      totalReadings: readings.length,
      stats,
      allReadings: readings.map(reading => ({
        ...reading,
        // ✅ Format timestamps in Philippines time for JSON export
        timestamp: moment(reading.timestamp).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss')
      })),
      generatedAt: moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss'),
      timezone: TIMEZONE
    };
    
    // Cache JSON report
    await cacheReportData(plantId, start, end, format, jsonReport);
    
    res.json(jsonReport);
  }
}

module.exports = {
  generateReport,
  getAllReadingsInRange,
  calculateStats,
  generateReportIdempotencyKey,
  isDuplicateReport
};