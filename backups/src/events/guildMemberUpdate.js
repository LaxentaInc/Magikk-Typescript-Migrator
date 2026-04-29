const antiPermissionAbuse = require('../modules/APA');

module.exports = {
    name: 'guildMemberUpdate',
    once: false,
    async execute(oldMember, newMember) {
        try {
            // Check if roles were added
            const addedRoles = newMember.roles.cache.filter(
                role => !oldMember.roles.cache.has(role.id)
            );

            if (addedRoles.size > 0) {
                // Check each added role for dangerous permissions
                for (const role of addedRoles.values()) {
                    await antiPermissionAbuse.handleMemberRoleAdd(newMember, role);
                }
            }
        } catch (error) {
            console.error('[Event: guildMemberUpdate] Error in anti-permission-abuse:', error);
        }
    }
};