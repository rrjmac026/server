const auditService = require('../services/audit.service');
const { validateAuditLog } = require('../utils/validators');

exports.createAuditLog = async (req, res) => {
  try {
    const data = req.body;
    const validationError = validateAuditLog(data);
    
    if (validationError) {
      return res.status(400).json({ 
        success: false, 
        error: validationError 
      });
    }

    const result = await auditService.createAuditLog(data);
    res.status(201).json({ 
      success: true,
      id: result.insertedId,
      data: result.data 
    });
  } catch (error) {
    console.error("Error creating audit log:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to create audit log" 
    });
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    const result = await auditService.getAuditLogs(req.query);
    res.json(result);
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch audit logs",
      logs: [] 
    });
  }
};

exports.exportAuditLogs = async (req, res) => {
  try {
    await auditService.exportAuditLogs(req, res);
  } catch (error) {
    console.error("Error exporting audit logs:", error);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        error: "Failed to export audit logs" 
      });
    }
  }
};

exports.getAuditLogTypes = async (req, res) => {
  try {
    const types = await auditService.getAuditLogTypes();
    res.json({ success: true, types });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch log types",
      types: []
    });
  }
};

exports.getAuditLogActions = async (req, res) => {
  try {
    const actions = await auditService.getAuditLogActions();
    res.json({ success: true, actions });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch actions",
      actions: []
    });
  }
};