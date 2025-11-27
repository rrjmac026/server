const moment = require('moment-timezone');

function drawTableHeader(doc, headers, x, y, width) {
  const cellWidths = [
    width * 0.20, width * 0.12, width * 0.12, width * 0.12,
    width * 0.15, width * 0.145, width * 0.145
  ];
  
  doc.fillColor('#1a4e1a').rect(x, y, width, 25).fill();
  doc.strokeColor('#000000').lineWidth(1).rect(x, y, width, 25).stroke();

  let currentX = x;
  headers.forEach((header, i) => {
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10)
       .text(header, currentX + 3, y + 7, { 
         width: cellWidths[i] - 6, align: 'center', lineBreak: false
       });
    currentX += cellWidths[i];
  });
  
  return y + 30;
}

function drawTableRow(doc, data, x, y, width) {
  const cellWidths = [
    width * 0.20, width * 0.12, width * 0.12, width * 0.12,
    width * 0.15, width * 0.145, width * 0.145
  ];
  
  const rowHeight = 22;
  
  if (y > doc.page.height - 75) return null;
  
  doc.fillColor('#f0f0f0').rect(x, y, width, rowHeight).fill();
  doc.strokeColor('#000000').lineWidth(0.8).rect(x, y, width, rowHeight).stroke();

  let currentX = x;
  data.forEach((cell, i) => {
    if (i > 0) {
      doc.moveTo(currentX, y).lineTo(currentX, y + rowHeight).stroke();
    }
    
    doc.fillColor('#000000').font('Helvetica').fontSize(9)
       .text(cell.toString(), currentX + 3, y + 6, {
         width: cellWidths[i] - 6, align: 'center', lineBreak: false
       });
    
    currentX += cellWidths[i];
  });
  
  return y + rowHeight + 2;
}

function drawPageHeader(doc, pageNumber, title) {
  const pageWidth = doc.page.width;
  
  doc.rect(50, 30, pageWidth - 100, 80).fillColor('#e0e0e0').fill();
  doc.rect(50, 30, pageWidth - 100, 80).strokeColor('#000000').lineWidth(2).stroke();
  
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#1a4e1a')
     .text('Plant Monitoring System', 70, 45, { align: 'left' })
     .fontSize(14).fillColor('#333333')
     .text('Detailed Monitoring Report', 70, 70, { align: 'left' });
  
  doc.fontSize(10).fillColor('#000000')
     .text(`Page ${pageNumber}`, pageWidth - 120, 45, { align: 'right', width: 60 });
     
  return 130;
}

function drawPageFooter(doc, timestamp) {
  const pageWidth = doc.page.width;
  const footerY = doc.page.height - 50;
  
  doc.moveTo(50, footerY).lineTo(pageWidth - 50, footerY)
     .strokeColor('#000000').lineWidth(1.5).stroke();
  
  doc.fontSize(9).fillColor('#000000');
  doc.text(`Generated on ${timestamp}`, 50, footerY + 10, { width: 200, align: 'left' });
  doc.text('Plant Monitoring System', pageWidth / 2 - 100, footerY + 10, { width: 200, align: 'center' });
  doc.text('Confidential Report', pageWidth - 250, footerY + 10, { width: 200, align: 'right' });
}

// ...existing enhanced footer functions...
function drawEnhancedAuditHeader(doc, pageNumber) {
  const pageWidth = doc.page.width;
  const headerHeight = 120;
  
  doc.rect(0, 0, pageWidth, headerHeight).fillColor('#2c5530').fill();
  doc.rect(0, 0, pageWidth, headerHeight).fillColor('#34633a').fillOpacity(0.3).fill();
  doc.fillOpacity(1);
  
  const logoX = 60, logoY = 30, logoRadius = 25;
  doc.circle(logoX, logoY, logoRadius).fillColor('#ffffff').fillOpacity(0.15).fill().fillOpacity(1);
  doc.fontSize(16).fillColor('#ffffff').font('Helvetica-Bold').text('PM', logoX - 8, logoY - 8);
  
  doc.fontSize(28).fillColor('#ffffff').font('Helvetica-Bold').text('AUDIT LOGS REPORT', 120, 25);
  doc.fontSize(14).fillColor('#e8f5e8').font('Helvetica').text('Plant Monitoring System • Activity Tracking', 120, 60);
  
  const pageIndicatorX = pageWidth - 120;
  doc.rect(pageIndicatorX, 25, 80, 25).fillColor('#ffffff').fillOpacity(0.1).fill().fillOpacity(1)
     .strokeColor('#ffffff').strokeOpacity(0.3).lineWidth(1).stroke();
  
  doc.fontSize(12).fillColor('#ffffff').font('Helvetica-Bold')
     .text(`Page ${pageNumber}`, pageIndicatorX, 32, { width: 80, align: 'center' });
  
  doc.moveTo(0, headerHeight).lineTo(pageWidth, headerHeight)
     .strokeColor('#1a4d1f').lineWidth(3).stroke();
  
  return headerHeight + 30;
}

