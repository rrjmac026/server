const moment = require('moment-timezone');
const PDFDocument = require('pdfkit');
const { getCollection } = require('../config/database');
const auditService = require('./audit.service');
const pdfUtils = require('../utils/pdf.utils');

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

    pdfUtils.generateReportPDF(doc, plantId, start, end, readings);
    
    doc.end();
  } else {
    const stats = calculateStats(readings);
    res.json({ 
      totalReadings: readings.length,
      stats,
      allReadings: readings
    });
  }
}

module.exports = {
  generateReport,
  getAllReadingsInRange,
  calculateStats
};