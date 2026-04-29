const AMA = require('../modules/AMA'); // AMA module handles ban detection

module.exports = {
    name: 'guildBanAdd',
    async execute(ban, client) {
        try {
            console.log(`[PROTECTION EVENT] Member banned: ${ban.user.username} in ${ban.guild.name}`);

            // AMA module handles ban detection (AntiNuke removed - it only handles channels/roles/emojis)
            await AMA.handleBanAdd(ban);

        } catch (error) {
            console.error('[PROTECTION] Error in guildBanAdd event:', error.message);
        }
    }
};

