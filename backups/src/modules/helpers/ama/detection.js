/**
 * AMA Detection Logic
 */

const { AuditLogEvent } = require('discord.js');
const { executePunishment } = require('./punishment');
const { notifyAndLog } = require('./notification');
const logManager = require('../logManager');

/**
 * Check if user is trusted (owner or in trusted list)
 */
function isTrustedUser(user, guild, config) {
    // Guild owner is always trusted
    if (user.id === guild.ownerId) return true;

    // Check trusted user IDs
    if (config.trustedUsers.includes(user.id)) return true;

    // Check if user has trusted roles
    const member = guild.members.cache.get(user.id);
    if (member && config.trustedRoles.some(roleId => member.roles.cache.has(roleId))) {
        return true;
    }

    return false;
}

/**
 * Handle moderator actions (kick/ban)
 */
async function handleModeratorAction(guild, actionType, targetUser, context) {
    const { getConfig, trackAction, moduleName } = context;
    const guildId = guild.id;
    const config = getConfig(guildId);

    // Only check module-specific toggle
    if (!config.enabled) {
        if (config.debug) {
            console.log(`[${moduleName}] Skipping - module disabled`);
        }
        return;
    }

    try {
        // Convert string action type to AuditLogEvent
        const auditLogType = actionType === 'MEMBER_KICK'
            ? AuditLogEvent.MemberKick
            : AuditLogEvent.MemberBanAdd;

        // Fetch recent audit log entry for this action
        const auditLogs = await guild.fetchAuditLogs({
            type: auditLogType,
            limit: 10
        });

        // Find the audit log entry for this specific action
        const relevantEntry = auditLogs.entries.find(entry => {
            const targetId = targetUser.id || (targetUser.user && targetUser.user.id);
            return entry.target && entry.target.id === targetId &&
                Date.now() - entry.createdTimestamp < 15000; // Within last 15 seconds
        });

        if (!relevantEntry) {
            if (config.debug) {
                const username = targetUser.username || (targetUser.user && targetUser.user.username) || 'Unknown';
                console.log(`[${moduleName}] No audit log found for ${actionType} on ${username} - likely voluntary leave or Ban (handled separately)`);
            }
            return;
        }

        const executor = relevantEntry.executor;

        // Skip if executor is the system itself (not bots - we want to track bots!)
        if (executor.system) {
            if (config.debug) {
                console.log(`[${moduleName}] Skipping system action`);
            }
            return;
        }

        // Check if executor is trusted and should be bypassed
        if (config.bypassTrusted && isTrustedUser(executor, guild, config)) {
            if (config.debug) {
                console.log(`[${moduleName}] Bypassing trusted user: ${executor.username}`);
            }
            return;
        }

        // Track this action (pass executor to check if bot)
        await trackAction(guildId, executor.id, actionType, targetUser, config, { ...context, executor });

    } catch (error) {
        console.error(`[${moduleName}] ❌ Error handling ${actionType}:`, error.message);
        // console.error('Stack trace:', error.stack);
    }
}

/**
 * Track and analyze moderator actions
 */
/**
 * Track and analyze moderator actions
 */
