const express = require('express');
const ReportController = require('../controllers/reportController');

const router = express.Router();

// ✅ Generate sensor data report (query parameter)
router.get('/reports', ReportController.generateSensorReport);

// ✅ Generate sensor data report (URL parameter)
router.get('/reports/:plantId', ReportController.generateSensorReportByPlantId);

// ✅ Generate audit logs report
router.get('/reports/audit/export', ReportController.generateAuditReport);

// ✅ Get available report types
router.get('/reports/types', ReportController.getReportTypes);

// ✅ Get report generation status
router.get('/reports/status', ReportController.getReportStatus);

module.exports = router;