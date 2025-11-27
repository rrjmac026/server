const reportService = require('../services/report.service');

exports.generateReport = async (req, res) => {
  try {
    const { plantId, start, end, format = 'pdf' } = req.query;
    
    if (!plantId || !start || !end) {
      return res.status(400).json({
        error: "Missing parameters",
        example: "/api/reports?plantId=123&start=2024-01-01&end=2024-01-31&format=pdf|json"
      });
    }

    // Validate date format
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        error: "Invalid date format. Use YYYY-MM-DD"
      });
    }

    if (startDate > endDate) {
      return res.status(400).json({
        error: "Start date cannot be after end date"
      });
    }

    await reportService.generateReport(req, res, plantId, start, end, format);
  } catch (error) {
    console.error("❌ Report generation error:", error);
    res.status(500).json({ 
      error: "Failed to generate report", 
      details: error.message
    });
  }
};

exports.generateReportByPlantId = async (req, res) => {
  try {
    const { plantId } = req.params;
    const { start, end, format = 'pdf' } = req.query;
    
    if (!start || !end) {
      return res.status(400).json({
        error: "Missing parameters",
        example: "/api/reports/PLANT123?start=2024-01-01&end=2024-01-31&format=pdf|json"
      });
    }

    // Validate date format
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        error: "Invalid date format. Use YYYY-MM-DD"
      });
    }

    if (startDate > endDate) {
      return res.status(400).json({
        error: "Start date cannot be after end date"
      });
    }

    await reportService.generateReport(req, res, plantId, start, end, format);
  } catch (error) {
    console.error("❌ Report generation error:", error);
    res.status(500).json({ 
      error: "Failed to generate report", 
      details: error.message
    });
  }
};