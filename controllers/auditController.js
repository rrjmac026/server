const AuditService = require('../services/auditService');

class AuditController {
    /**
     * Create audit log entry
     */
    static async createAuditLog(req, res) {
        try {
            const result = await AuditService.createAuditLog(req.body);
            
            res.status(201).json(result);
        } catch (error) {
            console.error("❌ Error creating audit log:", error.message);
            res.status(400).json({ 
                success: false, 
                error: error.message
            });
        }
    }

    /**
     * Get audit logs with filtering and pagination
     */
    static async getAuditLogs(req, res) {
        try {
            const result = await AuditService.getAuditLogs(req.query);
            res.json(result);
        } catch (error) {
            console.error("❌ Error fetching audit logs:", error.message);
            res.status(500).json({ 
                success: false, 
                error: "Failed to fetch audit logs",
                logs: [],
                pagination: { total: 0, page: 1, pages: 0, limit: 20 }
            });
        }
    }

    /**
     * Export audit logs
     */
    static async exportAuditLogs(req, res) {
        try {
            const result = await AuditService.exportAuditLogs(req.query);
            
            res.json({
                success: true,
                logs: result.logs
            });
        } catch (error) {
            console.error("❌ Error exporting audit logs:", error.message);
            res.status(500).json({ 
                success: false, 
                error: "Failed to export audit logs",
                logs: []
            });
        }
    }

    /**
     * Get audit log types
     */
    static async getAuditTypes(req, res) {
        try {
            const result = await AuditService.getAuditTypes();
            res.json(result);
        } catch (error) {
            console.error("❌ Error fetching audit types:", error.message);
            res.status(500).json({ 
                success: false, 
                error: "Failed to fetch log types",
                types: []
            });
        }
    }

    /**
     * Get audit log actions
     */
    static async getAuditActions(req, res) {
        try {
            const result = await AuditService.getAuditActions();
            res.json(result);
        } catch (error) {
            console.error("❌ Error fetching audit actions:", error.message);
            res.status(500).json({ 
                success: false, 
                error: "Failed to fetch actions",
                actions: []
            });
        }
    }

    /**
     * Get audit statistics
     */
    static async getAuditStats(req, res) {
        try {
            const { plantId, days = 30 } = req.query;
            const result = await AuditService.getAuditStats(plantId, parseInt(days));
            
            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            console.error("❌ Error getting audit stats:", error.message);
            res.status(500).json({ 
                success: false, 
                error: "Failed to get audit statistics"
            });
        }
    }

    /**
     * Clean up old audit logs
     */
    static async cleanupAuditLogs(req, res) {
        try {
            const { days = 365 } = req.query;
            const result = await AuditService.cleanupOldLogs(parseInt(days));
            
            res.json({
                success: true,
                message: `Cleaned up ${result.deletedCount} old audit log records`,
                ...result
            });
        } catch (error) {
            console.error("❌ Error cleaning up audit logs:", error.message);
            res.status(500).json({ 
                success: false, 
                error: "Failed to clean up audit logs"
            });
        }
    }

    /**
     * Get audit log summary
     */
    static async getAuditSummary(req, res) {
        try {
            const { plantId, start, end } = req.query;
            const days = start && end ? 
                Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) : 
                30;

            const [stats, logs] = await Promise.all([
                AuditService.getAuditStats(plantId, days),
                AuditService.getAuditLogs({ 
                    plantId, 
                    start, 
                    end, 
                    limit: 10, 
                    sort: 'desc' 
                })
            ]);

            res.json({
                success: true,
                summary: {
                    period: { start, end, days },
                    statistics: stats,
                    recentLogs: logs.logs,
                    totalLogs: logs.pagination.total
                }
            });
        } catch (error) {
            console.error("❌ Error getting audit summary:", error.message);
            res.status(500).json({ 
                success: false, 
                error: "Failed to get audit summary"
            });
        }
    }
}

module.exports = AuditController;