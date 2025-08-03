const moment = require('moment-timezone');

class AuditUtils {
    /**
     * Validate audit log data
     */
    static validateAuditLog(data) {
        const requiredFields = ['plantId', 'type', 'action'];
        for (const field of requiredFields) {
            if (!data[field]) {
                return `Missing required field: ${field}`;
            }
        }
        return null;
    }

    /**
     * Sanitize audit log data
     */
    static sanitizeAuditLog(log) {
        return {
            ...log,
            type: String(log.type || '').toLowerCase(),
            action: String(log.action || '').toLowerCase(),
            status: String(log.status || 'success').toLowerCase(),
            timestamp: log.timestamp || new Date(),
            details: log.details || null,
            sensorData: log.sensorData || null
        };
    }

    /**
     * Get status color for PDF styling
     */
    static getStatusColor(status) {
        const colors = {
            'success': '#4CAF50',
            'failed': '#f44336',
            'warning': '#FF9800',
            'info': '#2196F3'
        };
        return colors[status] || '#9E9E9E';
    }

    /**
     * Draw enhanced audit header for PDF
     */
    static drawEnhancedAuditHeader(doc, pageNumber) {
        const pageWidth = doc.page.width;
        const headerHeight = 120;
        
        // Modern gradient-like header background
        doc.rect(0, 0, pageWidth, headerHeight)
           .fillColor('#2c5530')
           .fill();
        
        // Add subtle pattern overlay
        doc.rect(0, 0, pageWidth, headerHeight)
           .fillColor('#34633a')
           .fillOpacity(0.3)
           .fill();
        
        // Reset opacity
        doc.fillOpacity(1);
        
        // Company logo area (circular background)
        const logoX = 60;
        const logoY = 30;
        const logoRadius = 25;
        
        doc.circle(logoX, logoY, logoRadius)
           .fillColor('#ffffff')
           .fillOpacity(0.15)
           .fill()
           .fillOpacity(1);
        
        // Logo text/icon - Using text instead of emoji
        doc.fontSize(16)
           .fillColor('#ffffff')
           .font('Helvetica-Bold')
           .text('PM', logoX - 8, logoY - 8);
        
        // Main title
        doc.fontSize(28)
           .fillColor('#ffffff')
           .font('Helvetica-Bold')
           .text('AUDIT LOGS REPORT', 120, 25);
        
        // Subtitle with modern styling
        doc.fontSize(14)
           .fillColor('#e8f5e8')
           .font('Helvetica')
           .text('Plant Monitoring System • Activity Tracking', 120, 60);
        
        // Page indicator with modern design
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
        
        // Bottom border line with gradient effect
        doc.moveTo(0, headerHeight)
           .lineTo(pageWidth, headerHeight)
           .strokeColor('#1a4d1f')
           .lineWidth(3)
           .stroke();
        
        return headerHeight + 30;
    }

    /**
     * Draw audit summary section for PDF
     */
    static drawAuditSummarySection(doc, startY, logs, plantId, start, end, type) {
        const sectionWidth = doc.page.width - 80;
        const sectionX = 40;
        let currentY = startY;
        
        // Section title
        doc.fontSize(18)
           .fillColor('#2c5530')
           .font('Helvetica-Bold')
           .text('Report Summary', sectionX, currentY);
        
        currentY += 35;
        
        // Summary cards container
        const cardHeight = 80;
        const cardWidth = (sectionWidth - 30) / 3;
        
        // Card 1: Total Logs
        this.drawSummaryCard(doc, sectionX, currentY, cardWidth, cardHeight, 
          'Total Logs', logs.length.toString(), '#4CAF50', 'LOGS');
        
        // Card 2: Date Range
        const dateRange = start && end ? 
          `${moment(start).format('MMM DD')} - ${moment(end).format('MMM DD, YYYY')}` : 
          'All Time';
        this.drawSummaryCard(doc, sectionX + cardWidth + 15, currentY, cardWidth, cardHeight,
          'Date Range', dateRange, '#2196F3', 'DATE');
        
        // Card 3: Plant/Type Info
        const filterInfo = plantId ? `Plant ${plantId}` : (type ? type.toUpperCase() : 'All Types');
        this.drawSummaryCard(doc, sectionX + (cardWidth + 15) * 2, currentY, cardWidth, cardHeight,
          'Filter', filterInfo, '#FF9800', 'FILTER');
        
        currentY += cardHeight + 30;
        
        // Activity breakdown if we have logs
        if (logs.length > 0) {
          currentY = this.drawActivityBreakdown(doc, sectionX, currentY, sectionWidth, logs);
        }
        
        return currentY + 20;
    }

