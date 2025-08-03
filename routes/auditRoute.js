const express = require('express');
const AuditController = require('../controllers/auditController');

const router = express.Router();

// ✅ Create audit log entry
router.post('/audit-logs', AuditController.createAuditLog);

// ✅ Get audit logs with filtering and pagination
router.get('/audit-logs', AuditController.getAuditLogs);

// ✅ Export audit logs (JSON format)
router.get('/audit-logs/export', AuditController.exportAuditLogs);

// ✅ Get audit log types
router.get('/audit-logs/types', AuditController.getAuditTypes);

// ✅ Get audit log actions
router.get('/audit-logs/actions', AuditController.getAuditActions);

// ✅ Get audit statistics
router.get('/audit-logs/stats', AuditController.getAuditStats);

// ✅ Get audit summary
router.get('/audit-logs/summary', AuditController.getAuditSummary);

// ✅ Clean up old audit logs (admin endpoint)
router.delete('/audit-logs/cleanup', AuditController.cleanupAuditLogs);

module.exports = router;