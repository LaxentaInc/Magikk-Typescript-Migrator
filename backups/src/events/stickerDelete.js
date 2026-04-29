const antiNuke = require('../modules/AntiNuke');

module.exports = {
    name: 'stickerDelete',
    async execute(sticker, client) {
        try {
            if (!sticker.guild) return;
            
            console.log(`[ANTI-NUKE] Sticker deleted: ${sticker.name} in ${sticker.guild.name}`);
            await antiNuke.handleStickerDelete(sticker);
            
        } catch (error) {
            console.error('[ANTI-NUKE] Error in stickerDelete event:', error.message);
        }
    }
};
