const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/schedule.controller');

router.post('/schedules', scheduleController.createSchedule);
router.get('/schedules/:plantId', scheduleController.getSchedules);
router.put('/schedules/:scheduleId', scheduleController.updateSchedule);
router.delete('/schedules/:scheduleId', scheduleController.deleteSchedule);
router.post('/schedules/:scheduleId/execute', scheduleController.executeSchedule);
router.get('/schedules/:scheduleId/status', scheduleController.getScheduleStatus);

module.exports = router;