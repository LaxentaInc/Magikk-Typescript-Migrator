/**
 * User activity tracking and cleanup functions
 */

/**
 * Get or create user activity record
 */
function getUserActivity(userActivity, guildId, userId) {
    if (!userActivity.has(guildId)) {
        userActivity.set(guildId, new Map());
    }

    const guildData = userActivity.get(guildId);
    if (!guildData.has(userId)) {
        guildData.set(userId, {
            messages: [],
            strikes: 0,
            lastViolation: 0
        });
    }

    return guildData.get(userId);
}

/**
 * Track a message for the user
 */
function trackMessage(userActivity, guildId, userId, message) {
    const activity = getUserActivity(userActivity, guildId, userId);
    const now = Date.now();

    activity.messages.push({
        messageId: message.id,      // Store ID for deletion
        timestamp: now,
        hasImage: message.attachments.size > 0,
        isWebhook: !!message.webhookId,
        channelId: message.channel.id
    });

    // Aggressive cleanup: only keep last 30 seconds worth
    activity.messages = activity.messages.filter(msg =>
        now - msg.timestamp < 30000
    );
}

/**
 * Cleanup old data periodically
 */
function cleanup(userActivity, punishmentLocks, recentNotifications, getConfigFn, stats) {
    const now = Date.now();

    for (const [guildId, guildData] of userActivity.entries()) {
        const config = getConfigFn(guildId);
        const strikeExpiryMs = config.strikeExpiry * 1000;

        for (const [userId, activity] of guildData.entries()) {
            // Reset strikes if expired
            if (activity.strikes > 0 && activity.lastViolation > 0) {
                if (now - activity.lastViolation > strikeExpiryMs) {
                    activity.strikes = 0;
                    activity.lastViolation = 0;
                }
            }

            // Remove if no recent activity
            if (activity.messages.length === 0 && activity.strikes === 0) {
                guildData.delete(userId);
            }
        }

        // Remove empty guilds
        if (guildData.size === 0) {
            userActivity.delete(guildId);
        }
    }

    // Clean expired punishment locks
    for (const [key, timestamp] of punishmentLocks.entries()) {
        if (now - timestamp > 30000) {
            punishmentLocks.delete(key);
        }
    }

    // Clean old notification records
    for (const [key, timestamp] of recentNotifications.entries()) {
        if (now - timestamp > 60000) {
            recentNotifications.delete(key);
        }
    }

    if (stats.messagesProcessed > 0) {
        // console.log(`[SpamProtection] Cleanup: ${userActivity.size} guilds, ${punishmentLocks.size} locks, Stats: ${JSON.stringify(stats)}`);
    }
}

/**
 * Reset user strikes
 */
function resetUserStrikes(userActivity, punishmentLocks, guildId, userId) {
    const activity = getUserActivity(userActivity, guildId, userId);
    activity.strikes = 0;
    activity.lastViolation = 0;

    const lockKey = `${guildId}:${userId}`;
    punishmentLocks.delete(lockKey);

    console.log(`[SpamProtection] Reset strikes for user ${userId}`);
    return true;
}

/**
 * Get user strike info
 */
function getUserStrikes(userActivity, punishmentLocks, guildId, userId) {
    const activity = getUserActivity(userActivity, guildId, userId);
    const lockKey = `${guildId}:${userId}`;

    return {
        strikes: activity.strikes,
        lastViolation: activity.lastViolation,
        recentMessages: activity.messages.length,
        isLocked: punishmentLocks.has(lockKey),
        lockExpires: punishmentLocks.has(lockKey)
            ? new Date(punishmentLocks.get(lockKey) + 5000)
            : null
    };
}

/**
 * Clear cache for all users
 */
function clearCache(userActivity) {
    userActivity.clear();
}

module.exports = {
    getUserActivity,
    trackMessage,
    cleanup,
    resetUserStrikes,
    getUserStrikes,
    clearCache
};
