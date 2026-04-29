/**
 * APA (Anti-Permission Abuse) Default Configuration
 */

const { PermissionFlagsBits } = require('discord.js');

const DANGEROUS_PERMISSIONS = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.ManageGuildExpressions
];

const DANGEROUS_PERMISSION_NAMES = [
    'Administrator',
    'ManageGuild',
    'ManageRoles',
    'ManageChannels',
    'BanMembers',
    'KickMembers',
    'ManageWebhooks',
    'ManageGuildExpressions'
];

const defaultConfig = {
    enabled: true,

    // Trusted users/roles (bypass APA completely)
    trustedUsers: [],
    trustedRoles: [],
    // Dynamic whitelist (managed via buttons)
    whitelistedUsers: [],

    // What counts as dangerous
    dangerousPermissions: DANGEROUS_PERMISSION_NAMES,

    // Monitoring toggles
    monitorRoleCreation: true,
    monitorRoleUpdates: true,
    monitorRoleAssignments: true,

    // Punishment configuration
    punishment: 'timeout', // timeout, kick, ban
    timeoutMinutes: 30,
    stripExecutorRoles: true,

    // Bot-specific
    monitorBots: true,

    // Notifications
    notifyOwner: true,
    notifyOnPermissionFailure: true,
    logChannelId: null,

    // Duplicate prevention
    punishmentCooldown: 300, // 5 minutes

    // Audit log settings
    auditLogCacheDuration: 2000, // 2 seconds
    auditLogTimeout: 5000, // Max time to wait for audit logs

    debug: false
};

function getDefaultConfig() {
    return { ...defaultConfig };
}

function getPermissionName(permBigInt) {
    const permMap = {
        [PermissionFlagsBits.Administrator]: 'Administrator',
        [PermissionFlagsBits.ManageGuild]: 'Manage Server',
        [PermissionFlagsBits.ManageRoles]: 'Manage Roles',
        [PermissionFlagsBits.ManageChannels]: 'Manage Channels',
        [PermissionFlagsBits.BanMembers]: 'Ban Members',
        [PermissionFlagsBits.KickMembers]: 'Kick Members',
        [PermissionFlagsBits.ManageWebhooks]: 'Manage Webhooks',
        [PermissionFlagsBits.ManageGuildExpressions]: 'Manage Emojis/Stickers'
    };
    return permMap[permBigInt] || 'Unknown Permission';
}

module.exports = {
    getDefaultConfig,
    defaultConfig,
    DANGEROUS_PERMISSIONS,
    DANGEROUS_PERMISSION_NAMES,
    getPermissionName
};
