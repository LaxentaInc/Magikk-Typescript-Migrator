const antiNuke = require('../modules/AntiNuke');
const logManager = require('../modules/helpers/logManager');

module.exports = {
    name: 'channelDelete',
    async execute(channel, client) {
        try {
            if (!channel.guild) return;

            // Handle Aero Log Channel Deletion (Delayed Recreation)
            if (['aero-logs', 'aero-alerts'].includes(channel.name)) {
                console.log(`[Events] Aero log channel deleted: ${channel.name}. Scheduling recreation in 1 minute.`);

                logManager.invalidateCache(channel.guild.id);
                // Suspend recreation for 60s
                logManager.suspendRecreation(channel.guild.id, 60000);

                // Schedule recreation just after suspension ends
                setTimeout(async () => {
                    try {
                        // Re-fetch guild to ensure it's valid
                        const guild = client.guilds.cache.get(channel.guild.id);
                        if (!guild) return;

                        console.log(`[Events] Recreating ${channel.name} after delay...`);
                        if (channel.name === 'aero-logs') await logManager.getLogChannel(guild);
                        else if (channel.name === 'aero-alerts') await logManager.getAlertChannel(guild);
                    } catch (e) {
                        console.error(`[Events] Failed to recreate ${channel.name}:`, e.message);
                    }
                }, 61000);
            }

            console.log(`[ANTI-NUKE] Channel deleted: ${channel.name} in ${channel.guild.name}`);
            await antiNuke.handleChannelDelete(channel);

        } catch (error) {
            console.error('[ANTI-NUKE] Error in channelDelete event:', error.message);
        }
    }
};