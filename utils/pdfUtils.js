const moment = require('moment-timezone');
const AuditUtils = require('./auditUtils');

class PDFUtils {
    /**
     * Draw page header for sensor reports
     */
    static drawPageHeader(doc, pageNumber, title = 'Plant Monitoring Report') {
        const pageWidth = doc.page.width;
        
        // Title container with darker styling
        doc.rect(50, 30, pageWidth - 100, 80)
           .fillColor('#e0e0e0')
           .fill();
        
        // Border for header
        doc.rect(50, 30, pageWidth - 100, 80)
           .strokeColor('#000000')
           .lineWidth(2)
           .stroke();
        
        // Title section
        doc.font('Helvetica-Bold')
           .fontSize(22)
           .fillColor('#1a4e1a')
           .text('Plant Monitoring System', 70, 45, { align: 'left' })
           .fontSize(14)
           .fillColor('#333333')
           .text(title, 70, 70, { align: 'left' });
        
        // Page number
        doc.fontSize(10)
           .fillColor('#000000')
           .text(`Page ${pageNumber}`, pageWidth - 120, 45, { align: 'right', width: 60 });
           
        return 130;
    }

    /**
     * Draw enhanced header for audit reports
     */
    static drawEnhancedAuditHeader(doc, pageNumber) {
        const pageWidth = doc.page.width;
        const headerHeight = 120;
        
        // Modern header background
        doc.rect(0, 0, pageWidth, headerHeight)
           .fillColor('#2c5530')
           .fill();
        
        // Subtle pattern overlay
        doc.rect(0, 0, pageWidth, headerHeight)
           .fillColor('#34633a')
           .fillOpacity(0.3)
           .fill()
           .fillOpacity(1);
        
        // Logo area
        const logoX = 60;
        const logoY = 30;
        const logoRadius = 25;
        
        doc.circle(logoX, logoY, logoRadius)
           .fillColor('#ffffff')
           .fillOpacity(0.15)
           .fill()
           .fillOpacity(1);
        
        // Logo text
        doc.fontSize(16)
           .fillColor('#ffffff')
           .font('Helvetica-Bold')
           .text('PM', logoX - 8, logoY - 8);
        
        // Main title
        doc.fontSize(28)
           .fillColor('#ffffff')
           .font('Helvetica-Bold')
           .text('AUDIT LOGS REPORT', 120, 25);
        
        // Subtitle
        doc.fontSize(14)
           .fillColor('#e8f5e8')
           .font('Helvetica')
           .text('Plant Monitoring System • Activity Tracking', 120, 60);
        
        // Page indicator
        const pageIndicatorX = pageWidth - 120;
        doc.rect(pageIndicatorX, 25, 80, 25)
           .fillColor('#ffffff')
           .fillOpacity(0.1)
           .fill()
           .fillOpacity(1)
           .strokeColor('#ffffff')
           .strokeOpacity(0.3)
           .lineWidth(1)
           .stroke();
        
        doc.fontSize(12)
           .fillColor('#ffffff')
           .font('Helvetica-Bold')
           .text(`Page ${pageNumber}`, pageIndicatorX, 32, { 
             width: 80, 
             align: 'center' 
           });
        
        // Bottom border
        doc.moveTo(0, headerHeight)
           .lineTo(pageWidth, headerHeight)
           .strokeColor('#1a4d1f')
           .lineWidth(3)
           .stroke();
        
        return headerHeight + 30;
    }

    /**
     * Draw table header for sensor data
     */
    static drawTableHeader(doc, headers, x, y, width) {
        const cellWidths = [
            width * 0.20, // Date & Time
            width * 0.12, // Temperature
            width * 0.12, // Humidity
            width * 0.12, // Moisture
            width * 0.15, // Status
            width * 0.145, // Watering
            width * 0.145  // Fertilizer
        ];
        
        // Header background
        doc.fillColor('#1a4e1a')
           .rect(x, y, width, 25)
           .fill();

        // Header border
        doc.strokeColor('#000000')
           .lineWidth(1)
           .rect(x, y, width, 25)
           .stroke();

        // Header text
        let currentX = x;
        headers.forEach((header, i) => {
            doc.fillColor('#ffffff')
               .font('Helvetica-Bold')
               .fontSize(10)
               .text(header, 
                     currentX + 3,
                     y + 7,
                     { 
                       width: cellWidths[i] - 6,
                       align: 'center',
                       lineBreak: false
                     });
            currentX += cellWidths[i];
        });
        
        return y + 30;
    }

