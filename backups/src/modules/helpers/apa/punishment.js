/**
 * APA (Anti-Permission Abuse) Punishment
 * User punishment execution (NOT role modification - that's in neutralize.js)
 */

const { PermissionFlagsBits } = require('discord.js');
const { DANGEROUS_PERMISSIONS } = require('./config');
const { saveUserStrip, loadUserStrip, clearUserStrip } = require('./storage');

/**
 * Strip dangerous roles from a member IMMEDIATELY
 * This is the fastest response - do this FIRST
 * 
 * @param {Guild} guild - Discord guild
 * @param {User} executor - The executor user object
 * @param {GuildMember} [prefetchedMember] - Optional pre-fetched member
 */
async function stripDangerousRoles(guild, executor, prefetchedMember = null) {
    try {
        const member = prefetchedMember || await guild.members.fetch(executor.id).catch(() => null);
        if (!member) {
            console.log(`[APA] Cannot strip ${executor.username}: User left server`);
            return { success: false, reason: 'User left server', count: 0 };
        }

        const botMember = guild.members.me;
        if (!botMember) return { success: false, reason: 'Cannot fetch bot', count: 0 };

        // CRITICAL: Check hierarchy BEFORE attempting anything
        if (!member.manageable) {
            console.error(`[APA] Cannot strip ${executor.username}: Role hierarchy issue`);
            return { success: false, reason: 'Role Hierarchy', hierarchyIssue: true, count: 0 };
        }

        // Find all roles with dangerous permissions that we can remove
        const dangerousRoles = member.roles.cache.filter(role =>
            role.id !== guild.id && // Not @everyone
            !role.managed && // Not bot/integration managed
            botMember.roles.highest.position > role.position && // Bot can remove it
            DANGEROUS_PERMISSIONS.some(perm => role.permissions.has(perm))
        );

        if (dangerousRoles.size === 0) {
            return { success: true, count: 0, strippedRoles: [] };
        }

        // Store roles before removal for restoration
        const strippedRoles = dangerousRoles.map(role => ({
            id: role.id,
            name: role.name,
            permissions: role.permissions.bitfield.toString()
        }));

        await member.roles.remove(dangerousRoles, 'APA: Removed dangerous roles from violator');

        console.log(`[APA] ✅ Stripped ${dangerousRoles.size} dangerous roles from ${executor.username}`);

        // Save for restoration via button
        saveUserStrip(guild.id, executor.id, {
            strippedRoles,
            strippedCount: dangerousRoles.size
        });

        return {
            success: true,
            count: dangerousRoles.size,
            strippedRoles
        };

    } catch (err) {
        console.error('[APA] ❌ Strip failed:', err.message);
        return { success: false, reason: err.message, count: 0 };
    }
}

/**
 * Execute punishment on a user (timeout/kick/ban)
 */
async function executePunishment(member, guild, config) {
    try {
        if (!member) {
            return { success: false, reason: 'Member not found' };
        }

        const botMember = guild.members.me;
        const action = config.punishment || 'timeout';

        // Permission checks
        if (action === 'ban' && !botMember?.permissions.has(PermissionFlagsBits.BanMembers)) {
            return { success: false, reason: 'Missing BAN_MEMBERS permission' };
        }
        if (action === 'kick' && !botMember?.permissions.has(PermissionFlagsBits.KickMembers)) {
            return { success: false, reason: 'Missing KICK_MEMBERS permission' };
        }
        if (action === 'timeout' && !botMember?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return { success: false, reason: 'Missing MODERATE_MEMBERS permission' };
        }

        // Hierarchy check
        if (!member.manageable) {
            return { success: false, reason: 'Role hierarchy issue' };
        }

        // Cannot punish server owner
        if (member.id === guild.ownerId) {
            return { success: false, reason: 'Cannot punish server owner' };
        }

        console.log(`[APA] Punishing ${member.user.username} with: ${action}`);

        const reason = 'APA: Permission abuse violation';

        if (action === 'ban') {
            await member.ban({ reason, deleteMessageSeconds: 0 });
            return { success: true, action: 'Banned from server' };
        } else if (action === 'kick') {
            await member.kick(reason);
            return { success: true, action: 'Kicked from server' };
        } else if (action === 'timeout') {
            const duration = (config.timeoutMinutes || 30) * 60 * 1000;
            await member.timeout(duration, reason);
            return { success: true, action: `Timed out for ${config.timeoutMinutes || 30} minutes` };
        }

        return { success: false, reason: `Unknown action: ${action}` };

    } catch (err) {
        console.error('[APA] Punishment failed:', err.message);
        return { success: false, reason: err.message };
    }
}

/**
 * Restore previously stripped roles (button action)
 */
async function restoreUserRoles(guild, userId) {
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
        const rolesToAdd = [];

        for (const roleData of snapshot.strippedRoles) {
            const role = guild.roles.cache.get(roleData.id);
            if (!role) {
                errors.push(`Role @${roleData.name} no longer exists`);
                continue;
            }
            rolesToAdd.push(role);
        }

        if (rolesToAdd.length > 0) {
            try {
                await member.roles.add(rolesToAdd, 'APA: Restoring stripped roles via owner button');
                restoredCount = rolesToAdd.length;
                console.log(`[APA] ✅ Restored ${restoredCount} roles to ${member.user.username}`);
            } catch (err) {
                errors.push(`Failed to restore roles: ${err.message}`);
            }
        }

        // Clear the snapshot after restoration
        if (restoredCount > 0) {
            clearUserStrip(guild.id, userId);
        }

        return {
            success: restoredCount > 0,
            restoredCount,
            errors
        };

    } catch (err) {
        console.error('[APA] Failed to restore user roles:', err);
        return { success: false, restoredCount: 0, errors: [err.message] };
    }
}

/**
 * Get human-readable message about actions taken
 */
function getActionsTakenMessage(results) {
    const lines = [];

    if (results.roleNeutralized) {
        lines.push('• ✅ Role permissions stripped');
    }

    if (results.stripResult?.success && results.stripResult.count > 0) {
        lines.push(`• ✅ Removed ${results.stripResult.count} dangerous role(s) from user`);
    }

    if (results.punishmentResult?.success) {
        lines.push(`• ✅ ${results.punishmentResult.action}`);
    }

    if (results.punishmentResult && !results.punishmentResult.success) {
        lines.push(`• ⚠️ Punishment failed: ${results.punishmentResult.reason}`);
    }

    return lines.length > 0 ? lines.join('\n') : '• No actions taken';
}

module.exports = {
    stripDangerousRoles,
    executePunishment,
    restoreUserRoles,
    getActionsTakenMessage
};
