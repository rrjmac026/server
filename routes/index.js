const express = require('express');
const sensorRoutes = require('./sensorRoutes');
const auditRoutes = require('./auditRoutes');
const scheduleRoutes = require('./scheduleRoutes');
const reportRoutes = require('./reportRoutes');

const router = express.Router();

// Mount route modules
router.use('/api', sensorRoutes);
router.use('/api', auditRoutes);
router.use('/api', scheduleRoutes);
router.use('/api', reportRoutes);

module.exports = router;