/**
 * User Punishment Logic
 * Handles punishing users who add suspicious bots and logging failures
 */

/**
 * Punish the user who added the suspicious bot
 * Includes hierarchy checks and detailed error logging
 */
async function punishUser(user, guild, config, suspicionData, logPunishmentFailureFn) {
    const member = guild.members.cache.get(user.id);
    if (!member) return {
        punished: false,
        punishmentTypes: [],
        errors: ['User not found in guild']
    };

    const punishmentTypes = [];
    const errors = [];
    let punished = false;

    // Get bot member for hierarchy checks
    const botMember = guild.members.cache.get(guild.client.user.id);
    if (!botMember) {
        errors.push('Bot member not found');
        return { punished: false, punishmentTypes: [], errors };
    }

    // Check role hierarchy FIRST - bot's highest role must be higher than target's highest role
    const botHighestRole = botMember.roles.highest;
    const targetHighestRole = member.roles.highest;

    const canModerate = botHighestRole.position > targetHighestRole.position;

    if (!canModerate) {
        const hierarchyError = `**HIERARCHY ISSUE**: Bot cannot punish ${user.username} - target's highest role is **@${targetHighestRole.name}** (position ${targetHighestRole.position}) but bot's highest role is **@${botHighestRole.name}** (position ${botHighestRole.position})`;
        errors.push(hierarchyError);
        console.error(`[bot-protection] ${hierarchyError}`);

        // Send detailed error to log channel AND DM owner
        await logPunishmentFailureFn(guild, user, member, suspicionData, hierarchyError, config);

        return { punished: false, punishmentTypes: [], errors };
    }

    // Check if target has Administrator permission (just for logging, we'll still try)
    const hasAdminPerms = member.permissions.has('Administrator');
    if (hasAdminPerms) {
        console.log(`[bot-protection] Target ${user.username} has Administrator permission - attempting punishment anyway (hierarchy allows it)`);
    }

    try {
        // --- STEP 1: PRIORITIZE ROLE REMOVAL (Strip Admin/Mod perms first) ---
        // This MUST happen before timeout/kick/ban to ensure we can actually moderate the user
        // if they had Anti-Timeout permissions (Administrator)

        if (config.punishmentActions.includes('remove_roles_adder')) {
            try {
                // Check MANAGE_ROLES permission
                if (!botMember.permissions.has('ManageRoles')) {
                    const permError = 'Bot lacks MANAGE_ROLES permission';
                    errors.push(permError);
                    console.error(`[bot-protection] ${permError}`);
                    await logPunishmentFailureFn(guild, user, member, suspicionData, permError, config);
                } else {
                    // Remove all roles except @everyone
                    const rolesToRemove = member.roles.cache.filter(role => role.id !== guild.id);
                    if (rolesToRemove.size > 0) {
                        await member.roles.remove(rolesToRemove, 'Added suspicious bot');
                        console.log(`[bot-protection] Removed ${rolesToRemove.size} roles from ${user.username}`);
                        punishmentTypes.push('roles_removed');
                        punished = true;

                        // CRITICAL: Wait a moment for Discord to propagate permission changes
                        // If we try to timeout immediately after stripping Admin, it might fail saying "Missing Permissions"
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        // Force refresh member to get updated permissions
                        await member.fetch(true);
                    }
                }
            } catch (err) {
                const roleError = `Failed to remove roles: ${err.message}`;
                errors.push(roleError);
                console.error(`[bot-protection] ${roleError}`);
                await logPunishmentFailureFn(guild, user, member, suspicionData, roleError, config);
            }
        }

        // --- STEP 2: EXECUTE REMAINING PUNISHMENTS ---
        for (const action of config.punishmentActions) {
            // Skip role removal as we handled it first
            if (action === 'remove_roles_adder') continue;

            switch (action) {
                case 'timeout_adder':
                    try {
                        // Check MODERATE_MEMBERS permission
                        if (!botMember.permissions.has('ModerateMembers')) {
                            const permError = 'Bot lacks MODERATE_MEMBERS permission';
                            errors.push(permError);
                            console.error(`[bot-protection] ${permError}`);
                            await logPunishmentFailureFn(guild, user, member, suspicionData, permError, config);
                            break;
                        }

                        // Try to timeout
                        await member.timeout(config.timeoutDuration * 1000, 'Added suspicious bot');
                        console.log(`[bot-protection] Timed out ${user.username} for ${config.timeoutDuration}s`);
                        punishmentTypes.push('timeout');
                        punished = true;
                    } catch (err) {
                        const timeoutError = `Failed to timeout: ${err.message}`;
                        errors.push(timeoutError);
                        console.error(`[bot-protection] ${timeoutError}`);
                        await logPunishmentFailureFn(guild, user, member, suspicionData, timeoutError, config);
                    }
                    break;

                case 'kick_adder':
                    try {
                        // Check KICK_MEMBERS permission
                        if (!botMember.permissions.has('KickMembers')) {
                            const permError = 'Bot lacks KICK_MEMBERS permission';
                            errors.push(permError);
                            console.error(`[bot-protection] ${permError}`);
                            await logPunishmentFailureFn(guild, user, member, suspicionData, permError, config);
                            break;
                        }

                        await member.kick('Added suspicious bot');
                        console.log(`[bot-protection] Kicked ${user.username}`);
                        punishmentTypes.push('kick');
                        punished = true;
                    } catch (err) {
                        const kickError = `Failed to kick: ${err.message}`;
                        errors.push(kickError);
                        console.error(`[bot-protection] ${kickError}`);
                        await logPunishmentFailureFn(guild, user, member, suspicionData, kickError, config);
                    }
                    break;

                case 'ban_adder':
                    try {
                        // Check BAN_MEMBERS permission
                        if (!botMember.permissions.has('BanMembers')) {
                            const permError = 'Bot lacks BAN_MEMBERS permission';
                            errors.push(permError);
                            console.error(`[bot-protection] ${permError}`);
                            await logPunishmentFailureFn(guild, user, member, suspicionData, permError, config);
                            break;
                        }

                        await member.ban({ reason: 'Added suspicious bot', deleteMessageSeconds: 0 });
                        console.log(`[bot-protection] Banned ${user.username}`);
                        punishmentTypes.push('ban');
                        punished = true;
                    } catch (err) {
                        const banError = `Failed to ban: ${err.message}`;
                        errors.push(banError);
                        console.error(`[bot-protection] ${banError}`);
                        await logPunishmentFailureFn(guild, user, member, suspicionData, banError, config);
                    }
                    break;

                case 'notify':
                    // Just notification, handled elsewhere
                    break;

                default:
                    if (config.debug) {
                        console.log(`[bot-protection] Unknown punishment action: ${action}`);
                    }
            }
        }

    } catch (error) {
        const generalError = `Failed to punish user ${user.username}: ${error.message}`;
        errors.push(generalError);
        console.error(`[bot-protection] ${generalError}`);
        await logPunishmentFailureFn(guild, user, member, suspicionData, generalError, config);
    }

    return { punished, punishmentTypes, errors };
}

module.exports = {
    punishUser
};
