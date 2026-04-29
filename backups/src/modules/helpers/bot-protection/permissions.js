/**
 * Permission Handling Logic
 * Handles checking, stripping, and validating bot permissions
 */

/**
 * Strip ALL permissions/roles from a bot immediately (speed priority)
 * Permission/hierarchy checks are fallback only - we try first, handle errors after
 */
async function stripBotPermissions(member, inviter, config) {
    const strippedRoles = [];
    const strippedPermissions = [];
    let success = false;
    let errorMessage = null;

    try {
        // 1. Separate REMOVABLE roles vs MANAGED roles
        const allRoles = member.roles.cache.filter(role => role.id !== member.guild.id);
        const rolesToRemove = allRoles.filter(role => !role.managed);

        // 2. Remove non-managed roles (safe to remove completely)
        if (rolesToRemove.size > 0) {
            rolesToRemove.forEach(role => {
                strippedRoles.push({
                    name: role.name,
                    id: role.id,
                    permissions: role.permissions.toArray(),
                    managed: false
                });
            });

            await member.roles.remove(rolesToRemove, 'Bot Protection: Auto-strip permissions');
            console.log(`[bot-protection] ⚡ Stripped ${rolesToRemove.size} roles from bot ${member.user.username}`);
            success = true;
        }

        // 3. Handle MANAGED roles (Integration roles)
        // Correct approach: Find the specific integration role for this bot and SET PERMISSIONS TO 0
        // We cannot remove the role, but we CAN edit its permissions if we are higher in hierarchy
        const botIntegrationRole = member.roles.cache.find(role =>
            role.managed &&
            role.tags &&
            role.tags.botId === member.id
        );

        if (botIntegrationRole) {
            console.log(`[bot-protection] ℹ️ Found integration role for ${member.user.username}: @${botIntegrationRole.name}`);

            // Check if it has any permissions to strip
            if (botIntegrationRole.permissions.bitfield > 0n) {
                try {
                    const oldPerms = botIntegrationRole.permissions.toArray();

                    // Set permissions to empty array (0)
                    await botIntegrationRole.setPermissions([], 'Bot Protection: Strip integration permissions');

                    strippedRoles.push({
                        name: botIntegrationRole.name,
                        id: botIntegrationRole.id,
                        permissions: oldPerms,
                        managed: true,
                        stripped: true
                    });

                    console.log(`[bot-protection] ✅ Successfully stripped permissions from integration role @${botIntegrationRole.name}`);
                    success = true;
                } catch (err) {
                    console.log(`[bot-protection] ❌ Failed to strip integration role @${botIntegrationRole.name}: ${err.message}`);
                    // Likely hierarchy issue or missing Manage Roles
                    if (!errorMessage) errorMessage = `Failed to strip integration role: ${err.message}`;
                }
            } else {
                console.log(`[bot-protection] ℹ️ Integration role @${botIntegrationRole.name} already has 0 permissions`);
            }
        }

        if (allRoles.size === 0) {
            success = true; // No roles to remove
            console.log(`[bot-protection] ℹ️ Bot ${member.user.username} has no roles to strip`);
        }

    } catch (error) {
        // Fallback error handling - log but don't block
        errorMessage = error.message;
        console.error(`[bot-protection] ❌ Failed to strip bot permissions: ${error.message}`);

        // Check hierarchy as likely cause
        const botMember = member.guild.members.cache.get(member.guild.client.user.id);
        const botHighestRole = botMember?.roles.highest;
        const targetHighestRole = member.roles.highest;

        if (botHighestRole && targetHighestRole && botHighestRole.position <= targetHighestRole.position) {
            errorMessage = `Hierarchy issue: Bot role @${botHighestRole.name} is not above @${targetHighestRole.name}`;
        }
    }

    return {
        success,
        strippedRoles,
        strippedPermissions,
        errorMessage,
        roleCount: strippedRoles.length
    };
}

/**
 * Restore permissions/roles to a bot
 * Used when user clicks "Restore Permissions" button
 */
async function restoreBotPermissions(member, strippedData) {
    if (!strippedData || !strippedData.strippedRoles || strippedData.strippedRoles.length === 0) {
        return { success: false, message: 'No roles to restore', errors: ['No roles to restore'] };
    }

    let restoredCount = 0;
    let errors = [];

    // 1. Restore removed roles (non-managed)
    const rolesToAdd = [];
    for (const roleData of strippedData.strippedRoles) {
        if (!roleData.managed) {
            const role = member.guild.roles.cache.get(roleData.id);
            if (role) {
                rolesToAdd.push(role);
            } else {
                errors.push(`Role @${roleData.name} no longer exists`);
            }
        }
    }

    if (rolesToAdd.length > 0) {
        try {
            await member.roles.add(rolesToAdd, 'Bot Protection: Restoring permissions');
            restoredCount += rolesToAdd.length;
            console.log(`[bot-protection] ♻️ Restored ${rolesToAdd.length} roles to ${member.user.username}`);
        } catch (err) {
            errors.push(`Failed to restore roles: ${err.message}`);
            console.error(`[bot-protection] ❌ Failed to restore roles: ${err.message}`);
        }
    }

    // 2. Restore integration role permissions (managed)
    const integrationRoles = strippedData.strippedRoles.filter(r => r.managed && r.stripped);
    for (const roleData of integrationRoles) {
        const role = member.guild.roles.cache.get(roleData.id);
        if (role) {
            try {
                // Restore original permissions
                await role.setPermissions(roleData.permissions, 'Bot Protection: Restoring permissions');
                restoredCount++;
                console.log(`[bot-protection] ♻️ Restored permissions to integration role @${role.name}`);
            } catch (err) {
                errors.push(`Failed to restore integration role @${roleData.name}: ${err.message}`);
                console.error(`[bot-protection] ❌ Failed to restore integration role: ${err.message}`);
            }
        } else {
            errors.push(`Integration role @${roleData.name} not found`);
        }
    }

    return {
        success: restoredCount > 0,
        restoredCount,
        errors
    };
}

/**
 * Check if the bot can moderate the target user (hierarchy check)
 */
function canModerateUser(inviter, guild) {
    const botMember = guild.members.cache.get(guild.client.user.id);
    if (!botMember) return false;

    // Bot must be higher than user
    return botMember.roles.highest.position > inviter.roles.highest.position;
}

/**
 * Check if bot has required permissions
 */
function checkBotPermissions(guild, requiredPerms = []) {
    const botMember = guild.members.cache.get(guild.client.user.id);
    if (!botMember) return false;

    return botMember.permissions.has(requiredPerms);
}


module.exports = {
    stripBotPermissions,
    restoreBotPermissions,
    canModerateUser,
    checkBotPermissions
};
