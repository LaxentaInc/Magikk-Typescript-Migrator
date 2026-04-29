/**
 * APA (Anti-Permission Abuse) Detection
 * Executor finding and trusted user checks
 */

const { AuditLogEvent } = require('discord.js');
const { DANGEROUS_PERMISSIONS } = require('./config');

/**
 * Get audit log type for action
 */
function getAuditLogType(actionType) {
    const mapping = {
        'ROLE_CREATE': AuditLogEvent.RoleCreate,
        'ROLE_UPDATE': AuditLogEvent.RoleUpdate,
        'ROLE_ASSIGN': AuditLogEvent.MemberRoleUpdate
    };
    return mapping[actionType] || null;
}

/**
 * Find who performed the action via audit logs
 */
async function findExecutor(guild, actionType, role, eventData, auditLogTimeout = 5000) {
    try {
        const auditLogType = getAuditLogType(actionType);
        if (!auditLogType) return null;

        const auditLogs = await Promise.race([
            guild.fetchAuditLogs({
                type: auditLogType,
                limit: 5
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), auditLogTimeout)
            )
        ]);

        if (!auditLogs) return null;

        let relevantEntry = null;

        if (actionType === 'ROLE_CREATE' || actionType === 'ROLE_UPDATE') {
            // For role create/update, target is the role
            relevantEntry = auditLogs.entries.find(entry =>
                entry.target && entry.target.id === role.id &&
                Date.now() - entry.createdTimestamp < 10000
            );
        } else if (actionType === 'ROLE_ASSIGN') {
            // For role assignment, target is the member
            relevantEntry = auditLogs.entries.find(entry =>
                entry.target && entry.target.id === eventData.member.id &&
                Date.now() - entry.createdTimestamp < 10000
            );
        }

        return relevantEntry ? relevantEntry.executor : null;

    } catch (error) {
        if (error.message !== 'Timeout') {
            console.error(`[APA] ❌ Error fetching audit logs:`, error.message);
        }
        return null;
    }
}

/**
 * Check if user is owner/trusted/whitelisted
 */
function isTrusted(user, guild, config) {
    // Owner is always trusted
    if (user.id === guild.ownerId) return true;

    // Check trusted users
    if (config.trustedUsers && config.trustedUsers.includes(user.id)) return true;

    // Check whitelisted users (dynamic via buttons)
    if (config.whitelistedUsers && config.whitelistedUsers.includes(user.id)) return true;

    // Check trusted roles
    const member = guild.members.cache.get(user.id);
    if (member && config.trustedRoles) {
        if (config.trustedRoles.some(roleId => member.roles.cache.has(roleId))) {
            return true;
        }
    }

    return false;
}

/**
 * Check if role has any dangerous permissions
 */
function hasDangerousPermissions(role) {
    return DANGEROUS_PERMISSIONS.some(perm => role.permissions.has(perm));
}

/**
 * Get list of dangerous permissions on a role
 */
function getDangerousPermissions(role) {
    return DANGEROUS_PERMISSIONS.filter(perm => role.permissions.has(perm));
}

/**
 * Get permissions that were ADDED between old and new role
 */
function getAddedDangerousPermissions(oldRole, newRole) {
    const oldDangerousPerms = getDangerousPermissions(oldRole);
    const newDangerousPerms = getDangerousPermissions(newRole);

    return newDangerousPerms.filter(perm => !oldDangerousPerms.includes(perm));
}

/**
 * Check if this is a self-assignment (member assigning role to themselves)
 */
function isSelfAssignment(executor, eventData) {
    if (!eventData || !eventData.member) return false;
    return executor.id === eventData.member.id;
}

/**
 * Check if we can punish a member (hierarchy check)
 */
function canPunish(guild, targetMember) {
    const botMember = guild.members.me;
    if (!botMember) return { success: false, reason: 'Cannot fetch bot member' };

    // Cannot punish server owner
    if (targetMember.id === guild.ownerId) {
        return { success: false, reason: 'Cannot punish server owner' };
    }

    // Check role hierarchy
    if (botMember.roles.highest.position <= targetMember.roles.highest.position) {
        return { success: false, reason: 'Target has equal or higher role than bot' };
    }

    return { success: true };
}

/**
 * Validate bot has essential permissions for APA
 */
function validateBotPermissions(guild) {
    const { PermissionFlagsBits } = require('discord.js');
    const botMember = guild.members.me;
    const missingPermissions = [];

    const requiredPerms = [
        { perm: PermissionFlagsBits.ManageRoles, name: 'Manage Roles', critical: true },
        { perm: PermissionFlagsBits.ViewAuditLog, name: 'View Audit Log', critical: true },
        { perm: PermissionFlagsBits.ModerateMembers, name: 'Moderate Members (Timeout)', critical: false },
        { perm: PermissionFlagsBits.KickMembers, name: 'Kick Members', critical: false },
        { perm: PermissionFlagsBits.BanMembers, name: 'Ban Members', critical: false }
    ];

    for (const { perm, name, critical } of requiredPerms) {
        if (!botMember.permissions.has(perm)) {
            missingPermissions.push({ name, critical });
        }
    }

    return {
        hasEssentialPerms: !missingPermissions.some(p => p.critical),
        missingPermissions,
        rolePosition: botMember.roles.highest.position
    };
}

module.exports = {
    getAuditLogType,
    findExecutor,
    isTrusted,
    hasDangerousPermissions,
    getDangerousPermissions,
    getAddedDangerousPermissions,
    isSelfAssignment,
    canPunish,
    validateBotPermissions
};