async function trackAction(guildId, executorId, actionType, targetUser, config, context) {
    const { actionTracking, processingViolations, handleMassActionViolation, moduleName, executor } = context;

    // Determine if this is a bot executor
    const isBot = executor && executor.bot;

    // DEBOUNCE: If user is already being punished/processed, ignore new actions
    const uniqueKey = `${guildId}-${executorId}`;
    if (processingViolations && processingViolations.has(uniqueKey)) {
        if (config.debug) {
            // console.log(`[${moduleName}] Skipping debounce for ${executorId}`);
        }
        return;
    }

    // Initialize tracking for guild if needed
    if (!actionTracking.has(guildId)) {
        actionTracking.set(guildId, new Map());
    }

    const guildTracking = actionTracking.get(guildId);

    // Initialize tracking for user if needed
    if (!guildTracking.has(executorId)) {
        guildTracking.set(executorId, []);
    }

    const userActions = guildTracking.get(executorId);
    const now = Date.now();

    // Extract user info safely
    const targetId = targetUser.id || (targetUser.user && targetUser.user.id);
    const targetUsername = targetUser.username || (targetUser.user && targetUser.user.username) || 'Unknown';

    // Add current action
    userActions.push({
        type: actionType,
        targetId,
        targetUsername,
        timestamp: now
    });

    // Remove actions outside time window
    const timeWindowMs = config.timeWindow * 1000;
    const recentActions = userActions.filter(action => (now - action.timestamp) < timeWindowMs);
    guildTracking.set(executorId, recentActions);

    // Count actions by type
    const kickCount = recentActions.filter(a => a.type === 'MEMBER_KICK').length;
    const banCount = recentActions.filter(a => a.type === 'MEMBER_BAN_ADD').length;

    // Log each kick/ban to centralized log channel
    if (context.getGuildById) {
        const guild = await context.getGuildById(guildId);
        if (guild) {
            const eventTypeLog = actionType === 'MEMBER_KICK' ? 'KICK_TRACKED' : 'BAN_TRACKED';
            logManager.log(guild, eventTypeLog, {
                executor: executor,
                description: `${actionType === 'MEMBER_KICK' ? 'Kick' : 'Ban'} tracked: ${executor?.username || executorId} -> ${targetUsername}`,
                fields: [
                    { name: '🎯 Target', value: `${targetUsername} (${targetId})`, inline: true },
                    { name: '📊 Count', value: `${kickCount} kicks, ${banCount} bans`, inline: true }
                ]
            });
        }
    }

    if (config.debug) {
        const executorType = isBot ? 'BOT' : 'USER';
        console.log(`[${moduleName}] ${executorType} ${executorId} actions in ${config.timeWindow}s: ${kickCount} kicks, ${banCount} bans`);
    }

    // Use bot-specific thresholds if executor is a bot
    const kickThreshold = isBot ? (config.botKickThreshold || 2) : config.kickThreshold;
    const banThreshold = isBot ? (config.botBanThreshold || 2) : config.banThreshold;

    // Check if thresholds exceeded
    const kickThresholdExceeded = kickCount >= kickThreshold;
    const banThresholdExceeded = banCount >= banThreshold;

    if (kickThresholdExceeded || banThresholdExceeded) {
        // Log threshold exceeded to centralized log
        if (context.getGuildById) {
            const guild = await context.getGuildById(guildId);
            if (guild) {
                logManager.log(guild, 'MASS_ACTION_DETECTED', {
                    executor: executor,
                    description: `🚨 MASS ACTION THRESHOLD EXCEEDED - ${isBot ? 'BOT' : 'USER'}`,
                    fields: [
                        { name: '👢 Kicks', value: `${kickCount}/${kickThreshold}`, inline: true },
                        { name: '🔨 Bans', value: `${banCount}/${banThreshold}`, inline: true },
                        { name: '⏰ Window', value: `${config.timeWindow}s`, inline: true }
                    ]
                });
            }
        }

        await handleMassActionViolation(guildId, executorId, {
            kickCount,
            banCount,
            kickThresholdExceeded,
            banThresholdExceeded,
            recentActions,
            targetUser: { id: targetId, username: targetUsername },
            isBot // Pass bot info to violation handler
        }, config);
    }
}

/**
 * Handle mass action violation
 */
async function handleMassActionViolation(guildId, executorId, violationData, config, context) {
    const { getGuildById, actionTracking, processingViolations, moduleName, stripDangerousRoles } = context;

    // DEBOUNCE: Double check lock
    const uniqueKey = `${guildId}-${executorId}`;
    if (processingViolations.has(uniqueKey)) return;

    // LOCK User
    processingViolations.add(uniqueKey);
    // Auto-unlock after 60 seconds (or appropriate cooldown)
    setTimeout(() => processingViolations.delete(uniqueKey), 60000);

    const guild = await getGuildById(guildId);
    if (!guild) return;

    const executor = await guild.members.fetch(executorId).catch(() => null);
    if (!executor) return;

    console.log(`[${moduleName}] 🚨 AMA violation detected in guild ${guildId}`);
    console.log(`[${moduleName}] User: ${executor.user.username} (${executorId})`);
    console.log(`[${moduleName}] Actions: ${violationData.kickCount} kicks, ${violationData.banCount} bans`);

    try {
        // 1. IMMEDIATELY clear tracked actions to prevent race conditions
        const guildTracking = actionTracking.get(guildId);
        if (guildTracking) {
            guildTracking.delete(executorId);
        }

        const actionsPerformed = [];

        // 2. STRIP DANGEROUS ROLES FIRST
        // This prevents "Missing Permissions" when trying to timeout/kick admins
        if (stripDangerousRoles) {
            const stripResult = await stripDangerousRoles(executor, guild);
            if (stripResult.success && stripResult.removedCount > 0) {
                actionsPerformed.push(`Emergency Strip: Removed ${stripResult.removedCount} admin roles`);
            }
        }

        // 3. Execute configured punishments
        for (const action of config.punishmentActions) {
            const result = await executePunishment(executor, guild, action, config);
            if (result.success) {
                actionsPerformed.push(result.action);
            }
        }

        // 4. Notify and Log (Unified)
        await notifyAndLog(guild, executor, violationData, actionsPerformed, config);

    } catch (error) {
        console.error(`[${moduleName}] ❌ Error handling mass action violation:`, error.message);
    }
}

module.exports = {
    isTrustedUser,
    handleModeratorAction,
    trackAction,
    handleMassActionViolation
};
