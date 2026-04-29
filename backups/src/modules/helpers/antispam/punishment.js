const { PermissionFlagsBits } = require('discord.js');
const { sendPunishmentDM } = require('./notification');

/**
 * Punishment Logic
 */

/**
 * Build punishment reason from violations
 */
function buildPunishmentReason(violations) {
    const reasons = violations.map(v => {
        switch (v.type) {
            case 'message_spam':
                return `Message spam (${v.data.count} in ${v.data.timeWindow}s)`;
            case 'link_spam':
                return `Blocked link posted`;
            case 'image_spam':
                return `Image spam (${v.data.count} in ${v.data.timeWindow}s)`;
            case 'webhook_spam':
                return `Webhook spam (${v.data.count} in ${v.data.timeWindow}s)`;
            case 'manual_warn':
                return `Manual warning by ${v.data.moderator}: ${v.data.reason}`;
            default:
                return 'Spam detected';
        }
    });
    return `AntiSpam: ${reasons.join(', ')}`;
}

/**
 * Execute punishment
 */
async function executePunishment(context, targetMember, violations, config, stats, notifyPunishmentFn) {
    try {
        if (!targetMember) return;

        const botMember = context.guild.members.me;
        if (!botMember) return;

        // Check role hierarchy
        if (botMember.roles.highest.position <= targetMember.roles.highest.position) {
            console.log(`[SpamProtection] Cannot punish ${targetMember.user.username} - role hierarchy`);
            return;
        }

        let punishmentExecuted = false;
        let punishmentType = '';
        let punishmentDetails = '';
        const reason = buildPunishmentReason(violations);

        // Execute punishment
        if (config.punishmentType === 'timeout') {
            if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                console.log('[SpamProtection] Missing timeout permission');
                return;
            }

            // Calculate duration in seconds (handle both formats)
            let durationSeconds = config.timeoutDuration;
            if (!durationSeconds && config.timeoutMinutes) {
                durationSeconds = config.timeoutMinutes * 60;
            }
            if (!durationSeconds) durationSeconds = 300; // Default 5 mins

            try {
                await targetMember.timeout(durationSeconds * 1000, reason);
                punishmentExecuted = true;
                punishmentType = 'Timed Out';
                punishmentDetails = `${durationSeconds / 60} minutes`;
                console.log(`[SpamProtection] ✅ Timed out ${targetMember.user.username} for ${durationSeconds / 60}min`);
            } catch (timeoutErr) {
                console.error(`[SpamProtection] Failed to timeout: ${timeoutErr.message}`);
                return; // Exit execution if timeout fails
            }

        } else if (config.punishmentType === 'kick') {
            if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
                console.log('[SpamProtection] Missing kick permission');
                return;
            }
            await targetMember.kick(reason);
            punishmentExecuted = true;
            punishmentType = 'Kicked';
            punishmentDetails = 'from server';
            console.log(`[SpamProtection] ✅ Kicked ${targetMember.user.username}`);

        } else if (config.punishmentType === 'ban') {
            if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
                console.log('[SpamProtection] Missing ban permission');
                return;
            }
            await targetMember.ban({ reason, deleteMessageSeconds: 86400 });
            punishmentExecuted = true;
            punishmentType = 'Banned';
            punishmentDetails = 'permanently';
            console.log(`[SpamProtection] ✅ Banned ${targetMember.user.username}`);
        }

        if (punishmentExecuted) {
            stats.usersPunished++;

            // Send punishment DM to user
            await sendPunishmentDM(context, targetMember, violations, punishmentType, punishmentDetails, config);

            // Defer notifications to owner/log channel (non-blocking)
            // notifyPunishmentFn is passed as callback to avoid circular dependency loops if we imported notification here?
            // Actually, we imported sendPunishmentDM. We could import notifyPunishment too, but the callback pattern 
            // is already established in index.js to use the 'recentNotifications' map held by index.
            setImmediate(() => {
                notifyPunishmentFn(context, targetMember, violations, config).catch(() => { });
            });
        }

    } catch (err) {
        console.error('[SpamProtection] Punishment failed:', err.message);
    }
}

/**
 * Execute warning timeout (10 seconds)
 */
async function executeWarningTimeout(member, reason) {
    try {
        if (!member.moderatable) return false;
        await member.timeout(10 * 1000, reason);
        return true;
    } catch (error) {
        console.error(`[SpamProtection] Failed to timeout user ${member.user.tag}:`, error.message);
        return false;
    }
}

module.exports = {
    buildPunishmentReason,
    executePunishment,
    executeWarningTimeout
};
