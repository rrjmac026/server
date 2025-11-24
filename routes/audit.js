const express = require('express');
const moment = require('moment-timezone');
const PDFDocument = require('pdfkit');
const { getCollection } = require('../config/database');
const { validateAuditLog, sanitizeAuditLog } = require('../helpers/validation');
const {
  drawEnhancedAuditHeader,
  drawEnhancedFooter,
  drawAuditSummarySection,
  drawAuditLogsTable
} = require('../helpers/pdf-helpers');

const router = express.Router();

// Create audit log
router.post("/api/audit-logs", async (req, res) => {
  try {
    const data = req.body;
    const validationError = validateAuditLog(data);
    
    if (validationError) {
        return res.status(400).json({ success: false, error: validationError });
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
    res.status(500).json({ success: false, error: "Failed to create audit log" });
  }
});

// Get audit logs
router.get("/api/audit-logs", async (req, res) => {
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

// Enhanced Export audit logs endpoint - Replace the existing one
router.get("/api/audit-logs/export", async (req, res) => {
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

// Get audit log types
router.get("/api/audit-logs/types", async (req, res) => {
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
router.get("/api/audit-logs/actions", async (req, res) => {
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

module.exports = router;