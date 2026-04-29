/**
 * Bot Protection Module
 * 
 * Automatically kicks suspicious bots and punishes users who add them.
 * ALL bots get permissions stripped immediately - suspicious ones get kicked + adder punished.
 * 
 * This module is now modularized into helpers for better maintainability.
 * See: src/modules/helpers/bot-protection/
 */

module.exports = require('./helpers/bot-protection');