const { PermissionFlagsBits } = require('discord.js');

/**
 * Default configuration for spam protection
 */
function getDefaultConfig() {
    return {
        enabled: true,

        // Message spam detection
        messageSpamEnabled: true,
        messageCount: 3,              // messages
        messageTimeWindow: 3,         // seconds

        // Link spam detection
        linkSpamEnabled: true,
        linkAction: 'warn',           // 'warn' or 'instant'
        blockAllLinks: false,
        blockedDomains: [
            'discord.gg',
            'grabify.link',
            'iplogger.org',
            'bit.ly',
            'tinyurl.com'
        ],

        // Image/GIF spam
        imageSpamEnabled: false,
        imageCount: 3,
        imageTimeWindow: 5,

        // Webhook spam
        webhookSpamEnabled: true,
        webhookMessageCount: 3,
        webhookTimeWindow: 5,

        // Punishment settings
        punishmentType: 'timeout',    // 'kick', 'ban', 'timeout'
        timeoutDuration: 300,         // seconds (5 min)
        maxStrikes: 3,
        strikeExpiry: 10800,            // seconds (3 hrs)

        // Warning settings
        sendWarningInChannel: true,
        deleteWarningAfter: 3,
        sendWarningDM: true,

        // Whitelist
        trustedUsers: [],
        trustedRoles: [],
        bypassRoles: [],

        // Notifications
        notifyOwner: true,
        logChannelId: null,

        // Misc
        deleteSpamMessages: true,
        batchDeleteDelay: 500,        // ms to wait before batch delete
        punishmentLockTime: 5000,     // ms to lock after punishment
        notificationDebounce: 10000,  // ms between notifications for same user
        debug: false
    };
}

/**
 * Build Sets for fast O(1) trusted user/role lookup
 */
function buildTrustedSets(guildId, config, trustedUsersSets, trustedRolesSets) {
    trustedUsersSets.set(guildId, new Set(config.trustedUsers));
    trustedRolesSets.set(guildId, new Set([
        ...config.trustedRoles,
        ...config.bypassRoles
    ]));
}

/**
 * Check if member has Admin/ManageMessages permissions
 */
function hasAdminPermissions(member) {
    if (!member) return false;
    return member.permissions.has(PermissionFlagsBits.ManageMessages) ||
        member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Check if member is in the whitelist (Sets)
 */
function isWhitelisted(member, guildId, config, trustedUsersSets, trustedRolesSets) {
    if (!member) return false;

    // Check cached Sets (O(1) lookup)
    const trustedUsers = trustedUsersSets.get(guildId);
    if (trustedUsers?.has(member.id)) return true;

    const trustedRoles = trustedRolesSets.get(guildId);
    if (trustedRoles) {
        for (const role of member.roles.cache.keys()) {
            if (trustedRoles.has(role)) return true;
        }
    }

    return false;
}

/**
 * Legacy wrapper (if needed elsewhere)
 */
function isTrustedFast(member, guildId, config, trustedUsersSets, trustedRolesSets) {
    return hasAdminPermissions(member) || isWhitelisted(member, guildId, config, trustedUsersSets, trustedRolesSets);
}

module.exports = {
    getDefaultConfig,
    buildTrustedSets,
    isTrustedFast,
    hasAdminPermissions,
    isWhitelisted
};
