/**
 * AntiNuke Punishment
 * Role stripping and punishment execution
 */

const { PermissionFlagsBits } = require('discord.js');
const { saveUserStrip, loadUserStrip } = require('./storage');

const DANGEROUS_PERMISSIONS = [
    'Administrator',
    'ManageGuild',
    'ManageRoles',
    'ManageChannels',
    'BanMembers',
    'KickMembers'
];

/**
 * Strip dangerous roles from a member IMMEDIATELY
 * This is the fastest response - do this FIRST before anything else
 * 
 * @param {Guild} guild - Discord guild
 * @param {User} executor - The executor user object
 * @param {GuildMember} [prefetchedMember] - Optional pre-fetched member to avoid duplicate fetches
 */
async function stripDangerousRoles(guild, executor, prefetchedMember = null) {
    try {
        const member = prefetchedMember || await guild.members.fetch(executor.id).catch(() => null);
        if (!member) {
            console.log(`[AntiNuke] Cannot strip ${executor.username}: User left server`);
            return { success: false, reason: 'User left server' };
        }

        const botMember = guild.members.me;
        if (!botMember) return { success: false, reason: 'Cannot fetch bot' };

        // CRITICAL: Check hierarchy BEFORE attempting anything
        if (!member.manageable) {
            console.error(`[AntiNuke] Cannot strip ${executor.username}: Role hierarchy issue (their highest role >= bot's highest role)`);
            return { success: false, reason: 'Role Hierarchy', hierarchyIssue: true };
        }

        // Get all roles except @everyone
        const allRoles = member.roles.cache.filter(role => role.id !== guild.id);
        const managedRoles = allRoles.filter(role => role.managed);
        const nonManagedRoles = allRoles.filter(role => !role.managed);

        // Track what we changed so it can be restored later via buttons
        const strippedRoles = [];

        let strippedCount = 0;
        let failedManagedRoles = 0;

        // 1. Handle managed roles (integration roles) - edit permissions directly
        // Don't check role.editable - just TRY to edit and catch errors
        for (const role of managedRoles.values()) {
            try {
                const currentPermissions = role.permissions;
                const permissionsToRemove = DANGEROUS_PERMISSIONS
                    .map(perm => PermissionFlagsBits[perm])
                    .filter(Boolean);
                const newPermissions = currentPermissions.remove(permissionsToRemove);

                if (!currentPermissions.equals(newPermissions)) {
                    await role.edit({
                        permissions: newPermissions,
                        reason: `AntiNuke: Stripping dangerous permissions from managed role for ${executor.username}`
                    });
                    console.log(`[AntiNuke] 🔒 Stripped dangerous permissions from managed role "${role.name}" for ${executor.username}`);
                    // Store original permissions for restoration
                    strippedRoles.push({
                        id: role.id,
                        name: role.name,
                        managed: true,
                        permissions: currentPermissions.bitfield?.toString?.() || currentPermissions.bitfield || currentPermissions,
                        type: 'managed'
                    });
                    strippedCount++;
                }
            } catch (err) {
                console.error(`[AntiNuke] Failed to strip permissions from managed role "${role.name}" for ${executor.username}: ${err.message}`);
                failedManagedRoles++;
            }
        }

        // 2. Remove non-managed roles
        if (nonManagedRoles.size > 0) {
            try {
                // Store roles before removal
                nonManagedRoles.forEach(role => {
                    strippedRoles.push({
                        id: role.id,
                        name: role.name,
                        managed: false,
                        permissions: role.permissions.bitfield?.toString?.() || role.permissions.bitfield || role.permissions,
                        type: 'role'
                    });
                });

                await member.roles.remove(nonManagedRoles, 'AntiNuke Emergency Strip');
                console.log(`[AntiNuke] � STRIPPED ${nonManagedRoles.size} non-managed roles from ${executor.username}`);
                strippedCount += nonManagedRoles.size;
            } catch (err) {
                console.error(`[AntiNuke] Failed to strip non-managed roles from ${executor.username} (hierarchy issue?): ${err.message}`);
            }
        }

        // 3. If we couldn't strip ANY managed roles and this is a bot, KICK IT as fallback
        if (failedManagedRoles > 0 && failedManagedRoles === managedRoles.size && executor.bot && member.kickable) {
            try {
                await member.kick('AntiNuke: Compromised bot - failed to strip all managed role permissions');
                console.log(`[AntiNuke] � KICKED bot ${executor.username} (couldn't edit any managed roles)`);
                return { success: true, strippedCount, kickedBot: true };
            } catch (kickErr) {
                console.error(`[AntiNuke] Failed to kick bot ${executor.username}: ${kickErr.message}`);
            }
        }

        // Persist per-user strip snapshot for later restoration
        if (strippedRoles.length > 0) {
            saveUserStrip(guild.id, executor.id, {
                strippedRoles,
                strippedCount,
                failedManagedRoles
            });
        }

        // Success if we stripped at least something
        const success = strippedCount > 0;
        return { success, strippedCount, failedManagedRoles, strippedRoles };

    } catch (err) {
        console.error('[AntiNuke] ❌ Strip failed:', err.message);
        return { success: false, reason: err.message };
    }
}

/**
 * Execute punishment on a user (timeout/kick/ban)
 * 
 * @param {Guild} guild - Discord guild
 * @param {User} executor - The executor user object
 * @param {string} punishType - 'bot' or 'user'
 * @param {Object} config - Guild config
 * @param {GuildMember} [prefetchedMember] - Optional pre-fetched member
 */
