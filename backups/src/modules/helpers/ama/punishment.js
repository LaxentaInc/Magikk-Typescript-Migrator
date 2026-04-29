/**
 * AMA Punishment & Role Stripping
 */

/**
 * Execute punishment action on violator
 */
async function executePunishment(member, guild, action, config) {
    const moduleName = 'mass-action-protection';
    try {
        switch (action) {
            case 'remove_roles':
                const rolesToRemove = member.roles.cache.filter(role => role.id !== guild.id);
                if (rolesToRemove.size > 0) {
                    await member.roles.remove(rolesToRemove, 'Mass action violation - role removal');
                    return { success: true, action: `Removed ${rolesToRemove.size} roles` };
                }
                return { success: false, action: 'No roles to remove' };

            case 'timeout':
                await member.timeout(config.timeoutDuration * 1000, 'Mass action violation - timeout');
                return { success: true, action: `Timed out for ${config.timeoutDuration}s` };

            case 'kick':
                await member.kick('Mass action violation - kicked');
                return { success: true, action: 'Kicked from server' };

            case 'ban':
                await member.ban({ reason: 'Mass action violation - banned', deleteMessageSeconds: 0 });
                return { success: true, action: 'Banned from server' };

            case 'notify':
                // Just a notification action, no punishment
                return { success: true, action: 'Owner notified' };

            default:
                console.log(`[${moduleName}] ⚠️ Unknown punishment action: ${action}`);
                return { success: false, action: `Unknown action: ${action}` };
        }

    } catch (error) {
        console.error(`[${moduleName}] ❌ Failed to execute ${action} on ${member.user.username}:`, error.message);
        return { success: false, action: `Failed: ${error.message}` };
    }
}

/**
 * STRIP FIRST Logic:
 * Immediately remove dangerous roles to ensure bot can punish admins
 */
async function stripDangerousRoles(member, guild) {
    const moduleName = 'mass-action-protection';
    try {
        // Define dangerous permissions
        const dangerousPermissions = [
            'Administrator',
            'ManageGuild',
            'ManageRoles',
            'ManageChannels',
            'BanMembers',
            'KickMembers',
            'ManageWebhooks'
        ];

        // Find roles with these permissions
        const dangerousRoles = member.roles.cache.filter(role =>
            role.id !== guild.id && // Not @everyone
            role.permissions.any(dangerousPermissions) &&
            role.editable // Ensure bot can edit this role
        );

        if (dangerousRoles.size === 0) {
            return { success: true, removedCount: 0, reason: 'No dangerous roles found or editable' };
        }

        console.log(`[${moduleName}] ⚠️ Stripping ${dangerousRoles.size} dangerous roles from ${member.user.username} BEFORE punishment...`);

        await member.roles.remove(dangerousRoles, 'Anti-Nuke Emergency: Stripping dangerous privileges before punishment');

        return {
            success: true,
            removedCount: dangerousRoles.size,
            roles: dangerousRoles.map(r => r.name)
        };

    } catch (error) {
        console.error(`[${moduleName}] ❌ Failed to strip dangerous roles:`, error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    executePunishment,
    stripDangerousRoles
};
