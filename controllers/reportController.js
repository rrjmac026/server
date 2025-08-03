const ReportService = require('../services/reportService');
const AuditService = require('../services/auditService');
const moment = require('moment-timezone');

class ReportController {
    /**
     * Generate sensor data report
     */
    static async generateSensorReport(req, res) {
        try {
            const { plantId, start, end, format = 'pdf' } = req.query;
            
            if (!plantId || !start || !end) {
                return res.status(400).json({
                    error: "Missing parameters",
                    example: "/api/reports?plantId=123&start=2024-01-01&end=2024-01-31&format=pdf|json"
                });
            }

            const result = await ReportService.generateSensorReport(plantId, start, end, format);

            if (format === 'json') {
                await AuditService.logReportGeneration(plantId, format, start, end, true);
                return res.json(result.data);
            }

            if (format === 'pdf') {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename=${result.filename}`);
                await AuditService.logReportGeneration(plantId, format, start, end, true);
                return res.send(result.buffer);
            }

            res.status(400).json({ error: "Invalid format specified" });
        } catch (error) {
            console.error("❌ Report generation error:", error);
            
            // Log failed report generation
            try {
                await AuditService.logReportGeneration(
                    req.query.plantId, 
                    req.query.format, 
                    req.query.start, 
                    req.query.end, 
                    false, 
                    error.message
                );
            } catch (auditError) {
                console.error("Failed to log report generation error:", auditError);
            }

            res.status(500).json({ 
                error: "Failed to generate report", 
                details: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }

    /**
     * Generate sensor data report with plant ID in URL
     */
    static async generateSensorReportByPlantId(req, res) {
        try {
            const { plantId } = req.params;
            const { start, end, format = 'pdf' } = req.query;
            
            if (!start || !end) {
                return res.status(400).json({
                    error: "Missing parameters",
                    example: "/api/reports/PLANT123?start=2024-01-01&end=2024-01-31&format=pdf|json"
                });
            }

            console.log('Debug - Report Request:', { plantId, start, end, format });

            const result = await ReportService.generateSensorReport(plantId, start, end, format);

            if (format === 'json') {
                await AuditService.logReportGeneration(plantId, format, start, end, true);
                return res.json(result.data);
            }

            if (format === 'pdf') {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename=${result.filename}`);
                await AuditService.logReportGeneration(plantId, format, start, end, true);
                return res.send(result.buffer);
            }

            res.status(400).json({ error: "Invalid format specified" });
        } catch (error) {
            console.error("❌ Report generation error:", error);
            
            // Log failed report generation
            try {
                await AuditService.logReportGeneration(
                    req.params.plantId,
                    req.query.format,
                    req.query.start,
                    req.query.end,
                    false,
                    error.message
                );
            } catch (auditError) {
                console.error("Failed to log report generation error:", auditError);
            }

            res.status(500).json({ 
                error: "Failed to generate report", 
                details: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }

    /**
     * Generate audit logs report
     */
    static async generateAuditReport(req, res) {
        try {
            const { start, end, type, plantId, format = 'pdf' } = req.query;

            if (format.toLowerCase() === 'pdf') {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 
                    `attachment; filename=audit_logs_${moment().format('YYYY-MM-DD')}.pdf`);
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Pragma', 'no-cache');
            }

            const result = await ReportService.generateAuditReport({
                start, end, type, plantId, format
            });

            if (format.toLowerCase() === 'pdf') {
                return res.send(result.buffer);
            }

            // JSON format as fallback
            res.json(result.data);
        } catch (error) {
            console.error("❌ Audit report generation error:", error);
            
            if (!res.headersSent) {
                res.status(500).json({ 
                    success: false, 
                    error: "Failed to export audit logs",
                    details: error.message
                });
            }
        }
    }

    /**
     * Get available report types
     */
    static async getReportTypes(req, res) {
        try {
            const reportTypes = [
                {
                    type: 'sensor',
                    name: 'Sensor Data Report',
                    description: 'Detailed sensor readings and statistics',
                    formats: ['pdf', 'json'],
                    requiredParams: ['plantId', 'start', 'end'],
                    endpoints: [
                        '/api/reports?plantId={plantId}&start={start}&end={end}&format={format}',
                        '/api/reports/{plantId}?start={start}&end={end}&format={format}'
                    ]
                },
                {
                    type: 'audit',
                    name: 'Audit Logs Report',
                    description: 'System activity and audit trail',
                    formats: ['pdf', 'json'],
                    requiredParams: [],
                    optionalParams: ['plantId', 'start', 'end', 'type'],
                    endpoints: [
                        '/api/audit-logs/export?start={start}&end={end}&format={format}'
                    ]
                }
            ];

            res.json({
                success: true,
                reportTypes,
                availableFormats: ['pdf', 'json'],
                timezone: 'Asia/Manila'
            });
        } catch (error) {
            console.error("❌ Error getting report types:", error.message);
            res.status(500).json({ 
                error: "Failed to get report types",
                success: false
            });
        }
    }

    /**
     * Get report generation status
     */
    static async getReportStatus(req, res) {
        try {
            // Check if report service is operational by testing database connection
            const status = await ReportService.checkServiceHealth();
            
            res.json({
                success: true,
                status: status.healthy ? 'ready' : 'degraded',
                message: status.message,
                timestamp: moment().tz('Asia/Manila').format(),
                services: {
                    database: status.database,
                    pdfGeneration: status.pdfGeneration,
                    auditLogging: status.auditLogging
                }
            });
        } catch (error) {
            console.error("❌ Error getting report status:", error.message);
            res.status(500).json({ 
                error: "Failed to get report status",
                success: false,
                status: 'error',
                timestamp: moment().tz('Asia/Manila').format()
            });
        }
    }

    /**
     * Get report statistics
     */
    static async getReportStatistics(req, res) {
        try {
            const { plantId, days = 30 } = req.query;
            const stats = await ReportService.getReportStatistics(plantId, parseInt(days));
            
            res.json({
                success: true,
                statistics: stats,
                period: `Last ${days} days`,
                timestamp: moment().tz('Asia/Manila').format()
            });
        } catch (error) {
            console.error("❌ Error getting report statistics:", error.message);
            res.status(500).json({ 
                error: "Failed to get report statistics",
                success: false
            });
        }
    }

    /**
     * Preview report data (without generating full report)
     */
    static async previewReportData(req, res) {
        try {
            const { plantId, start, end, type = 'sensor', limit = 10 } = req.query;
            
            if (type === 'sensor' && (!plantId || !start || !end)) {
                return res.status(400).json({
                    error: "Missing parameters for sensor report preview",
                    required: ['plantId', 'start', 'end']
                });
            }

            const preview = await ReportService.previewReportData(type, {
                plantId, start, end, limit: parseInt(limit)
            });
            
            res.json({
                success: true,
                preview,
                type,
                totalRecords: preview.totalRecords,
                sampleSize: preview.sampleData?.length || 0,
                timestamp: moment().tz('Asia/Manila').format()
            });
        } catch (error) {
            console.error("❌ Error getting report preview:", error.message);
            res.status(500).json({ 
                error: "Failed to get report preview",
                success: false
            });
        }
    }

    /**
     * Get report templates
     */
    static async getReportTemplates(req, res) {
        try {
            const templates = await ReportService.getAvailableTemplates();
            
            res.json({
                success: true,
                templates,
                timestamp: moment().tz('Asia/Manila').format()
            });
        } catch (error) {
            console.error("❌ Error getting report templates:", error.message);
            res.status(500).json({ 
                error: "Failed to get report templates",
                success: false
            });
        }
    }

    /**
     * Validate report parameters
     */
    static async validateReportParams(req, res) {
        try {
            const { type, plantId, start, end, format } = req.body;
            
            const validation = await ReportService.validateReportParameters({
                type, plantId, start, end, format
            });
            
            res.json({
                success: true,
                validation,
                timestamp: moment().tz('Asia/Manila').format()
            });
        } catch (error) {
            console.error("❌ Error validating report parameters:", error.message);
            res.status(500).json({ 
                error: "Failed to validate report parameters",
                success: false
            });
        }
    }

    /**
     * Schedule report generation (for future implementation)
     */
    static async scheduleReport(req, res) {
        try {
            const { plantId, reportType, schedule, format, recipients } = req.body;
            
            // This would integrate with a job scheduler like node-cron or bull queue
            const scheduledReport = await ReportService.scheduleReport({
                plantId, reportType, schedule, format, recipients
            });
            
            res.status(201).json({
                success: true,
                scheduledReport,
                message: "Report scheduled successfully",
                timestamp: moment().tz('Asia/Manila').format()
            });
        } catch (error) {
            console.error("❌ Error scheduling report:", error.message);
            res.status(500).json({ 
                error: "Failed to schedule report",
                success: false
            });
        }
    }

    /**
     * Get scheduled reports
     */
    static async getScheduledReports(req, res) {
        try {
            const { plantId } = req.query;
            const scheduledReports = await ReportService.getScheduledReports(plantId);
            
            res.json({
                success: true,
                scheduledReports,
                timestamp: moment().tz('Asia/Manila').format()
            });
        } catch (error) {
            console.error("❌ Error getting scheduled reports:", error.message);
            res.status(500).json({ 
                error: "Failed to get scheduled reports",
                success: false
            });
        }
    }

    /**
     * Cancel scheduled report
     */
    static async cancelScheduledReport(req, res) {
        try {
            const { scheduleId } = req.params;
            const result = await ReportService.cancelScheduledReport(scheduleId);
            
            res.json({
                success: true,
                result,
                message: "Scheduled report cancelled successfully",
                timestamp: moment().tz('Asia/Manila').format()
            });
        } catch (error) {
            console.error("❌ Error cancelling scheduled report:", error.message);
            res.status(500).json({ 
                error: "Failed to cancel scheduled report",
                success: false
            });
        }
    }
}

module.exports = ReportController;