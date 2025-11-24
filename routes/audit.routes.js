const express = require('express');
const router = express.Router();
const auditController = require('../controllers/audit.controller');

router.post('/audit-logs', auditController.createAuditLog);
router.get('/audit-logs', auditController.getAuditLogs);
router.get('/audit-logs/export', auditController.exportAuditLogs);
router.get('/audit-logs/types', auditController.getAuditLogTypes);
router.get('/audit-logs/actions', auditController.getAuditLogActions);

module.exports = router;