    /**
     * Draw table row for sensor data
     */
    static drawTableRow(doc, data, x, y, width) {
        const cellWidths = [
            width * 0.20, width * 0.12, width * 0.12, width * 0.12,
            width * 0.15, width * 0.145, width * 0.145
        ];
        
        const rowHeight = 22;
        
        if (y > doc.page.height - 75) {
            return null;
        }
        
        // Row background
        doc.fillColor('#f0f0f0')
           .rect(x, y, width, rowHeight)
           .fill();

        // Row border
        doc.strokeColor('#000000')
           .lineWidth(0.8)
           .rect(x, y, width, rowHeight)
           .stroke();

        // Cell contents
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
                   width: cellWidths[i] - 6,
                   align: 'center',
                   lineBreak: false
                 }
               );
            
            currentX += cellWidths[i];
        });
        
        return y + rowHeight + 2;
    }

    /**
     * Draw page footer
     */
    static drawPageFooter(doc, timestamp) {
        const pageWidth = doc.page.width;
        const footerY = doc.page.height - 50;
        
        // Footer line
        doc.moveTo(50, footerY)
           .lineTo(pageWidth - 50, footerY)
           .strokeColor('#000000')
           .strokeOpacity(1)
           .lineWidth(1.5)
           .stroke();
        
        doc.fontSize(9)
           .fillColor('#000000');

        // Footer content
        doc.text(`Generated on ${timestamp}`, 50, footerY + 10, { width: 200, align: 'left' });
        doc.text('Plant Monitoring System', pageWidth / 2 - 100, footerY + 10, { width: 200, align: 'center' });
        doc.text('Confidential Report', pageWidth - 250, footerY + 10, { width: 200, align: 'right' });
    }

    /**
     * Draw summary card for audit reports
     */
    static drawSummaryCard(doc, x, y, width, height, title, value, color, icon) {
        // Card shadow
        doc.rect(x + 2, y + 2, width, height)
           .fillColor('#000000')
           .fillOpacity(0.1)
           .fill()
           .fillOpacity(1);
        
        // Card background
        doc.rect(x, y, width, height)
           .fillColor('#ffffff')
           .fill()
           .strokeColor('#e0e0e0')
           .lineWidth(1)
           .stroke();
        
        // Colored top border
        doc.rect(x, y, width, 4)
           .fillColor(color)
           .fill();
        
        // Icon background
        const iconSize = 30;
        const iconX = x + 15;
        const iconY = y + 15;
        
        doc.circle(iconX + iconSize/2, iconY + iconSize/2, iconSize/2)
           .fillColor(color)
           .fillOpacity(0.1)
           .fill()
           .fillOpacity(1);
        
        // Icon
        doc.fontSize(9)
           .fillColor(color)
           .font('Helvetica-Bold')
           .text(icon, iconX + 5, iconY + 12);
        
        // Title
        doc.fontSize(10)
           .fillColor('#666666')
           .font('Helvetica')
           .text(title.toUpperCase(), iconX + iconSize + 10, iconY + 5);
        
        // Value
        doc.fontSize(16)
           .fillColor('#333333')
           .font('Helvetica-Bold')
           .text(value, iconX + iconSize + 10, iconY + 20, {
               width: width - iconSize - 40,
               lineBreak: false
           });
    }

    /**
     * Draw status badge for audit reports
     */
    static drawStatusBadge(doc, x, y, status, color) {
        const badgeWidth = 60;
        const badgeHeight = 18;
        
        // Badge background
        doc.rect(x, y, badgeWidth, badgeHeight)
           .fillColor(color)
           .fillOpacity(0.1)
           .fill()
           .strokeColor(color)
           .strokeOpacity(0.3)
           .lineWidth(1)
           .stroke()
           .fillOpacity(1)
           .strokeOpacity(1);
        
        // Badge text
        doc.fillColor(color)
           .font('Helvetica-Bold')
           .fontSize(9)
           .text(status.toUpperCase(), x, y + 5, {
               width: badgeWidth,
               align: 'center'
           });
    }

    /**
     * Draw enhanced footer for audit reports
     */
    static drawEnhancedFooter(doc) {
        const pageWidth = doc.page.width;
        const footerY = doc.page.height - 60;
        const timestamp = moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss');
        
        // Footer background
        doc.rect(0, footerY - 10, pageWidth, 70)
           .fillColor('#f8f9fa')
           .fill();
        
        // Top border
        doc.moveTo(0, footerY - 10)
           .lineTo(pageWidth, footerY - 10)
           .strokeColor('#2c5530')
           .lineWidth(2)
           .stroke();
        
        // Footer content
        doc.fontSize(9)
           .fillColor('#666666')
           .font('Helvetica');
        
        // Footer text
        doc.text(`Generated on ${timestamp}`, 40, footerY + 5);
        doc.text('Plant Monitoring System', pageWidth / 2 - 60, footerY + 5);
        doc.text('Confidential Report', pageWidth - 140, footerY + 5);
        
        // Bottom line
        doc.fontSize(8)
           .fillColor('#999999')
           .text('For questions about this report, contact your system administrator', 
                 40, footerY + 25, { width: pageWidth - 80, align: 'center' });
    }

    /**
     * Estimate text height for dynamic row sizing
     */
    static estimateTextHeight(text, maxWidth, doc, fontSize = 8) {
        const lineHeight = fontSize * 1.4;
        
        if (!text || text === '-') return lineHeight;
        
        const lines = text.split('\n');
        let totalLines = 0;
        
        lines.forEach(line => {
            const words = line.split(' ');
            let currentLine = '';
            let lineCount = 1;
            
            words.forEach(word => {
                const testLine = currentLine + word + ' ';
                const width = doc.widthOfString(testLine, { fontSize });
                
                if (width > maxWidth) {
                    currentLine = word + ' ';
                    lineCount++;
                } else {
                    currentLine = testLine;
                }
            });
            
            totalLines += lineCount;
        });
        
        return totalLines * lineHeight;
    }

    /**
     * Format sensor data for PDF display
     */
    static formatSensorDataForPDF(sensorData) {
        if (!sensorData) return '-';
        
        const lines = [];
        if (sensorData.moisture !== undefined) lines.push(`Moisture: ${sensorData.moisture}%`);
        if (sensorData.temperature !== undefined) lines.push(`Temp: ${sensorData.temperature}°C`);
        if (sensorData.humidity !== undefined) lines.push(`Humidity: ${sensorData.humidity}%`);
        if (sensorData.moistureStatus) lines.push(`Status: ${sensorData.moistureStatus}`);
        if (sensorData.waterState !== undefined) lines.push(`Water: ${sensorData.waterState ? 'ON' : 'OFF'}`);
        if (sensorData.fertilizerState !== undefined) lines.push(`Fertilizer: ${sensorData.fertilizerState ? 'ON' : 'OFF'}`);
        
        return lines.join('\n');
    }
}

module.exports = PDFUtils;