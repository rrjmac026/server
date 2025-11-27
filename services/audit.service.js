const moment = require('moment-timezone');
const PDFDocument = require('pdfkit');
const { getCollection } = require('../config/database');
const pdfUtils = require('../utils/pdf.utils');
const crypto = require('crypto');

// Add deduplication configuration
const DEDUP_WINDOW_MS = 5000; // 5 seconds - prevent duplicates within this window

function generateIdempotencyKey(data) {
  const keyData = `${data.plantId}-${data.type}-${data.action}-${data.status || 'success'}`;
  return crypto.createHash('md5').update(keyData).digest('hex');
}

async function isDuplicate(data) {
  const collection = await getCollection('audit_logs');
  const idempotencyKey = generateIdempotencyKey(data);
  const timeWindow = new Date(Date.now() - DEDUP_WINDOW_MS);
  
  const existingLog = await collection.findOne({
    plantId: data.plantId,
    type: data.type,
    action: data.action,
    status: data.status || 'success',
    timestamp: { $gte: timeWindow }
  });
  
  return !!existingLog;
}

function sanitizeAuditLog(log) {
  return {
    ...log,
    type: String(log.type || '').toLowerCase(),
    action: String(log.action || '').toLowerCase(),
    status: String(log.status || 'success').toLowerCase(),
    timestamp: log.timestamp || moment().tz('Asia/Manila').toDate(),
    details: log.details || null,
    sensorData: log.sensorData || null
  };
}

async function createAuditLog(data) {
  const collection = await getCollection('audit_logs');
  
  // Check for duplicate before creating
  if (await isDuplicate(data)) {
    return {
      insertedId: null,
      data: null,
      isDuplicate: true,
      message: 'Duplicate audit log detected and skipped'
    };
  }
  
  const logData = sanitizeAuditLog({
    ...data,
    timestamp: moment().tz('Asia/Manila').toDate()
  });

  const result = await collection.insertOne(logData);
  
  return {
    insertedId: result.insertedId,
    data: logData,
    isDuplicate: false
  };
}

async function getAuditLogs(queryParams) {
  const collection = await getCollection('audit_logs');
  const { 
    start, end, type, action, status, plantId,
    page = 1, limit = 20, sort = 'desc' 
  } = queryParams;
  
  let query = {};
  
  if (plantId) query.plantId = plantId;
  if (type) query.type = type.toLowerCase();
  if (action) query.action = action.toLowerCase();
  if (status) query.status = status.toLowerCase();
  
  if (start || end) {
    query.timestamp = {};
    if (start) query.timestamp.$gte = new Date(start);
    if (end) query.timestamp.$lte = new Date(end);
  }
  
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  const [logs, total] = await Promise.all([
    collection.find(query)
      .sort({ timestamp: sort === 'asc' ? 1 : -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray(),
    collection.countDocuments(query)
  ]);
  
  return {
    success: true,
    logs,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit)
    }
  };
}

async function exportAuditLogs(req, res) {
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
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    pdfUtils.generateAuditLogsPDF(doc, logs, plantId, start, end, type);
    
    doc.end();
    return;
  }

  res.json({
    success: true,
    logs: logs.map(log => ({
      ...log,
      timestamp: moment(log.timestamp).tz('Asia/Manila').format()
    }))
  });
}

async function getAuditLogTypes() {
  const collection = await getCollection('audit_logs');
  const types = await collection.distinct('type');
  return types.filter(t => t).map(t => String(t).toLowerCase());
}

async function getAuditLogActions() {
  const collection = await getCollection('audit_logs');
  const actions = await collection.distinct('action');
  return actions.filter(a => a).map(a => String(a).toLowerCase());
}

module.exports = {
  createAuditLog,
  getAuditLogs,
  exportAuditLogs,
  getAuditLogTypes,
  getAuditLogActions
};