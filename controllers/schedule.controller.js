const scheduleService = require('../services/schedule.service');
const { validateScheduleData } = require('../utils/validators');

exports.createSchedule = async (req, res) => {
  try {
    const validationError = validateScheduleData(req.body);
    if (validationError) {
      return res.status(400).json({ 
        success: false, 
        error: validationError 
      });
    }

    const result = await scheduleService.createSchedule(req.body);
    res.status(201).json(result);
  } catch (error) {
    console.error('❌ Error creating schedule:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create schedule',
      details: error.message 
    });
  }
};

exports.getSchedules = async (req, res) => {
  try {
    const { plantId } = req.params;
    const { enabled } = req.query;
    const schedules = await scheduleService.getSchedules(plantId, enabled);
    res.json({ schedules });
  } catch (error) {
    console.error('❌ Error fetching schedules:', error);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
};

exports.updateSchedule = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const result = await scheduleService.updateSchedule(scheduleId, req.body);
    
    if (!result) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    
    res.json({ success: true, id: scheduleId });
  } catch (error) {
    console.error('❌ Error updating schedule:', error);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
};

exports.deleteSchedule = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const result = await scheduleService.deleteSchedule(scheduleId);
    
    if (!result) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    
    res.json({ success: true, id: scheduleId });
  } catch (error) {
    console.error('❌ Error deleting schedule:', error);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
};

exports.executeSchedule = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    await scheduleService.executeSchedule(scheduleId);
    res.json({ success: true, message: "Schedule executed successfully" });
  } catch (error) {
    console.error("Schedule execution error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

exports.getScheduleStatus = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const status = await scheduleService.getScheduleStatus(scheduleId);
    
    if (!status) {
      return res.status(404).json({ error: "Schedule not found" });
    }
    
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};