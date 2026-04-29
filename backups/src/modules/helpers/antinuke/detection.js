/**
 * AntiNuke Detection
 * Executor finding, caching, and validation
 */

const { AuditLogEvent } = require('discord.js');

/**
 * Map event type to AuditLogEvent
 */
function getAuditType(eventType) {
    const map = {
        CHANNEL_DELETE: AuditLogEvent.ChannelDelete,
        CHANNEL_CREATE: AuditLogEvent.ChannelCreate,
        ROLE_DELETE: AuditLogEvent.RoleDelete,
        EMOJI_DELETE: AuditLogEvent.EmojiDelete,
        WEBHOOK_CREATE: AuditLogEvent.WebhookCreate,
        WEBHOOK_UPDATE: AuditLogEvent.WebhookUpdate
    };
    return map[eventType];
}

/**
 * Find executor from audit logs with caching and request coalescing
 */
async function findExecutor(guild, eventType, target, context) {
    const auditType = getAuditType(eventType);
    if (!auditType) {
        console.log(`[AntiNuke] No audit type for event: ${eventType}`);
        return null;
    }

    const cacheKey = `${guild.id}-${auditType}`;

    // 1. FAST CACHE CHECK (2s window - increased from 1.5s for better raid detection)
    const cached = context.executorCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 2000)) {
        console.log(`[AntiNuke] Using cached executor: ${cached.executor.username}`);
        return cached.executor;
    }

    // 2. REQUEST COALESCING - wait for in-flight request
    if (context.auditLogRequests.has(cacheKey)) {
        console.log(`[AntiNuke] Waiting for in-flight audit log request...`);
        return await context.auditLogRequests.get(cacheKey);
    }

    // 3. FETCH FROM API
    const fetchPromise = (async () => {
        try {
            const logs = await guild.fetchAuditLogs({ type: auditType, limit: 10 }); // Increased limit

            // During rapid-fire, we might not match exact target ID
            // So we look for ANY recent action of this type
            const entry = logs.entries.find(e => {
                const targetId = target.id || target.user?.id;
                const exactMatch = e.target?.id === targetId;
                const recent = Date.now() - e.createdTimestamp < 10000; // 10 second window

                // For rapid-fire attacks, accept any recent entry if no exact match
                return recent && (exactMatch || !targetId);
            });

            // FALLBACK: If no exact match found, use the most recent entry of this type
            const fallbackEntry = !entry ? logs.entries.first() : null;
            const finalEntry = entry || fallbackEntry;

            if (fallbackEntry && !entry) {
                console.log(`[AntiNuke] Using fallback (most recent) executor for ${eventType}`);
            }

            const executor = finalEntry?.executor;

            if (executor) {
                // Update cache
                context.executorCache.set(cacheKey, {
                    executor,
                    timestamp: Date.now()
                });
                console.log(`[AntiNuke] Found executor: ${executor.username} (${executor.bot ? 'BOT' : 'USER'})`);
            } else {
                console.log(`[AntiNuke] No executor found for ${eventType} (audit log may not have arrived yet)`);
            }

            return executor;

        } catch (err) {
            console.error(`[AntiNuke] Failed to fetch audit logs for ${eventType}:`, err.message);
            return null;
        } finally {
            context.auditLogRequests.delete(cacheKey);
        }
    })();

    context.auditLogRequests.set(cacheKey, fetchPromise);
    return await fetchPromise;
}

/**
 * Check if user is trusted (owner, in trusted list, or has trusted role)
 */
function isTrusted(user, guild, config) {
    if (user.id === guild.ownerId) return true;
    if (config.trustedUsers?.includes(user.id)) return true;
    if (config.whitelistedUsers?.includes(user.id)) return true;

    const member = guild.members.cache.get(user.id);
    return member?.roles.cache.some(r => config.trustedRoles?.includes(r.id)) || false;
}

/**
 * Get threshold for event type (different for bots vs users)
 */
function getThreshold(eventType, config, isBot = false) {
    if (isBot) {
        const botMap = {
            CHANNEL_DELETE: config.botChannelDelete || 2,
            CHANNEL_CREATE: config.botChannelCreate || 3,
            ROLE_DELETE: config.botRoleDelete || 2,
            EMOJI_DELETE: config.botEmojiDelete || 2,
            WEBHOOK_CREATE: config.botWebhookCreate || 2,
            WEBHOOK_UPDATE: config.botWebhookUpdate || 3
        };
        return botMap[eventType] || 2;
    }

    const map = {
        CHANNEL_DELETE: config.channelDelete || 5,
        CHANNEL_CREATE: config.channelCreate || 8,
        ROLE_DELETE: config.roleDelete || 5,
        EMOJI_DELETE: config.emojiDelete || 5,
        WEBHOOK_CREATE: config.webhookCreate || 3,
        WEBHOOK_UPDATE: config.webhookUpdate || 5
    };
    return map[eventType] || 999;
}

/**
 * Check if we can punish this executor (hierarchy check)
 */
async function canPunish(guild, executorId) {
    try {
        const member = await guild.members.fetch(executorId).catch(() => null);
        if (!member) return { can: false, reason: 'User left server' };

        const botMember = guild.members.me;
        if (!botMember) return { can: false, reason: 'Cannot fetch bot member' };

        if (!member.manageable) {
            return { can: false, reason: 'Role hierarchy: Target has higher/equal role than bot' };
        }

        if (member.id === guild.ownerId) {
            return { can: false, reason: 'Cannot punish server owner' };
        }

        return { can: true, member };
    } catch (err) {
        return { can: false, reason: err.message };
    }
}

module.exports = {
    getAuditType,
    findExecutor,
    isTrusted,
    getThreshold,
    canPunish
};
