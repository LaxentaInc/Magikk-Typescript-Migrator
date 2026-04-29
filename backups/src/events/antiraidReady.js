/*
=== ANTI-RAID READY EVENT ===
Drop this in your src/events/ folder.
Initializes the anti-raid system when the bot starts.
*/

const antiRaid = require('../modules/anti_raid'); // Adjust path as needed
const { logger } = require('../utils/logger');

module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        try {
            logger.info('🛡️ [AntiRaid] Initializing anti-raid system...');

            // Initialize default settings for all current guilds
            for (const [guildId, guild] of client.guilds.cache) {
                await antiRaid.initializeGuild(guildId, guild.name);
            }

            logger.info(`🛡️ [AntiRaid] System active on ${client.guilds.cache.size} guilds`);
            logger.info(`📦 [AntiRaid] Loaded modules: ${antiRaid.getLoadedModules().join(', ')}`);

        } catch (error) {
            logger.error('💥 [AntiRaid] Critical error during initialization:', {
                message: error.message,
                stack: error.stack
            });
        }
    }
};
