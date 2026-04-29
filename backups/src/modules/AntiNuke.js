/**
 * AntiNuke Module
 * 
 * Modular Anti-Nuke protection using helpers/antinuke/
 * 
 * FIXED ARCHITECTURE:
 * 1. ALWAYS TRACK FIRST - Never skip tracking, even if responding
 * 2. GUILD-LEVEL LOCK - Prevents duplicate punishment, NOT duplicate tracking
 * 3. BATCH PROCESSING - Wait for raid to finish, then restore all
 * 
 * See helpers/antinuke/ for implementation details.
 */

const AntiNuke = require('./helpers/antinuke');

// Export singleton instance
const instance = new AntiNuke();
module.exports = instance;