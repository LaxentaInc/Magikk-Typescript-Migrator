const antiNuke = require('../modules/AntiNuke');

module.exports = {
    name: 'channelCreate',
    async execute(channel, client) {
        try {
            if (!channel.guild) return;

            console.log(`[ANTI-NUKE] Channel created: ${channel.name} in ${channel.guild.name}`);
            await antiNuke.handleChannelCreate(channel);

        } catch (error) {
            console.error('[ANTI-NUKE] Error in channelCreate event:', error.message);
        }
    }
};
