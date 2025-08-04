const PDFDocument = require('pdfkit');
const moment = require('moment-timezone');
const SensorService = require('./sensorService');
const AuditService = require('./auditService');
const SensorUtils = require('../utils/sensorUtils');
const PDFUtils = require('../utils/pdfUtils');
const AuditUtils = require('../utils/auditUtils');
const DatabaseConfig = require('../config/database');

// Add PDF rendering helper functions
function drawEnhancedTableHeader(doc, headers, colWidths, x, y, width) {
    const headerHeight = 35;
    doc.rect(x, y, width, headerHeight)
       .fillColor('#2c5530')
       .fill();
    
    doc.rect(x, y, width, 3)
       .fillColor('#4CAF50')
       .fill();
    
    let currentX = x;
    headers.forEach((header, i) => {
        if (i > 0) {
            doc.moveTo(currentX, y)
               .lineTo(currentX, y + headerHeight)
               .strokeColor('#ffffff')
               .strokeOpacity(0.2)
               .lineWidth(1)
               .stroke()
               .strokeOpacity(1);
        }
        
        doc.fillColor('#ffffff')
           .font('Helvetica-Bold')
           .fontSize(11)
           .text(header.toUpperCase(), 
                 currentX + 8, 
                 y + 12, 
                 { 
                   width: colWidths[i] - 16, 
                   align: 'left',
                   lineBreak: false
                 });
        
        currentX += colWidths[i];
    });
    
    return y + headerHeight;
}

function drawEnhancedTableRow(doc, data, colWidths, x, y, width, index) {
    const rowHeight = 22;
    
    if (y > doc.page.height - 75) {
        return null;
    }
    
    doc.fillColor('#f0f0f0')
       .rect(x, y, width, rowHeight)
       .fill();

    doc.strokeColor('#000000')
       .lineWidth(0.8)
       .rect(x, y, width, rowHeight)
       .stroke();

    let currentX = x;
    data.forEach((cell, i) => {
        if (i > 0) {
            doc.moveTo(currentX, y)
               .lineTo(currentX, y + rowHeight)
               .stroke();
        }
        
        doc.fillColor('#000000')
           .font('Helvetica')
           .fontSize(9)
           .text(
             cell.toString(),
             currentX + 3,
             y + 6,
             {
               width: colWidths[i] - 6,
               align: 'center',
               lineBreak: false
             }
           );
        
        currentX += colWidths[i];
    });
    
    return y + rowHeight + 2;
}

class ReportService {
    /**
     * Generate sensor data report
     */
    static async generateSensorReport(plantId, startDate, endDate, format = 'pdf') {
        try {
            // Remove database connection check since DatabaseConfig handles it automatically
            console.log('Debug - Report Request:', { plantId, startDate, endDate, format });

            // Fetch sensor readings
            const readings = await SensorService.getReadingsInRange(plantId, startDate, endDate);
            console.log(`Debug - Total readings found: ${readings?.length || 0}`);

            // Log report generation attempt
            await AuditService.logReportGeneration(plantId, format, startDate, endDate, 'success');

            if (format === 'json') {
                const stats = SensorUtils.calculateStats(readings);
                return {
                    success: true,
                    data: {
                        totalReadings: readings.length,
                        stats,
                        allReadings: readings
                    }
                };
            }

            if (format === 'pdf') {
                return await this.generateSensorPDF(plantId, startDate, endDate, readings);
            }

            throw new Error(`Unsupported format: ${format}`);
        } catch (error) {
            console.error("❌ Report generation error:", error);
            
            // Log failed report generation
            await AuditService.logReportGeneration(plantId, format, startDate, endDate, 'failed', error.message);
            
            throw new Error(`Failed to generate report: ${error.message}`);
        }
    }