function drawEnhancedFooter(doc) {
  const pageWidth = doc.page.width;
  const footerY = doc.page.height - 60;
  const timestamp = moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss');
  
  doc.rect(0, footerY - 10, pageWidth, 70).fillColor('#f8f9fa').fill();
  doc.moveTo(0, footerY - 10).lineTo(pageWidth, footerY - 10)
     .strokeColor('#2c5530').lineWidth(2).stroke();
  
  doc.fontSize(9).fillColor('#666666').font('Helvetica');
  doc.text(`Generated on ${timestamp}`, 40, footerY + 5);
  doc.text('Plant Monitoring System', pageWidth / 2 - 60, footerY + 5);
  doc.text('Confidential Report', pageWidth - 140, footerY + 5);
  
  doc.fontSize(8).fillColor('#999999')
     .text('For questions about this report, contact your system administrator', 
           40, footerY + 25, { width: pageWidth - 80, align: 'center' });
}

function drawAuditSummarySection(doc, startY, logs, plantId, start, end, type) {
  const sectionWidth = doc.page.width - 80;
  const sectionX = 40;
  let currentY = startY;
  
  doc.fontSize(18)
     .fillColor('#2c5530')
     .font('Helvetica-Bold')
     .text('Report Summary', sectionX, currentY);
  
  currentY += 35;
  
  const cardHeight = 80;
  const cardWidth = (sectionWidth - 30) / 3;
  
  drawSummaryCard(doc, sectionX, currentY, cardWidth, cardHeight, 
    'Total Logs', logs.length.toString(), '#4CAF50', 'LOGS');
  
  const dateRange = start && end ? 
    `${moment(start).format('MMM DD')} - ${moment(end).format('MMM DD, YYYY')}` : 
    'All Time';
  drawSummaryCard(doc, sectionX + cardWidth + 15, currentY, cardWidth, cardHeight,
    'Date Range', dateRange, '#2196F3', 'DATE');
  
  const filterInfo = plantId ? `Plant ${plantId}` : (type ? type.toUpperCase() : 'All Types');
  drawSummaryCard(doc, sectionX + (cardWidth + 15) * 2, currentY, cardWidth, cardHeight,
    'Filter', filterInfo, '#FF9800', 'FILTER');
  
  currentY += cardHeight + 30;
  
  if (logs.length > 0) {
    currentY = drawActivityBreakdown(doc, sectionX, currentY, sectionWidth, logs);
  }
  
  return currentY + 20;
}

function drawSummaryCard(doc, x, y, width, height, title, value, color, icon) {
  doc.rect(x + 2, y + 2, width, height)
     .fillColor('#000000')
     .fillOpacity(0.1)
     .fill()
     .fillOpacity(1);
  
  doc.rect(x, y, width, height)
     .fillColor('#ffffff')
     .fill()
     .strokeColor('#e0e0e0')
     .lineWidth(1)
     .stroke();
  
  doc.rect(x, y, width, 4)
     .fillColor(color)
     .fill();
  
  const iconSize = 30;
  const iconX = x + 15;
  const iconY = y + 15;
  
  doc.circle(iconX + iconSize/2, iconY + iconSize/2, iconSize/2)
     .fillColor(color)
     .fillOpacity(0.1)
     .fill()
     .fillOpacity(1);
  
  doc.fontSize(9)
     .fillColor(color)
     .font('Helvetica-Bold')
     .text(icon, iconX + 5, iconY + 12);
  
  doc.fontSize(10)
     .fillColor('#666666')
     .font('Helvetica')
     .text(title.toUpperCase(), iconX + iconSize + 10, iconY + 5);
  
  doc.fontSize(16)
     .fillColor('#333333')
     .font('Helvetica-Bold')
     .text(value, iconX + iconSize + 10, iconY + 20, {
       width: width - iconSize - 40,
       lineBreak: false
     });
}

