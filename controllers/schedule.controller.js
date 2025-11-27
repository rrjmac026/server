const scheduleService = require('../services/schedule.service');
const { validateScheduleData } = require('../utils/validators');

async function createSchedule(req, res) {
  try {
    // Validate incoming data
    const validationError = validateScheduleData(req.body);
    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError
      });
    }

    const result = await scheduleService.createSchedule(req.body);
    
    // Return the created schedule with proper format
    res.status(201).json({
      success: true,
      schedule: result,
      message: 'Schedule created successfully'
    });
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function getSchedules(req, res) {
  try {
    const { plantId } = req.params;
    const { enabled } = req.query;

    const schedules = await scheduleService.getSchedules(plantId, enabled);
    res.status(200).json({
      success: true,
      schedules
    });
  } catch (error) {
    console.error('Error fetching schedules:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function updateSchedule(req, res) {
  try {
    const { scheduleId } = req.params;
    
    // Validate if data is provided
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No data provided for update'
      });
    }

    const success = await scheduleService.updateSchedule(scheduleId, req.body);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Schedule updated successfully'
    });
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function deleteSchedule(req, res) {
  try {
    const { scheduleId } = req.params;

    const success = await scheduleService.deleteSchedule(scheduleId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Schedule deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function executeSchedule(req, res) {
  try {
    const { scheduleId } = req.params;

    await scheduleService.executeSchedule(scheduleId);
    
    res.status(200).json({
      success: true,
      message: 'Schedule executed successfully'
    });
  } catch (error) {
    console.error('Error executing schedule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function getScheduleStatus(req, res) {
  try {
    const { scheduleId } = req.params;

    const status = await scheduleService.getScheduleStatus(scheduleId);
    
    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found'
      });
    }

    res.status(200).json({
      success: true,
      status
    });
  } catch (error) {
    console.error('Error fetching schedule status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = {
  createSchedule,
  getSchedules,
  updateSchedule,
  deleteSchedule,
  executeSchedule,
  getScheduleStatus
};