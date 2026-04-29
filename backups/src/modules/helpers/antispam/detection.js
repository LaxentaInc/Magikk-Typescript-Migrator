/**
 * Detection functions for various spam types
 */

/**
 * Check for message spam (too many messages in time window)
 */
function checkMessageSpam(userActivity, guildId, userId, config) {
    const activity = getUserActivity(userActivity, guildId, userId);
    const now = Date.now();
    const windowMs = config.messageTimeWindow * 1000;

    const recentMessages = activity.messages.filter(msg =>
        now - msg.timestamp < windowMs
    );

    if (recentMessages.length >= config.messageCount) {
        return {
            count: recentMessages.length,
            timeWindow: config.messageTimeWindow
        };
    }

    return null;
}

/**
 * Check for link spam (fast regex check)
 */
function checkLinkSpamFast(message, config, linkRegex) {
    // Quick test first (doesn't capture groups)
    linkRegex.lastIndex = 0;
    if (!linkRegex.test(message.content)) return null;

    // Extract links only if test passed
    linkRegex.lastIndex = 0;
    const links = [];
    let match;
    while ((match = linkRegex.exec(message.content)) !== null) {
        links.push(match[0]);
        if (links.length > 10) break; // Prevent DoS from massive link spam
    }

    if (links.length === 0) return null;

    // Check if blocking ALL links
    if (config.blockAllLinks) {
        return { links: links.slice(0, 3), reason: 'All links are blocked' };
    }

    // Check against blocked domains (case-insensitive)
    const blockedLinks = [];
    const lowerLinks = links.map(l => l.toLowerCase());

    for (const link of lowerLinks) {
        for (const domain of config.blockedDomains) {
            if (link.includes(domain.toLowerCase())) {
                blockedLinks.push(link);
                break;
            }
        }
        if (blockedLinks.length >= 3) break; // Limit to 3 for display
    }

    if (blockedLinks.length > 0) {
        return { links: blockedLinks, reason: 'Blocked domain detected' };
    }

    return null;
}

/**
 * Check for image spam
 */
function checkImageSpam(message, userActivity, config) {
    const activity = getUserActivity(userActivity, message.guild.id, message.author.id);
    const now = Date.now();
    const windowMs = config.imageTimeWindow * 1000;

    const recentImages = activity.messages.filter(msg =>
        now - msg.timestamp < windowMs && msg.hasImage
    );

    if (recentImages.length >= config.imageCount) {
        return {
            count: recentImages.length,
            timeWindow: config.imageTimeWindow
        };
    }

    return null;
}

/**
 * Check for webhook spam
 */
function checkWebhookSpam(userActivity, guildId, userId, config) {
    const activity = getUserActivity(userActivity, guildId, userId);
    const now = Date.now();
    const windowMs = config.webhookTimeWindow * 1000;

    const recentWebhooks = activity.messages.filter(msg =>
        now - msg.timestamp < windowMs && msg.isWebhook
    );

    if (recentWebhooks.length >= config.webhookMessageCount) {
        return {
            count: recentWebhooks.length,
            timeWindow: config.webhookTimeWindow
        };
    }

    return null;
}

// Helper to get user activity (from tracking module)
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

module.exports = {
    checkMessageSpam,
    checkLinkSpamFast,
    checkImageSpam,
    checkWebhookSpam
};
