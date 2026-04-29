/**
 * Lavalink Handler
 * 
 * This file now serves as a simple wrapper that loads the modular player system.
 * All functionality has been moved to the player/ folder for easier maintenance.
 * 
 * Modules:
 *   - player/manager.js  - LavalinkManager setup, node management
 *   - player/search.js   - Search functions, track normalization
 *   - player/controls.js - Playback controls, button handlers
 *   - player/embeds.js   - All embed generation
 *   - player/events.js   - Player event handlers
 *   - player/index.js    - Main entry point
 */

module.exports = require('./player');