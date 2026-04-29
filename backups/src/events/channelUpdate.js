const antiNuke = require('../modules/AntiNuke');

module.exports = {
    name: 'channelUpdate',
    async execute(oldChannel, newChannel, client) {
        try {
            if (!newChannel.guild) return;

            // console.log(`[ANTI-NUKE] Channel updated: ${newChannel.name} in ${newChannel.guild.name}`);
            await antiNuke.handleChannelUpdate(oldChannel, newChannel);

        } catch (error) {
            console.error('[ANTI-NUKE] Error in channelUpdate event:', error.message);
        }
    }
};
