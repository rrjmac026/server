/**
 * Deduplication Configuration
 * 
 * Centralized configuration for data deduplication across the system.
 * Adjust these values based on your needs:
 * 
 * - Faster updates = lower thresholds
 * - Less storage = higher thresholds
 * - More precision = lower thresholds
 */

module.exports = {
  // ========== SENSOR DATA DEDUPLICATION ==========
  sensor: {
    // Time-based deduplication
    dedupWindowMs: 10000,        // 10 seconds - reject exact duplicates within this window
    periodicStoreMs: 300000,     // 5 minutes - force store even without change
    
    // Significant change thresholds
    thresholds: {
      moisture: 5,               // 5% change triggers storage
      temperature: 0.5,          // 0.5°C change triggers storage
      humidity: 3                // 3% change triggers storage
    },
    
    // Audit log behavior
    skipAuditForDuplicates: true // Don't create audit logs for rejected duplicates
  },

  // ========== AUDIT LOG DEDUPLICATION ==========
  audit: {
    dedupWindowMs: 5000,         // 5 seconds - prevent duplicate audit entries
    
    // Types of audit logs that should always be stored (no deduplication)
    alwaysStore: [
      'schedule-execute',        // Always log schedule executions
      'device-command',          // Always log device commands
      'user-login'               // Always log user authentication
    ]
  },

  // ========== REPORT GENERATION DEDUPLICATION ==========
  report: {
    dedupWindowMs: 30000,        // 30 seconds - cache report requests
    cacheMaxSize: 100            // Maximum cached reports
  },

  // ========== LOGGING CONFIGURATION ==========
  logging: {
    logDuplicates: true,         // Log when duplicates are detected
    logSkipped: true,            // Log when data is skipped
    logReason: true              // Include reason in logs
  }
};

/**
 * Usage example in services:
 * 
 * const dedupConfig = require('../config/deduplication.config');
 * 
 * const DEDUP_WINDOW_MS = dedupConfig.sensor.dedupWindowMs;
 * const THRESHOLDS = dedupConfig.sensor.thresholds;
 */