/**
 * AMA Default Configuration
 */

const defaultConfig = {
    enabled: true,                    // Module enabled by default

    // BOT thresholds - super strict (bots execute FAST)
    botKickThreshold: 2,              // Bots can kick very fast
    botBanThreshold: 2,               // Bots can ban very fast

    // USER thresholds - more lenient (humans are slow)
    kickThreshold: 3,                 // Max kicks before trigger
    banThreshold: 3,                  // Max bans before trigger

    timeWindow: 120,                   // Time window in seconds (30 seconds for better detection)
    trustedUsers: [],                 // User IDs that bypass detection
    trustedRoles: [],                 // Role IDs that bypass detection
    bypassTrusted: true,              // Whether to bypass trusted users
    punishmentActions: ['remove_roles', 'timeout'], // Array of actions to take
    timeoutDuration: 600,             // Timeout duration in seconds (10 minutes)
    notifyOwner: true,                // DM owner about violations
    logChannelId: null,               // Channel ID for logging
    logActions: true,                 // Log actions to system/log channel
    debug: true                       // Debug logging
};

function getDefaultConfig() {
    return { ...defaultConfig };
}

module.exports = {
    getDefaultConfig,
    defaultConfig
};