async function executePunishment(guild, executor, punishType, config, prefetchedMember = null) {
    try {
        const member = prefetchedMember || await guild.members.fetch(executor.id).catch(() => null);
        if (!member) {
            console.log(`[AntiNuke] ⚠️ Cannot punish ${executor.username}: User left server`);
            return { success: false, reason: 'User left server' };
        }

        const botMember = guild.members.me;

        // Permission checks based on action type
        const action = config.userAction || 'timeout';

        if (action === 'ban' && !botMember?.permissions.has(PermissionFlagsBits.BanMembers)) {
            console.error(`[AntiNuke] Missing BAN_MEMBERS permission`);
            return { success: false, reason: 'Missing BAN_MEMBERS Permission' };
        }

        if (action === 'kick' && !botMember?.permissions.has(PermissionFlagsBits.KickMembers)) {
            console.error(`[AntiNuke] Missing KICK_MEMBERS permission`);
            return { success: false, reason: 'Missing KICK_MEMBERS Permission' };
        }

        if (action === 'timeout' && !botMember?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            console.error(`[AntiNuke] Missing MODERATE_MEMBERS permission`);
            return { success: false, reason: 'Missing MODERATE_MEMBERS Permission' };
        }

        // Hierarchy check
        if (!member.manageable) {
            console.error(`[AntiNuke] Cannot punish ${executor.username}: Role hierarchy issue`);
            return { success: false, reason: 'Role Hierarchy' };
        }

        console.log(`[AntiNuke] Punishing ${executor.username} - Type: ${punishType}, Action: ${action}`);

        let reason;

        if (punishType === 'bot') {
            // Bots get stripped only (already done), no additional punishment
            return { success: true, action: 'strip_all' };

        } else {
            // User punishment (configurable)
            reason = 'AntiNuke: Threshold exceeded';

            if (action === 'ban') {
                await member.ban({ reason });
            } else if (action === 'kick') {
                await member.kick(reason);
            } else if (action === 'timeout') {
                const duration = (config.timeoutMinutes || 30) * 60 * 1000;
                await member.timeout(duration, reason);
            }
        }

        console.log(`[AntiNuke] Punished ${executor.username}: ${action}`);
        return { success: true, action };

    } catch (err) {
        console.error('[AntiNuke] Punishment failed:', err.message);
        return { success: false, reason: err.message };
    }
}

/**
 * Get human-readable action message
 */
function getActionsTakenMessage(type, config) {
    if (type === 'bot') {
        return '• Bot **STRIPPED** of ALL dangerous permissions\n• Managed roles had permissions **EDITED**\n• Non-managed roles **REMOVED**\n• Bot is now harmless';
    }

    const action = (config.userAction || 'timeout').toUpperCase();
    let msg = '';

    if (action === 'TIMEOUT') {
        msg = `• User **TIMED OUT** for ${config.timeoutMinutes || 30} minutes`;
    } else if (action === 'KICK') {
        msg = '• User **KICKED** from server';
    } else if (action === 'BAN') {
        msg = '• User **BANNED** from server';
    }

    return msg + '\n• Dangerous roles **STRIPPED**';
}

/**
 * Restore stripped roles/permissions for a user that AntiNuke previously stripped.
 * Uses JSON-backed userStrip snapshot stored in storage.js
 */
async function restoreUserPermissions(guild, userId) {
    try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            return { success: false, restoredCount: 0, errors: ['User is no longer in the server'] };
        }

        const snapshot = loadUserStrip(guild.id, userId);
        if (!snapshot || !Array.isArray(snapshot.strippedRoles) || snapshot.strippedRoles.length === 0) {
            return { success: false, restoredCount: 0, errors: ['No stored strip data for this user'] };
        }

        let restoredCount = 0;
        const errors = [];

        // Restore non-managed roles by re-adding them
        const rolesToAdd = [];
        for (const roleData of snapshot.strippedRoles.filter(r => !r.managed)) {
            const role = guild.roles.cache.get(roleData.id);
            if (!role) {
                errors.push(`Role @${roleData.name} no longer exists`);
                continue;
            }
            rolesToAdd.push(role);
        }

        if (rolesToAdd.length > 0) {
            try {
                await member.roles.add(rolesToAdd, 'AntiNuke: Restoring stripped roles');
                restoredCount += rolesToAdd.length;
            } catch (err) {
                errors.push(`Failed to restore roles: ${err.message}`);
            }
        }

        // Restore managed role permissions
        for (const roleData of snapshot.strippedRoles.filter(r => r.managed)) {
            const role = guild.roles.cache.get(roleData.id);
            if (!role) {
                errors.push(`Managed role @${roleData.name} no longer exists`);
                continue;
            }

            try {
                // Permissions were stored as string/bitfield; set them back
                await role.setPermissions(BigInt(roleData.permissions), 'AntiNuke: Restoring managed role permissions');
                restoredCount++;
            } catch (err) {
                errors.push(`Failed to restore permissions for @${roleData.name}: ${err.message}`);
            }
        }

        return {
            success: restoredCount > 0,
            restoredCount,
            errors
        };

    } catch (err) {
        console.error('[AntiNuke] Failed to restore user permissions:', err);
        return { success: false, restoredCount: 0, errors: [err.message] };
    }
}

module.exports = {
    stripDangerousRoles,
    executePunishment,
    getActionsTakenMessage,
    DANGEROUS_PERMISSIONS,
    restoreUserPermissions
};
