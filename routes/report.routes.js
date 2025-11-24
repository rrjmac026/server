const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');

router.get('/reports', reportController.generateReport);
router.get('/reports/:plantId', reportController.generateReportByPlantId);

module.exports = router;