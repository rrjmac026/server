const express = require('express');
const ScheduleController = require('../controllers/scheduleController');

const router = express.Router();

// ✅ Create a new schedule
router.post('/schedules', ScheduleController.createSchedule);

// ✅ Get schedules for a plant
router.get('/schedules/:plantId', ScheduleController.getSchedulesByPlant);

// ✅ Update a schedule
router.put('/schedules/:scheduleId', ScheduleController.updateSchedule);

// ✅ Delete a schedule
router.delete('/schedules/:scheduleId', ScheduleController.deleteSchedule);

// ✅ Execute a schedule manually
router.post('/schedules/:scheduleId/execute', ScheduleController.executeSchedule);

// ✅ Get schedule status
router.get('/schedules/:scheduleId/status', ScheduleController.getScheduleStatus);

// ✅ Toggle schedule enabled/disabled
router.patch('/schedules/:scheduleId/toggle', ScheduleController.toggleSchedule);

// ✅ Get schedule execution history
router.get('/schedules/:scheduleId/history', ScheduleController.getScheduleHistory);

// ✅ Get schedules that should run now (for cron jobs)
router.get('/schedules-to-run', ScheduleController.getSchedulesToRun);

// ✅ Bulk update schedules
router.patch('/schedules/bulk-update', ScheduleController.bulkUpdateSchedules);

module.exports = router;