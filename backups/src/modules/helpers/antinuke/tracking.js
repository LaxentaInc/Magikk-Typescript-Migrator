/**
 * AntiNuke Tracking
 * Track deletions and actions for threshold counting
 */

/**
 * Track a deleted channel for batch restoration
 * THIS IS ALWAYS CALLED FIRST - NEVER SKIP
 */
function trackDeletion(deletedChannels, guildId, target) {
    if (!deletedChannels.has(guildId)) {
        deletedChannels.set(guildId, []);
    }

    deletedChannels.get(guildId).push({
        id: target.id,
        name: target.name,
        type: target.type,
        parentId: target.parentId || null,
        position: target.position,
        timestamp: Date.now()
    });

    console.log(`[AntiNuke] 📝 Tracked channel deletion: ${target.name} (guild: ${guildId})`);
}

/**
 * Track a deleted role for batch restoration
 */
function trackRoleDeletion(deletedRoles, guildId, target) {
    if (!deletedRoles.has(guildId)) {
        deletedRoles.set(guildId, []);
    }

    deletedRoles.get(guildId).push({
        id: target.id,
        name: target.name,
        color: target.color,
        permissions: target.permissions,
        position: target.position,
        hoist: target.hoist,
        mentionable: target.mentionable,
        timestamp: Date.now()
    });

    console.log(`[AntiNuke] 📝 Tracked role deletion: ${target.name} (guild: ${guildId})`);
}

/**
 * Track a user action with timestamp
 */
function trackAction(recentActions, guildId, userId, eventType) {
    if (!recentActions.has(guildId)) {
        recentActions.set(guildId, new Map());
    }

    const guildData = recentActions.get(guildId);
    if (!guildData.has(userId)) {
        guildData.set(userId, []);
    }

    guildData.get(userId).push({
        type: eventType,
        timestamp: Date.now()
    });
}

/**
 * Get count of recent actions by a user (within 30s window)
 */
function getActionCount(recentActions, guildId, userId, eventType = null) {
    const now = Date.now();
    const actions = recentActions.get(guildId)?.get(userId) || [];

    return actions.filter(action => {
        const withinWindow = now - action.timestamp < 30000;
        const matchesType = !eventType || action.type === eventType;
        return withinWindow && matchesType;
    }).length;
}

/**
 * Clear action tracking for a user (after punishment)
 */
function clearUserActions(recentActions, guildId, userId) {
    recentActions.get(guildId)?.delete(userId);
}

/**
 * Clean up old action tracking data (called periodically)
 */
function cleanupOldActions(recentActions) {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [guildId, guildData] of recentActions.entries()) {
        for (const [userId, actions] of guildData.entries()) {
            // Keep only actions from last 5 minutes
            const recent = actions.filter(a => now - a.timestamp < 300000);

            if (recent.length === 0) {
                guildData.delete(userId);
                cleanedCount++;
            } else {
                guildData.set(userId, recent);
            }
        }

        if (guildData.size === 0) {
            recentActions.delete(guildId);
        }
    }

    return cleanedCount;
}

/**
 * Clean up old deletion tracking (called after restore)
 */
function clearDeletions(deletedChannels, guildId) {
    deletedChannels.set(guildId, []);
}

module.exports = {
    trackDeletion,
    trackRoleDeletion,
    trackAction,
    getActionCount,
    clearUserActions,
    cleanupOldActions,
    clearDeletions
};