function drawActivityBreakdown(doc, x, y, width, logs) {
  const breakdown = logs.reduce((acc, log) => {
    const key = `${log.type}-${log.status}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  
  doc.fontSize(14)
     .fillColor('#2c5530')
     .font('Helvetica-Bold')
     .text('Activity Breakdown', x, y);
  
  y += 25;
  
  const maxCount = Math.max(...Object.values(breakdown));
  const barHeight = 20;
  const barSpacing = 25;
  
  Object.entries(breakdown).forEach(([key, count], index) => {
    const [type, status] = key.split('-');
    const barWidth = (count / maxCount) * (width * 0.6);
    const barY = y + (index * barSpacing);
    
    const statusColor = getStatusColor(status);
    
    doc.rect(x, barY, width * 0.6, barHeight)
       .fillColor('#f5f5f5')
       .fill();
    
    doc.rect(x, barY, barWidth, barHeight)
       .fillColor(statusColor)
       .fillOpacity(0.8)
       .fill()
       .fillOpacity(1);
    
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

function getStatusColor(status) {
  const colors = {
    'success': '#4CAF50',
    'failed': '#f44336',
    'warning': '#FF9800',
    'info': '#2196F3'
  };
  return colors[status] || '#9E9E9E';
}

function drawAuditLogsTable(doc, startY, logs) {
  let currentY = startY;
  const pageWidth = doc.page.width;
  const tableX = 40;
  const tableWidth = pageWidth - 80;
  
  doc.fontSize(18)
     .fillColor('#2c5530')
     .font('Helvetica-Bold')
     .text('Detailed Activity Log', tableX, currentY);
  
  currentY += 35;
  
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
  
  const headers = ['Timestamp', 'Type', 'Action', 'Status', 'Details', 'Data'];
  const colWidths = [
    tableWidth * 0.18,
    tableWidth * 0.12,
    tableWidth * 0.12,
    tableWidth * 0.10,
    tableWidth * 0.28,
    tableWidth * 0.20
  ];
  
  currentY = drawEnhancedTableHeader(doc, headers, colWidths, tableX, currentY, tableWidth);
  
  logs.forEach((log, index) => {
    if (currentY > doc.page.height - 100) {
      doc.addPage();
      currentY = 60;
      currentY = drawEnhancedTableHeader(doc, headers, colWidths, tableX, currentY, tableWidth);
    }
    
    currentY = drawEnhancedTableRow(doc, log, colWidths, tableX, currentY, tableWidth, index);
  });
  
  return currentY;
}

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

function drawEnhancedTableRow(doc, log, colWidths, x, y, width, index) {
  const baseRowHeight = 45;
  const detailsText = log.details || '-';
  const sensorDataText = log.sensorData ? formatEnhancedSensorData(log.sensorData) : '-';
  
  const detailsHeight = estimateEnhancedTextHeight(detailsText, colWidths[4] - 20, doc, 8);
  const dataHeight = estimateEnhancedTextHeight(sensorDataText, colWidths[5] - 20, doc, 8);
  const timestampHeight = estimateEnhancedTextHeight(moment(log.timestamp).format('MMM: DD\nHH:mm:ss'), colWidths[0] - 20, doc, 9);
  
  const rowHeight = Math.max(baseRowHeight, detailsHeight + 15, dataHeight + 15, timestampHeight + 15);
  
  const bgColor = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
  doc.rect(x, y, width, rowHeight)
     .fillColor(bgColor)
     .fill();
  
  doc.rect(x, y, width, rowHeight)
     .strokeColor('#e9ecef')
     .lineWidth(0.5)
     .stroke();
  
  const statusColor = getStatusColor(log.status);
  doc.rect(x, y, 4, rowHeight)
     .fillColor(statusColor)
     .fill();
  
  const cellData = [
    moment(log.timestamp).format('MMM: DD\nHH:mm:ss'),
    (log.type || '-').toUpperCase(),
    (log.action || '-').toUpperCase(),
    log.status || '-',
    detailsText,
    sensorDataText
  ];
  
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
      drawStatusBadge(doc, currentX + 8, y + (rowHeight / 2) - 9, text, statusColor);
    } else {
      const fontSize = i === 0 ? 9 : (i === 4 || i === 5 ? 8 : 10);
      const fontWeight = (i === 1 || i === 2) ? 'Helvetica-Bold' : 'Helvetica';
      
      doc.fillColor('#333333')
         .font(fontWeight)
         .fontSize(fontSize)
         .text(text, 
               currentX + 8, 
               y + 8, 
               { 
                 width: colWidths[i] - 16, 
                 align: i <= 2 ? 'left' : 'left',
                 lineBreak: true,
                 height: rowHeight - 16
               });
    }
    
    currentX += colWidths[i];
  });
  
  return y + rowHeight;
}

function drawStatusBadge(doc, x, y, status, color) {
  const badgeWidth = 60;
  const badgeHeight = 18;
  
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
  
  doc.fillColor(color)
     .font('Helvetica-Bold')
     .fontSize(9)
     .text(status.toUpperCase(), x, y + 5, {
       width: badgeWidth,
       align: 'center'
     });
}

function formatEnhancedSensorData(sensorData) {
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

function estimateEnhancedTextHeight(text, maxWidth, doc, fontSize = 8) {
  const lineHeight = fontSize * 1.5;
  
  if (!text || text === '-') return lineHeight;
  
  const lines = text.split('\n');
  let totalLines = 0;
  
  lines.forEach(line => {
    if (!line.trim()) {
      totalLines += 1;
      return;
    }
    
    const words = line.split(' ');
    let currentLine = '';
    let lineCount = 1;
    
    words.forEach(word => {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const width = doc.widthOfString(testLine, { fontSize });
      
      if (width > maxWidth) {
        if (currentLine) {
          lineCount++;
          currentLine = word;
        } else {
          currentLine = word;
        }
      } else {
        currentLine = testLine;
      }
    });
    
    totalLines += lineCount;
  });
  
  return totalLines * lineHeight;
}

module.exports = {
  drawTableHeader,
  drawTableRow,
  drawPageHeader,
  drawPageFooter,
  drawEnhancedAuditHeader,
  drawEnhancedFooter,
  drawAuditSummarySection,
  drawAuditLogsTable,
  drawSummaryCard,
  drawActivityBreakdown,
  getStatusColor,
  drawEnhancedTableHeader,
  drawEnhancedTableRow,
  drawStatusBadge,
  formatEnhancedSensorData,
  estimateEnhancedTextHeight
};
