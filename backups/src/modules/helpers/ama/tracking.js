/**
 * AMA Tracking & Cleanup
 */

/**
 * Clean up old action tracking data
 */
function cleanupOldActions(actionTracking, getConfig) {
    const now = Date.now();
    let cleanedCount = 0;

    actionTracking.forEach((guildTracking, guildId) => {
        const config = getConfig(guildId);
        const timeWindowMs = config.timeWindow * 1000;

        guildTracking.forEach((userActions, userId) => {
            const recentActions = userActions.filter(action => (now - action.timestamp) < timeWindowMs);

            if (recentActions.length === 0) {
                guildTracking.delete(userId);
                cleanedCount++;
            } else {
                guildTracking.set(userId, recentActions);
            }
        });

        // Remove empty guild tracking
        if (guildTracking.size === 0) {
            actionTracking.delete(guildId);
        }
    });

    if (actionTracking.size > 0 && cleanedCount > 0) {
        console.log(`[mass-action-protection] 🧹 Cleaned up old action tracking. Active guilds: ${actionTracking.size}`);
    }
}

module.exports = {
    cleanupOldActions
};
