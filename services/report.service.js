const moment = require('moment-timezone');
const PDFDocument = require('pdfkit');
const { getCollection } = require('../config/database');
const auditService = require('./audit.service');
const pdfUtils = require('../utils/pdf.utils');
const crypto = require('crypto');

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
  
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const readings = await collection.find({
    plantId: plantId,
    timestamp: {
      $gte: start,
      $lte: end
    }
  }).sort({ timestamp: -1 }).toArray();
  
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

  // Log report generation
  await auditService.createAuditLog({
    plantId: plantId,
    type: 'report',
    action: 'generate',
    status: 'success',
    details: `Generated ${format.toUpperCase()} report from ${start} to ${end}`
  });

  const readings = await getAllReadingsInRange(plantId, start, end);

  if (!readings || readings.length === 0) {
    if (format === 'json') {
      const emptyReport = {
        isDuplicate: false,
        totalReadings: 0,
        stats: calculateStats([]),
        allReadings: [],
        generatedAt: moment().tz('Asia/Manila').toDate()
      };
      
      // Cache empty report
      await cacheReportData(plantId, start, end, format, emptyReport);
      
      return res.json(emptyReport);
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
      
      res.end(pdfBuffer);
    });
    
    doc.pipe(res);
    pdfUtils.generateReportPDF(doc, plantId, start, end, readings);
    doc.end();
  } else {
    const stats = calculateStats(readings);
    const jsonReport = {
      isDuplicate: false,
      totalReadings: readings.length,
      stats,
      allReadings: readings,
      generatedAt: moment().tz('Asia/Manila').toDate()
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