const antiNuke = require('../modules/AntiNuke');

module.exports = {
    name: 'roleDelete',
    async execute(role, client) {
        try {
            console.log(`[ANTI-NUKE] Role deleted: ${role.name} in ${role.guild.name}`);
            await antiNuke.handleRoleDelete(role);
            
        } catch (error) {
            console.error('[ANTI-NUKE] Error in roleDelete event:', error.message);
        }
    }
};