const moment = require('moment-timezone');
const PDFDocument = require('pdfkit');
const { getCollection } = require('../config/database');
const pdfUtils = require('../utils/pdf.utils');
const crypto = require('crypto');

// Import deduplication config
const dedupConfig = require('../config/deduplication.config');

const DEDUP_WINDOW_MS = dedupConfig.audit.dedupWindowMs;
const ALWAYS_STORE_TYPES = dedupConfig.audit.alwaysStore;

/**
 * Generate a unique fingerprint for an audit log entry
 * Used to detect exact duplicates
 */
function generateAuditFingerprint(data) {
  const fingerprint = {
    plantId: data.plantId,
    type: String(data.type || '').toLowerCase(),
    action: String(data.action || '').toLowerCase(),
    status: String(data.status || 'success').toLowerCase()
  };
  
  // Include sensor data values in fingerprint if present
  if (data.sensorData) {
    fingerprint.sensorData = {
      moisture: data.sensorData.moisture,
      temperature: data.sensorData.temperature,
      humidity: data.sensorData.humidity,
      waterState: Boolean(data.sensorData.waterState),
      fertilizerState: Boolean(data.sensorData.fertilizerState)
    };
  }
  
  const keyData = JSON.stringify(fingerprint);
  return crypto.createHash('md5').update(keyData).digest('hex');
}

/**
 * Check if an audit log is a duplicate within the deduplication window
 */
async function isDuplicateAuditLog(data) {
  // Check if this type should always be stored (no deduplication)
  const logType = String(data.type || '').toLowerCase();
  const actionKey = `${logType}-${String(data.action || '').toLowerCase()}`;
  
  if (ALWAYS_STORE_TYPES.includes(logType) || ALWAYS_STORE_TYPES.includes(actionKey)) {
    return false;
  }
  
  const collection = await getCollection('audit_logs');
  const fingerprint = generateAuditFingerprint(data);
  const timeWindow = new Date(Date.now() - DEDUP_WINDOW_MS);
  
  // Build query to find potential duplicates
  const query = {
    plantId: data.plantId,
    type: String(data.type || '').toLowerCase(),
    action: String(data.action || '').toLowerCase(),
    status: String(data.status || 'success').toLowerCase(),
    timestamp: { $gte: timeWindow }
  };
  
  // Find recent logs matching the criteria
  const recentLogs = await collection.find(query).limit(10).toArray();
  
  // Check if any have the same fingerprint
  for (const log of recentLogs) {
    const logFingerprint = generateAuditFingerprint(log);
    if (logFingerprint === fingerprint) {
      return true;
    }
  }
  
  return false;
}

/**
 * Sanitize and normalize audit log data
 */
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

/**
 * Create an audit log entry with deduplication
 */
async function createAuditLog(data) {
  const collection = await getCollection('audit_logs');
  
  // Check for duplicate before creating
  const isDuplicate = await isDuplicateAuditLog(data);
  
  if (isDuplicate) {
    if (dedupConfig.logging.logDuplicates) {
      console.log(`⚠️  Duplicate audit log detected and skipped:`, {
        plantId: data.plantId,
        type: data.type,
        action: data.action,
        status: data.status
      });
    }
    
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
  
  if (dedupConfig.logging.logReason) {
    console.log(`✅ Audit log created:`, {
      id: result.insertedId,
      plantId: logData.plantId,
      type: logData.type,
      action: logData.action
    });
  }
  
  return {
    insertedId: result.insertedId,
    data: logData,
    isDuplicate: false
  };
}

/**
 * Get audit logs with filtering and pagination
 */
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

/**
 * Export audit logs as PDF or JSON
 */
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

  // JSON format - include seconds in timestamp
  res.json({
    success: true,
    logs: logs.map(log => ({
      ...log,
      timestamp: moment(log.timestamp).tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss') // Added seconds
    }))
  });
}

/**
 * Get distinct audit log types
 */
async function getAuditLogTypes() {
  const collection = await getCollection('audit_logs');
  const types = await collection.distinct('type');
  return types.filter(t => t).map(t => String(t).toLowerCase());
}

/**
 * Get distinct audit log actions
 */
async function getAuditLogActions() {
  const collection = await getCollection('audit_logs');
  const actions = await collection.distinct('action');
  return actions.filter(a => a).map(a => String(a).toLowerCase());
}

/**
 * Utility function to manually clean up duplicate audit logs
 * Can be run as a maintenance task
 */
async function cleanupDuplicateAuditLogs() {
  const collection = await getCollection('audit_logs');
  
  // Find all logs sorted by timestamp
  const allLogs = await collection.find({})
    .sort({ timestamp: 1 })
    .toArray();
  
  const seen = new Map();
  const duplicateIds = [];
  
  for (const log of allLogs) {
    const fingerprint = generateAuditFingerprint(log);
    const lastSeen = seen.get(fingerprint);
    
    if (lastSeen) {
      const timeDiff = new Date(log.timestamp) - new Date(lastSeen.timestamp);
      if (timeDiff < DEDUP_WINDOW_MS) {
        duplicateIds.push(log._id);
      } else {
        seen.set(fingerprint, log);
      }
    } else {
      seen.set(fingerprint, log);
    }
  }
  
  if (duplicateIds.length > 0) {
    const result = await collection.deleteMany({
      _id: { $in: duplicateIds }
    });
    console.log(`🧹 Cleaned up ${result.deletedCount} duplicate audit logs`);
    return result.deletedCount;
  }
  
  console.log('✨ No duplicate audit logs found');
  return 0;
}

module.exports = {
  createAuditLog,
  getAuditLogs,
  exportAuditLogs,
  getAuditLogTypes,
  getAuditLogActions,
  cleanupDuplicateAuditLogs,
  isDuplicateAuditLog,
  generateAuditFingerprint
};