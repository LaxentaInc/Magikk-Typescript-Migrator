const antiNuke = require('../modules/AntiNuke');

module.exports = {
    name: 'webhookUpdate',
    async execute(channel, client) {
        try {
            if (!channel.guild) return;
            
            console.log(`[ANTI-NUKE] Webhook update in: ${channel.name} (${channel.guild.name})`);
            await antiNuke.handleWebhookUpdate(channel);
            
        } catch (error) {
            console.error('[ANTI-NUKE] Error in webhookUpdate event:', error.message);
        }
    }
};
