/**
 * AntiSpam Module
 * 
 * This file now serves as a simple wrapper that loads the modular antispam system.
 * All functionality has been moved to the helpers/antispam/ folder for easier maintenance.
 * 
 * Modules:
 *   - helpers/antispam/config.js     - Configuration management
 *   - helpers/antispam/detection.js  - Spam detection functions
 *   - helpers/antispam/tracking.js   - User activity tracking
 *   - helpers/antispam/database.js   - MongoDB operations
 *   - helpers/antispam/punishment.js - Punishment & notifications
 *   - helpers/antispam/index.js      - Main SpamProtection class
 */

module.exports = require('./helpers/antispam');