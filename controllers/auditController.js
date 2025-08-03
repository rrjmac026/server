const AuditService = require('../services/auditService');
const AuditUtils = require('../utils/auditUtils');
const moment = require('moment-timezone');

class AuditController {
    /**
     * Create audit log entry
     */
    static async createAuditLog(req, res) {
        try {
            const data = req.body;
            const validationError = AuditUtils.validateAuditLog(data);
            
            if (validationError) {
                return res.status(400).json({ 
                    success: false, 
                    error: validationError 
                });
            }

            const result = await AuditService.createAuditLog(data);
            
            res.status(201).json({ 
                success: true,
                id: result.insertedId,
                data: result.logData 
            });
        } catch (error) {
            console.error("Error creating audit log:", error);
            res.status(500).json({ 
                success: false, 
                error: "Failed to create audit log" 
            });
        }
    }

    /**
     * Get audit logs with filtering and pagination
     */
    static async getAuditLogs(req, res) {
        try {
            const { 
                start, 
                end, 
                type, 
                action, 
                status,
                plantId,
                page = 1, 
                limit = 20,
                sort = 'desc' 
            } = req.query;
            
            console.log('Fetching audit logs with params:', {
                start, end, type, action, status, plantId, page, limit, sort
            });
            
            const result = await AuditService.getAuditLogs({
                start, end, type, action, status, plantId, page, limit, sort
            });

            console.log(`Found ${result.logs.length} logs out of ${result.pagination.total} total`);
            
            res.json({
                success: true,
                logs: result.logs.map(log => ({
                    ...log,
                    timestamp: log.timestamp
                })),
                pagination: result.pagination
            });
        } catch (error) {
            console.error("Error fetching audit logs:", error);
            res.status(500).json({ 
                success: false, 
                error: "Failed to fetch audit logs",
                logs: [] 
            });
        }
    }

    /**
     * Export audit logs as PDF
     */
    static async exportAuditLogs(req, res) {
        try {
            const { start, end, type, plantId, format = 'pdf' } = req.query;

            if (format.toLowerCase() === 'pdf') {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 
                    `attachment; filename=audit_logs_${moment().format('YYYY-MM-DD')}.pdf`);
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Pragma', 'no-cache');
            }

            const logs = await AuditService.getLogsForExport({ start, end, type, plantId });

            if (format.toLowerCase() === 'pdf') {
                const PDFDocument = require('pdfkit');
                const doc = new PDFDocument({ 
                    margin: 40,
                    size: 'A4'
                });
                doc.pipe(res);

                let currentY = AuditUtils.drawEnhancedAuditHeader(doc, 1);
                currentY = AuditUtils.drawAuditSummarySection(doc, currentY, logs, plantId, start, end, type);
                currentY = AuditUtils.drawAuditLogsTable(doc, currentY, logs);
                
                AuditUtils.drawEnhancedFooter(doc);
                doc.end();
                return;
            }

            // JSON format as fallback
            res.json({
                success: true,
                logs: logs.map(log => ({
                    ...log,
                    timestamp: moment(log.timestamp).tz('Asia/Manila').format()
                }))
            });
        } catch (error) {
            console.error("Error exporting audit logs:", error);
            if (!res.headersSent) {
                res.status(500).json({ 
                    success: false, 
                    error: "Failed to export audit logs" 
                });
            }
        }
    }

    /**
     * Get audit log types
     */
    static async getAuditTypes(req, res) {
        try {
            const types = await AuditService.getAuditTypes();
            
            res.json({
                success: true,
                types: types.filter(t => t).map(t => String(t).toLowerCase())
            });
        } catch (error) {
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
            const actions = await AuditService.getAuditActions();
            
            res.json({
                success: true,
                actions: actions.filter(a => a).map(a => String(a).toLowerCase())
            });
        } catch (error) {
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