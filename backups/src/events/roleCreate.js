const antiPermissionAbuse = require('../modules/APA');

module.exports = {
    name: 'roleCreate',
    once: false,
    async execute(role) {
        try {
            await antiPermissionAbuse.handleRoleCreate(role);
        } catch (error) {
            console.error('[Event: roleCreate] Error in anti-permission-abuse:', error);
        }
    }
};