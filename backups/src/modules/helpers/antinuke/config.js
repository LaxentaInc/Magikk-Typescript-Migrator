/**
 * AntiNuke Default Configuration
 */

const defaultConfig = {
    enabled: true,

    // BOT thresholds - super strict (bots are FAST)
    botChannelDelete: 2,      // Bots can delete 30 channels/sec
    botChannelCreate: 3,      // Bots spam-create fast
    botRoleDelete: 2,
    botEmojiDelete: 2,
    botWebhookCreate: 2,      // Webhook spam is common raid tactic
    botWebhookUpdate: 3,

    // USER thresholds - more lenient (humans are slow)
    channelDelete: 5,         // Users are slower
    channelCreate: 8,
    emojiDelete: 5,
    roleDelete: 5,
    webhookCreate: 3,
    webhookUpdate: 5,

    // Punishments
    botAction: 'strip',       // bots get stripped FAST (ban is slower)
    userAction: 'timeout',    // timeout, kick, or ban
    timeoutMinutes: 30,

    // Whitelist / Trusted
    trustedUsers: [],
    trustedRoles: [],
    // Dynamic whitelist managed by buttons
    whitelistedUsers: [],
    whitelistedBots: [],

    // Features
    tryRestore: true,
    notifyOwner: true,
    logChannel: null
};

function getDefaultConfig() {
    return { ...defaultConfig };
}

module.exports = {
    getDefaultConfig,
    defaultConfig
};
