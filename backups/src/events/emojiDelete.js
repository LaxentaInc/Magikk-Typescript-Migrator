const antiNuke = require('../modules/AntiNuke');

module.exports = {
    name: 'emojiDelete',
    async execute(emoji, client) {
        try {
            console.log(`[ANTI-NUKE] Emoji deleted: ${emoji.name} in ${emoji.guild.name}`);
            await antiNuke.handleEmojiDelete(emoji);
            
        } catch (error) {
            console.error('[ANTI-NUKE] Error in emojiDelete event:', error.message);
        }
    }
};