    /**
     * Draw summary card for PDF
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
     * Draw activity breakdown section
     */
    static drawActivityBreakdown(doc, x, y, width, logs) {
        // Count activities by type and status
        const breakdown = logs.reduce((acc, log) => {
          const key = `${log.type}-${log.status}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});
        
        // Activity breakdown title
        doc.fontSize(14)
           .fillColor('#2c5530')
           .font('Helvetica-Bold')
           .text('Activity Breakdown', x, y);
        
        y += 25;
        
        // Create breakdown bars
        const maxCount = Math.max(...Object.values(breakdown));
        const barHeight = 20;
        const barSpacing = 25;
        
        Object.entries(breakdown).forEach(([key, count], index) => {
          const [type, status] = key.split('-');
          const barWidth = (count / maxCount) * (width * 0.6);
          const barY = y + (index * barSpacing);
          
          // Status color
          const statusColor = this.getStatusColor(status);
          
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
          
          // Label
          doc.fontSize(10)
             .fillColor('#333333')
             .font('Helvetica')
             .text(`${type.toUpperCase()} (${status})`, x + width * 0.65, barY + 6);
          
          // Count
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
        
        // If no logs, show message
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
        
        // Enhanced table headers
        const headers = ['Timestamp', 'Type', 'Action', 'Status', 'Details', 'Data'];
        const colWidths = [
          tableWidth * 0.18, // Timestamp
          tableWidth * 0.12, // Type  
          tableWidth * 0.12, // Action
          tableWidth * 0.10, // Status
          tableWidth * 0.28, // Details
          tableWidth * 0.20  // Data
        ];
        
        currentY = this.drawEnhancedTableHeader(doc, headers, colWidths, tableX, currentY, tableWidth);
        
        // Table rows with enhanced styling
        logs.forEach((log, index) => {
          // Check for page break
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
        
        // Header background with gradient effect
        doc.rect(x, y, width, headerHeight)
           .fillColor('#2c5530')
           .fill();
        
        // Add subtle highlight
        doc.rect(x, y, width, 3)
           .fillColor('#4CAF50')
           .fill();
        
        // Header text
        let currentX = x;
        headers.forEach((header, i) => {
          // Column separator line (except for first column)
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
        const sensorDataText = log.sensorData ? this.formatEnhancedSensorData(log.sensorData) : '-';
        
        // Calculate dynamic row height based on content
        const detailsHeight = this.estimateEnhancedTextHeight(detailsText, colWidths[4] - 16, doc);
        const dataHeight = this.estimateEnhancedTextHeight(sensorDataText, colWidths[5] - 16, doc);
        const rowHeight = Math.max(baseRowHeight, detailsHeight + 20, dataHeight + 20);
        
        // Alternating row colors with subtle styling
        const bgColor = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
        doc.rect(x, y, width, rowHeight)
           .fillColor(bgColor)
           .fill();
        
        // Row border
        doc.rect(x, y, width, rowHeight)
           .strokeColor('#e9ecef')
           .lineWidth(0.5)
           .stroke();
        
        // Status indicator (colored left border)
        const statusColor = this.getStatusColor(log.status);
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
        
        // Draw cell content
        let currentX = x;
        cellData.forEach((text, i) => {
          // Column separator
          if (i > 0) {
            doc.moveTo(currentX, y)
               .lineTo(currentX, y + rowHeight)
               .strokeColor('#e9ecef')
               .lineWidth(0.5)
               .stroke();
          }
          
          // Status badge styling for status column
          if (i === 3 && text !== '-') {
            this.drawStatusBadge(doc, currentX + 8, y + 12, text, statusColor);
          } else {
            // Regular text
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

    /**
     * Draw status badge
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
     * Format enhanced sensor data
     */
    static formatEnhancedSensorData(sensorData) {
        if (!sensorData) return '-';
        
        const items = [];
        if (sensorData.moisture !== undefined) items.push(`Moisture: ${sensorData.moisture}%`);
        if (sensorData.temperature !== undefined) items.push(`Temp: ${sensorData.temperature}C`);
        if (sensorData.humidity !== undefined) items.push(`Humidity: ${sensorData.humidity}%`);
        if (sensorData.moistureStatus) items.push(`Status: ${sensorData.moistureStatus}`);
        if (sensorData.waterState !== undefined) items.push(`Water: ${sensorData.waterState ? 'ON' : 'OFF'}`);
        if (sensorData.fertilizerState !== undefined) items.push(`Fertilizer: ${sensorData.fertilizerState ? 'ON' : 'OFF'}`);
        
        return items.join('\n');
    }

    /**
     * Estimate enhanced text height
     */
    static estimateEnhancedTextHeight(text, maxWidth, doc) {
        const fontSize = 8;
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
     * Draw enhanced footer
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
        
        // Left: Generation time
        doc.text(`Generated on ${timestamp}`, 40, footerY + 5);
        
        // Center: Company/system name
        doc.text('Plant Monitoring System', pageWidth / 2 - 60, footerY + 5);
        
        // Right: Confidentiality notice
        doc.text('Confidential Report', pageWidth - 140, footerY + 5);
        
        // Bottom line with contact info
        doc.fontSize(8)
           .fillColor('#999999')
           .text('For questions about this report, contact your system administrator', 
                 40, footerY + 25, { width: pageWidth - 80, align: 'center' });
    }
}

module.exports = AuditUtils;