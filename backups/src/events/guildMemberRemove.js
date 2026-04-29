const AMA = require('../modules/AMA.js');
const antiNuke = require('../modules/AntiNuke.js'); // New anti-nuke module

module.exports = {
    name: 'guildMemberRemove',
    once: false,
    async execute(member, client) {
        // Log the member removal event
        console.log(`Member ${member.user.tag} left/removed from ${member.guild.name}`);

        try {
            // Check if AMA module is properly loaded
            if (!AMA) {
                console.error('❌ AMA module not loaded properly');
                return;
            }

        
                // console.log('Available AMA methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(AMA)));

            // Pass the member removal to AMA module for processing
            await AMA.handleMemberRemove(member);
        } catch (error) {
            console.error('Error in guildMemberRemove event:', error);
            console.error('Stack trace:', error.stack);
        }
    }
};