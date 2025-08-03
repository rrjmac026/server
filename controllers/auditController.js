const AuditService = require('../services/auditService');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

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
     * Export audit logs as PDF
     */
    static async exportAuditLogs(req, res) {
        try {
            const result = await AuditService.exportAuditLogs(req.query);
            
            // Create PDF document
            const doc = new PDFDocument({
                margin: 50,
                size: 'A4'
            });

            // Set response headers for PDF download
            const fileName = `audit-logs-${new Date().toISOString().split('T')[0]}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

            // Pipe PDF to response
            doc.pipe(res);

            // Add PDF content
            doc.fontSize(20).text('Audit Logs Report', { align: 'center' });
            doc.moveDown();

            // Add export info
            doc.fontSize(12)
               .text(`Export Date: ${new Date().toLocaleString()}`, { align: 'right' })
               .text(`Total Records: ${result.logs.length}`, { align: 'right' });
            
            doc.moveDown(2);

            // Add table headers
            const startY = doc.y;
            const colWidths = [80, 100, 80, 80, 150, 80];
            const headers = ['Date', 'User', 'Action', 'Type', 'Description', 'Plant ID'];
            
            let currentX = 50;
            headers.forEach((header, index) => {
                doc.fontSize(10)
                   .font('Helvetica-Bold')
                   .text(header, currentX, startY, { 
                       width: colWidths[index], 
                       align: 'left' 
                   });
                currentX += colWidths[index];
            });

            // Add horizontal line under headers
            doc.moveTo(50, startY + 15)
               .lineTo(550, startY + 15)
               .stroke();

            // Add data rows
            let rowY = startY + 25;
            const rowHeight = 20;
            
            result.logs.forEach((log, rowIndex) => {
                // Check if we need a new page
                if (rowY > 750) {
                    doc.addPage();
                    rowY = 50;
                }

                currentX = 50;
                const rowData = [
                    new Date(log.createdAt).toLocaleDateString(),
                    log.userId || 'System',
                    log.action || '',
                    log.type || '',
                    (log.description || '').substring(0, 50) + (log.description && log.description.length > 50 ? '...' : ''),
                    log.plantId || ''
                ];

                rowData.forEach((data, colIndex) => {
                    doc.fontSize(9)
                       .font('Helvetica')
                       .text(data.toString(), currentX, rowY, { 
                           width: colWidths[colIndex], 
                           align: 'left',
                           height: rowHeight
                       });
                    currentX += colWidths[colIndex];
                });

                // Add light horizontal line between rows
                if (rowIndex % 2 === 0) {
                    doc.rect(50, rowY - 2, 500, rowHeight)
                       .fill('#f9f9f9')
                       .stroke('#f0f0f0');
                }

                rowY += rowHeight;
            });

            // Add footer
            doc.fontSize(8)
               .text(`Generated on ${new Date().toLocaleString()}`, 50, doc.page.height - 50, {
                   align: 'center'
               });

            // Finalize PDF
            doc.end();

        } catch (error) {
            console.error("❌ Error exporting audit logs:", error.message);
            
            // If headers haven't been sent yet, send JSON error
            if (!res.headersSent) {
                res.status(500).json({ 
                    success: false, 
                    error: "Failed to export audit logs as PDF"
                });
            }
        }
    }

    /**
     * Alternative: Export audit logs as CSV
     */
    static async exportAuditLogsCSV(req, res) {
        try {
            const result = await AuditService.exportAuditLogs(req.query);
            
            // Create CSV content
            const headers = ['Date', 'User ID', 'Action', 'Type', 'Description', 'Plant ID', 'IP Address'];
            let csvContent = headers.join(',') + '\n';
            
            result.logs.forEach(log => {
                const row = [
                    new Date(log.createdAt).toISOString(),
                    log.userId || '',
                    log.action || '',
                    log.type || '',
                    `"${(log.description || '').replace(/"/g, '""')}"`, // Escape quotes
                    log.plantId || '',
                    log.ipAddress || ''
                ];
                csvContent += row.join(',') + '\n';
            });

            // Set response headers for CSV download
            const fileName = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            
            res.send(csvContent);

        } catch (error) {
            console.error("❌ Error exporting audit logs as CSV:", error.message);
            res.status(500).json({ 
                success: false, 
                error: "Failed to export audit logs as CSV"
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