const antiPermissionAbuse = require('../modules/APA');

module.exports = {
    name: 'roleUpdate',
    once: false,
    async execute(oldRole, newRole) {
        try {
            await antiPermissionAbuse.handleRoleUpdate(oldRole, newRole);
        } catch (error) {
            console.error('[Event: roleUpdate] Error in anti-permission-abuse:', error);
        }
    }
};