    /**
     * Generate PDF report for sensor data
     */
    static async generateSensorPDF(plantId, startDate, endDate, readings) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 50 });
                const chunks = [];

                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => {
                    const pdfBuffer = Buffer.concat(chunks);
                    resolve({
                        success: true,
                        buffer: pdfBuffer,
                        filename: `plant-report-${plantId}-${moment().format('YYYY-MM-DD')}.pdf`
                    });
                });

                // Draw report content
                let currentY = PDFUtils.drawPageHeader(doc, 1, 'Plant Monitoring Report');
                currentY += 30;

                // Report details section
                currentY = this.drawReportDetails(doc, currentY, plantId, startDate, endDate, readings.length);
                currentY += 20;

                // Draw readings table with fixed column widths
                const tableWidth = doc.page.width - 100;
                const tableX = 50;
                const headers = ['Date & Time', 'Temperature', 'Humidity', 'Moisture', 'Status', 'Watering', 'Fertilizer'];
                const colWidths = [
                    tableWidth * 0.20,
                    tableWidth * 0.12,
                    tableWidth * 0.12,
                    tableWidth * 0.12,
                    tableWidth * 0.15,
                    tableWidth * 0.145,
                    tableWidth * 0.145
                ];

                if (readings.length === 0) {
                    this.drawNoDataMessage(doc, currentY);
                } else {
                    currentY = drawEnhancedTableHeader(doc, headers, colWidths, tableX, currentY, tableWidth);
                    
                    readings.forEach((reading, index) => {
                        if (currentY > doc.page.height - 100) {
                            doc.addPage();
                            currentY = PDFUtils.drawPageHeader(doc, Math.floor(index / 15) + 2);
                            currentY = drawEnhancedTableHeader(doc, headers, colWidths, tableX, currentY, tableWidth);
                        }
                        
                        const rowData = [
                            moment(reading.timestamp).format('MM-DD HH:mm'),
                            `${reading.temperature || 'N/A'}°C`,
                            `${reading.humidity || 'N/A'}%`,
                            `${reading.moisture || 'N/A'}%`,
                            reading.moistureStatus || 'N/A',
                            reading.waterState ? 'ON' : 'OFF',
                            reading.fertilizerState ? 'ON' : 'OFF'
                        ];
                        
                        currentY = drawEnhancedTableRow(doc, rowData, colWidths, tableX, currentY, tableWidth, index);
                    });
                }

                PDFUtils.drawPageFooter(doc, moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss'));
                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Draw report details section
     */
    static drawReportDetails(doc, currentY, plantId, startDate, endDate, recordCount) {
        const reportDetailsWidth = 400;
        const startX = (doc.page.width - reportDetailsWidth) / 2;
        
        // Details table background
        doc.rect(startX, currentY, reportDetailsWidth, 80)
           .fillColor('#e8e8e8')
           .fill();
        
        // Add border
        doc.rect(startX, currentY, reportDetailsWidth, 80)
           .strokeColor('#000000')
           .lineWidth(1)
           .stroke();
        
        doc.font('Helvetica')
           .fontSize(11)
           .fillColor('#000000');
        
        // Details rows
        const detailsData = [
            ['Plant ID:', plantId, 'Generated:', moment().tz('Asia/Manila').format('YYYY-MM-DD LT')],
            ['Period:', `${moment(startDate).format('YYYY-MM-DD')} to ${moment(endDate).format('YYYY-MM-DD')}`, 'Total Records:', recordCount.toString()]
        ];
        
        detailsData.forEach((row, i) => {
            const rowY = currentY + (i * 30) + 15;
            doc.font('Helvetica-Bold').text(row[0], startX + 20, rowY);
            doc.font('Helvetica').text(row[1], startX + 100, rowY);
            doc.font('Helvetica-Bold').text(row[2], startX + 220, rowY);
            doc.font('Helvetica').text(row[3], startX + 300, rowY);
        });
        
        return currentY + 100;
    }

    /**
     * Draw sensor data table
     */
    static drawSensorDataTable(doc, startY, readings) {
        let currentY = startY;
        const tableWidth = doc.page.width - 100;
        const tableX = 50;
        
        const headers = ['Date & Time', 'Temperature', 'Humidity', 'Moisture', 'Status', 'Watering', 'Fertilizer'];
        currentY = PDFUtils.drawTableHeader(doc, headers, tableX, currentY, tableWidth);
        
        readings.forEach((reading, index) => {
            if (currentY > doc.page.height - 100) {
                doc.addPage();
                currentY = PDFUtils.drawPageHeader(doc, Math.floor(index / 15) + 2);
                currentY = PDFUtils.drawTableHeader(doc, headers, tableX, currentY, tableWidth);
            }
            
            const rowData = [
                moment(reading.timestamp).format('MM-DD HH:mm'),
                `${reading.temperature || 'N/A'}°C`,
                `${reading.humidity || 'N/A'}%`,
                `${reading.moisture || 'N/A'}%`,
                reading.moistureStatus || 'N/A',
                reading.waterState ? 'ON' : 'OFF',
                reading.fertilizerState ? 'ON' : 'OFF'
            ];
            
            currentY = PDFUtils.drawTableRow(doc, rowData, tableX, currentY, tableWidth);
        });
    }

    /**
     * Draw no data message
     */
    static drawNoDataMessage(doc, currentY) {
        const messageWidth = doc.page.width - 100;
        const messageX = 50;
        
        doc.rect(messageX, currentY, messageWidth, 60)
           .fillColor('#f8f9fa')
           .fill()
           .strokeColor('#dee2e6')
           .lineWidth(1)
           .stroke();
        
        doc.fontSize(14)
           .fillColor('#6c757d')
           .font('Helvetica')
           .text('No sensor data found for the selected date range.', 
                 messageX, currentY + 20, { 
                   width: messageWidth, 
                   align: 'center' 
                 });
    }

    /**
     * Generate audit logs report
     */
    static async generateAuditReport(filters = {}) {
        try {
            const { start, end, type, plantId, format = 'pdf' } = filters;

            // Fetch audit logs
            const result = await AuditService.exportAuditLogs({ start, end, type, plantId });
            const logs = result.logs;

            if (format === 'json') {
                return {
                    success: true,
                    data: {
                        logs: logs
                    }
                };
            }

            if (format === 'pdf') {
                return await this.generateAuditPDF(logs, filters);
            }

            throw new Error(`Unsupported format: ${format}`);
        } catch (error) {
            console.error("❌ Audit report generation error:", error);
            throw error;
        }
    }

    /**
     * Generate PDF report for audit logs
     */
    static async generateAuditPDF(logs, filters) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({ 
                    margin: 40,
                    size: 'A4'
                });
                const chunks = [];

                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => {
                    const pdfBuffer = Buffer.concat(chunks);
                    resolve({
                        success: true,
                        buffer: pdfBuffer,
                        filename: `audit_logs_${moment().format('YYYY-MM-DD')}.pdf`
                    });
                });

                let currentY = PDFUtils.drawEnhancedAuditHeader(doc, 1);
                currentY = this.drawAuditSummarySection(doc, currentY, logs, filters);
                currentY = this.drawAuditLogsTable(doc, currentY, logs);
                
                PDFUtils.drawEnhancedFooter(doc);
                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Draw audit summary section
     */
    static drawAuditSummarySection(doc, startY, logs, filters) {
        const { plantId, start, end, type } = filters;
        const sectionWidth = doc.page.width - 80;
        const sectionX = 40;
        let currentY = startY;
        
        // Section title
        doc.fontSize(18)
           .fillColor('#2c5530')
           .font('Helvetica-Bold')
           .text('Report Summary', sectionX, currentY);
        
        currentY += 35;
        
        // Summary cards
        const cardHeight = 80;
        const cardWidth = (sectionWidth - 30) / 3;
        
        // Card 1: Total Logs
        PDFUtils.drawSummaryCard(doc, sectionX, currentY, cardWidth, cardHeight, 
            'Total Logs', logs.length.toString(), '#4CAF50', 'LOGS');
        
        // Card 2: Date Range
        const dateRange = start && end ? 
            `${moment(start).format('MMM DD')} - ${moment(end).format('MMM DD, YYYY')}` : 
            'All Time';
        PDFUtils.drawSummaryCard(doc, sectionX + cardWidth + 15, currentY, cardWidth, cardHeight,
            'Date Range', dateRange, '#2196F3', 'DATE');
        
        // Card 3: Filter Info
        const filterInfo = plantId ? `Plant ${plantId}` : (type ? type.toUpperCase() : 'All Types');
        PDFUtils.drawSummaryCard(doc, sectionX + (cardWidth + 15) * 2, currentY, cardWidth, cardHeight,
            'Filter', filterInfo, '#FF9800', 'FILTER');
        
        currentY += cardHeight + 30;
        
        // Activity breakdown
        if (logs.length > 0) {
            currentY = this.drawActivityBreakdown(doc, sectionX, currentY, sectionWidth, logs);
        }
        
        return currentY + 20;
    }

    /**
     * Draw activity breakdown
     */
    static drawActivityBreakdown(doc, x, y, width, logs) {
        // Count activities by type and status
        const breakdown = logs.reduce((acc, log) => {
            const key = `${log.type}-${log.status}`;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        
        // Title
        doc.fontSize(14)
           .fillColor('#2c5530')
           .font('Helvetica-Bold')
           .text('Activity Breakdown', x, y);
        
        y += 25;
        
        // Breakdown bars
        const maxCount = Math.max(...Object.values(breakdown));
        const barHeight = 20;
        const barSpacing = 25;
        
        Object.entries(breakdown).forEach(([key, count], index) => {
            const [type, status] = key.split('-');
            const barWidth = (count / maxCount) * (width * 0.6);
            const barY = y + (index * barSpacing);
            
            const statusColor = AuditUtils.getStatusColor(status);
            
            // Bar background
            doc.rect(x, barY, width * 0.6, barHeight)
               .fillColor('#f5f5f5')
               .fill();
            
            // Bar fill
            doc.rect(x, barY, barWidth, barHeight)
               .fillColor(statusColor)
               .fillOpacity(0.8)
               .fill()
               .fillOpacity(1);
            
            // Label and count
            doc.fontSize(10)
               .fillColor('#333333')
               .font('Helvetica')
               .text(`${type.toUpperCase()} (${status})`, x + width * 0.65, barY + 6);
            
            doc.fontSize(10)
               .fillColor('#666666')
               .font('Helvetica-Bold')
               .text(count.toString(), x + width * 0.85, barY + 6);
        });
        
        return y + (Object.keys(breakdown).length * barSpacing) + 20;
    }

    /**
     * Draw audit logs table
     */
    static drawAuditLogsTable(doc, startY, logs) {
        let currentY = startY;
        const pageWidth = doc.page.width;
        const tableX = 40;
        const tableWidth = pageWidth - 80;
        
        // Table title
        doc.fontSize(18)
           .fillColor('#2c5530')
           .font('Helvetica-Bold')
           .text('Detailed Activity Log', tableX, currentY);
        
        currentY += 35;
        
        // No logs message
        if (logs.length === 0) {
            doc.rect(tableX, currentY, tableWidth, 60)
               .fillColor('#f8f9fa')
               .fill()
               .strokeColor('#dee2e6')
               .lineWidth(1)
               .stroke();
            
            doc.fontSize(14)
               .fillColor('#6c757d')
               .font('Helvetica')
               .text('No audit logs found for the selected criteria.', 
                     tableX, currentY + 20, { 
                       width: tableWidth, 
                       align: 'center' 
                     });
            
            return currentY + 60;
        }
        
        // Table headers
        const headers = ['Timestamp', 'Type', 'Action', 'Status', 'Details', 'Data'];
        const colWidths = [
            tableWidth * 0.18, tableWidth * 0.12, tableWidth * 0.12,
            tableWidth * 0.10, tableWidth * 0.28, tableWidth * 0.20
        ];
        
        currentY = this.drawEnhancedTableHeader(doc, headers, colWidths, tableX, currentY, tableWidth);
        
        // Table rows
        logs.forEach((log, index) => {
            if (currentY > doc.page.height - 100) {
                doc.addPage();
                currentY = 60;
                currentY = this.drawEnhancedTableHeader(doc, headers, colWidths, tableX, currentY, tableWidth);
            }
            
            currentY = this.drawEnhancedTableRow(doc, log, colWidths, tableX, currentY, tableWidth, index);
        });
        
        return currentY;
    }

    /**
     * Draw enhanced table header
     */
    static drawEnhancedTableHeader(doc, headers, colWidths, x, y, width) {
        const headerHeight = 35;
        
        // Header background
        doc.rect(x, y, width, headerHeight)
           .fillColor('#2c5530')
           .fill();
        
        // Header highlight
        doc.rect(x, y, width, 3)
           .fillColor('#4CAF50')
           .fill();
        
        // Header text
        let currentX = x;
        headers.forEach((header, i) => {
            if (i > 0) {
                doc.moveTo(currentX, y)
                   .lineTo(currentX, y + headerHeight)
                   .strokeColor('#ffffff')
                   .strokeOpacity(0.2)
                   .lineWidth(1)
                   .stroke()
                   .strokeOpacity(1);
            }
            
            doc.fillColor('#ffffff')
               .font('Helvetica-Bold')
               .fontSize(11)
               .text(header.toUpperCase(), 
                     currentX + 8, 
                     y + 12, 
                     { 
                       width: colWidths[i] - 16, 
                       align: 'left',
                       lineBreak: false
                     });
            
            currentX += colWidths[i];
        });
        
        return y + headerHeight;
    }

    /**
     * Draw enhanced table row
     */
    static drawEnhancedTableRow(doc, log, colWidths, x, y, width, index) {
        const baseRowHeight = 45;
        const detailsText = log.details || '-';
        const sensorDataText = log.sensorData ? AuditUtils.formatSensorDataForAudit(log.sensorData) : '-';
        
        // Calculate row height
        const detailsHeight = PDFUtils.estimateTextHeight(detailsText, colWidths[4] - 16, doc);
        const dataHeight = PDFUtils.estimateTextHeight(sensorDataText, colWidths[5] - 16, doc);
        const rowHeight = Math.max(baseRowHeight, detailsHeight + 20, dataHeight + 20);
        
        // Row background
        const bgColor = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
        doc.rect(x, y, width, rowHeight)
           .fillColor(bgColor)
           .fill();
        
        // Row border
        doc.rect(x, y, width, rowHeight)
           .strokeColor('#e9ecef')
           .lineWidth(0.5)
           .stroke();
        
        // Status indicator
        const statusColor = AuditUtils.getStatusColor(log.status);
        doc.rect(x, y, 4, rowHeight)
           .fillColor(statusColor)
           .fill();
        
        // Cell data
        const cellData = [
            moment(log.timestamp).format('MMM DD\nHH:mm'),
            (log.type || '-').toUpperCase(),
            (log.action || '-').toUpperCase(),
            log.status || '-',
            detailsText,
            sensorDataText
        ];
        
        // Draw cells
        let currentX = x;
        cellData.forEach((text, i) => {
            if (i > 0) {
                doc.moveTo(currentX, y)
                   .lineTo(currentX, y + rowHeight)
                   .strokeColor('#e9ecef')
                   .lineWidth(0.5)
                   .stroke();
            }
            
            if (i === 3 && text !== '-') {
                PDFUtils.drawStatusBadge(doc, currentX + 8, y + 12, text, statusColor);
            } else {
                const fontSize = i === 0 ? 9 : (i === 4 || i === 5 ? 8 : 10);
                const fontWeight = (i === 1 || i === 2) ? 'Helvetica-Bold' : 'Helvetica';
                
                doc.fillColor('#333333')
                   .font(fontWeight)
                   .fontSize(fontSize)
                   .text(text, 
                         currentX + 8, 
                         y + 10, 
                         { 
                           width: colWidths[i] - 16, 
                           align: 'left',
                           lineBreak: true,
                           height: rowHeight - 20
                         });
            }
            
            currentX += colWidths[i];
        });
        
        return y + rowHeight;
    }
}

module.exports = ReportService;