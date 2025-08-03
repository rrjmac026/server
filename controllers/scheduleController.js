const ScheduleService = require('../services/scheduleService');

class ScheduleController {
    /**
     * Create a new schedule
     */
    static async createSchedule(req, res) {
        try {
            const result = await ScheduleService.createSchedule(req.body);
            res.status(201).json(result);
        } catch (error) {
            console.error('❌ Error creating schedule:', error.message);
            res.status(400).json({ 
                success: false, 
                error: error.message
            });
        }
    }

    /**
     * Get schedules for a plant
     */
    static async getSchedulesByPlant(req, res) {
        try {
            const { plantId } = req.params;
            const { enabled } = req.query;
            
            const result = await ScheduleService.getSchedulesByPlant(plantId, enabled);
            res.json(result);
        } catch (error) {
            console.error('❌ Error fetching schedules:', error.message);
            res.status(500).json({ 
                success: false,
                error: "Failed to fetch schedules",
                schedules: []
            });
        }
    }

    /**
     * Update a schedule
     */
    static async updateSchedule(req, res) {
        try {
            const { scheduleId } = req.params;
            const result = await ScheduleService.updateSchedule(scheduleId, req.body);
            
            res.json({
                success: true,
                message: "Schedule updated successfully",
                ...result
            });
        } catch (error) {
            console.error('❌ Error updating schedule:', error.message);
            
            if (error.message === 'Schedule not found') {
                return res.status(404).json({ 
                    success: false,
                    error: error.message 
                });
            }
            
            res.status(400).json({ 
                success: false,
                error: error.message 
            });
        }
    }

    /**
     * Delete a schedule
     */
    static async deleteSchedule(req, res) {
        try {
            const { scheduleId } = req.params;
            const result = await ScheduleService.deleteSchedule(scheduleId);
            
            res.json({
                success: true,
                message: "Schedule deleted successfully",
                ...result
            });
        } catch (error) {
            console.error('❌ Error deleting schedule:', error.message);
            
            if (error.message === 'Schedule not found') {
                return res.status(404).json({ 
                    success: false,
                    error: error.message 
                });
            }
            
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }

    /**
     * Execute a schedule manually
     */
    static async executeSchedule(req, res) {
        try {
            const { scheduleId } = req.params;
            const result = await ScheduleService.executeSchedule(scheduleId);
            
            res.json({
                success: true,
                message: "Schedule executed successfully",
                ...result
            });
        } catch (error) {
            console.error("❌ Schedule execution error:", error.message);
            
            if (error.message === 'Schedule not found') {
                return res.status(404).json({ 
                    success: false,
                    error: error.message 
                });
            }
            
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }

    /**
     * Get schedule status
     */
    static async getScheduleStatus(req, res) {
        try {
            const { scheduleId } = req.params;
            const result = await ScheduleService.getScheduleStatus(scheduleId);
            
            res.json(result);
        } catch (error) {
            console.error("❌ Error getting schedule status:", error.message);
            
            if (error.message === 'Schedule not found') {
                return res.status(404).json({ 
                    success: false,
                    error: error.message 
                });
            }
            
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }

    /**
     * Get schedules that should run now (for polling/cron jobs)
     */
    static async getSchedulesToRun(req, res) {
        try {
            const result = await ScheduleService.getSchedulesToRun();
            res.json(result);
        } catch (error) {
            console.error("❌ Error getting schedules to run:", error.message);
            res.status(500).json({ 
                success: false,
                error: "Failed to get schedules to run",
                schedules: []
            });
        }
    }

    /**
     * Toggle schedule enabled/disabled status
     */
    static async toggleSchedule(req, res) {
        try {
            const { scheduleId } = req.params;
            const { enabled } = req.body;
            
            if (typeof enabled !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    error: "enabled field must be a boolean"
                });
            }

            const result = await ScheduleService.updateSchedule(scheduleId, { enabled });
            
            res.json({
                success: true,
                message: `Schedule ${enabled ? 'enabled' : 'disabled'} successfully`,
                ...result
            });
        } catch (error) {
            console.error('❌ Error toggling schedule:', error.message);
            
            if (error.message === 'Schedule not found') {
                return res.status(404).json({ 
                    success: false,
                    error: error.message 
                });
            }
            
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }

    /**
     * Get schedule execution history
     */
    static async getScheduleHistory(req, res) {
        try {
            const { scheduleId } = req.params;
            const { limit = 10, page = 1 } = req.query;
            
            // This would typically fetch from audit logs
            // For now, we'll return a placeholder response
            res.json({
                success: true,
                scheduleId,
                history: [],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: 0,
                    pages: 0
                },
                message: "Schedule execution history feature coming soon"
            });
        } catch (error) {
            console.error("❌ Error getting schedule history:", error.message);
            res.status(500).json({ 
                success: false,
                error: "Failed to get schedule history"
            });
        }
    }

    /**
     * Bulk update schedules
     */
    static async bulkUpdateSchedules(req, res) {
        try {
            const { scheduleIds, updateData } = req.body;
            
            if (!Array.isArray(scheduleIds) || scheduleIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: "scheduleIds must be a non-empty array"
                });
            }

            const results = await Promise.allSettled(
                scheduleIds.map(id => ScheduleService.updateSchedule(id, updateData))
            );

            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;

            res.json({
                success: true,
                message: `Bulk update completed: ${successful} successful, ${failed} failed`,
                results: {
                    successful,
                    failed,
                    total: scheduleIds.length
                }
            });
        } catch (error) {
            console.error('❌ Error in bulk update:', error.message);
            res.status(500).json({ 
                success: false,
                error: "Failed to perform bulk update"
            });
        }
    }
}

module.exports = ScheduleController;