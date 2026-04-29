const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');
const logManager = require('../logManager');
const { registerAndPersist } = require('./buttons'); // Persistent Buttons

/**
 * Format violations list for embeds
 */
function formatViolationList(violations) {
    return violations.map(v => {
        switch (v.type) {
            case 'message_spam':
                return `<a:computer6:1333357940341735464> Message spam: ${v.data.count} messages in ${v.data.timeWindow}s`;
            case 'link_spam':
                // Redact links: keep domain, mask path
                const safeLinks = (Array.isArray(v.data.links) ? v.data.links : [v.data.links])
                    .map(l => {
                        const clean = l.replace(/(https?:\/\/)?(www\.)?/i, '');
                        const parts = clean.split('/');
                        if (parts.length > 1) {
                            // Keep domain, mask path: discord.gg/jgg*****
                            const domain = parts[0];
                            const path = parts.slice(1).join('/');
                            const maskedPath = path.substring(0, 2) + '****';
                            return `${domain}/${maskedPath}`;
                        }
                        return clean; // Just domain
                    })
                    .join(', ');
                return `<a:computer6:1333357940341735464> Link: \`${safeLinks}\``;
            case 'image_spam':
                return `<a:computer6:1333357940341735464> Image spam: ${v.data.count} images in ${v.data.timeWindow}s`;
            case 'webhook_spam':
                return `<a:computer6:1333357940341735464> Webhook spam: ${v.data.count} messages in ${v.data.timeWindow}s`;
            case 'manual_warn':
                return `<a:computer6:1333357940341735464> Manual warning by ${v.data.moderator}: ${v.data.reason}`;
            default:
                return `<a:computer6:1333357940341735464> Spam detected`;
        }
    }).join('\n');
}

/**
 * Send warning messages
 */
async function sendWarnings(context, targetMember, violations, strikes, config) {
    const violationText = violations.map(v => {
        switch (v.type) {
            case 'message_spam':
                return `Sending messages too fast (${v.data.count} in ${v.data.timeWindow}s)`;
            case 'link_spam':
                return `Posting blocked links: ${v.data.links.slice(0, 2).join(', ')}`;
            case 'image_spam':
                return `Posting images too fast (${v.data.count} in ${v.data.timeWindow}s)`;
            case 'webhook_spam':
                return `Webhook spam detected (${v.data.count} in ${v.data.timeWindow}s)`;
            case 'manual_warn':
                return `Manually warned by **${v.data.moderator}**: ${v.data.reason}`;
            default:
                return 'Spam detected';
        }
    }).join('\n');

    // Calculate strike expiry time
    const strikeExpiryMs = config.strikeExpiry * 1000;
    const expiryTime = Math.floor((Date.now() + strikeExpiryMs) / 1000); // Discord timestamp

    const punishmentInfo = config.punishmentType === 'timeout'
        ? `timed out for ${config.timeoutDuration / 60} minutes`
        : config.punishmentType === 'kick'
            ? 'kicked from the server'
            : 'banned from the server';

    // Send warning in channel (auto-delete)
    if (config.sendWarningInChannel) {
        try {
            const warningEmbed = {
                description: `<:helppppp:1437818267489013960> **Warning ${strikes}/${config.maxStrikes}**\n**Reason:** ${violationText}\n${strikes >= config.maxStrikes ? `**Next violation will result in ${punishmentInfo}!**` : `**Action:** You have been timed out for 10 seconds.`}`,
            };

            const channelWarning = await context.channel.send({
                content: `<@${targetMember.id}>`,
                embeds: [warningEmbed]
            });

            if (channelWarning && config.deleteWarningAfter > 0) {
                setTimeout(() => {
                    channelWarning.delete().catch(() => { });
                }, config.deleteWarningAfter * 2000);
            }
        } catch (err) {
            // Channel might be deleted or bot lacks permissions
        }
    }

    // Send enhanced DM warning
    if (config.sendWarningDM) {
        targetMember.send({
            embeds: [{
                title: '<:helppppp:1437818267489013960> Violation Strike',
                description: `You've been warned for a violation in **${context.guild.name}**\n\n**Strike:** ${strikes}/${config.maxStrikes}\n**Reason:** ${violationText}\n\n${strikes >= config.maxStrikes ? `<a:cute_1267064546586005686:1342444020726501407> **Next violation will result in being ${punishmentInfo}!**` : `You have been timed out for 10 seconds.\nPlease slow down. ${config.maxStrikes - strikes} warning(s) remaining before you are ${punishmentInfo}.`}\n\n-# Strikes expire <t:${expiryTime}:R> • Resets in ${config.strikeExpiry / 60} minutes`,
                timestamp: new Date(),
                footer: {
                    text: `Strike ${strikes}/${config.maxStrikes} • Expires in ${config.strikeExpiry / 60}min`
                }
            }]
        }).catch(() => {
            // User has DMs disabled
        });
    }
}

/**
 * Send punishment notification DM to the user
 */
async function sendPunishmentDM(context, targetMember, violations, punishmentType, punishmentDetails, config) {
    try {
        const violationList = formatViolationList(violations); // Use helper

        const embed = {
            title: '<:helppppp:1437818267489013960> Antispam Violation',
            description: `<:pout_1266746515377094689:1342443781353508905> You have been **${punishmentType.toLowerCase()}** from **${context.guild.name}** for spam violations.\n\n**Action:** ${punishmentType} ${punishmentDetails ? `(${punishmentDetails})` : ''}\n**Reason:**\n${violationList}\n\n-# Thy exceeded the maximum striketh limith (${config.maxStrikes}/${config.maxStrikes})`,
            timestamp: new Date(),
            footer: {
                text: `${context.guild.name} • AntiSpam`,
                icon_url: context.guild.iconURL()
            }
        };

        await targetMember.send({ embeds: [embed] }).catch(() => {
            // User has DMs disabled
        });
    } catch (err) {
        // Silently fail if user has DMs disabled or left server
    }
}

/**
 * Helper: Create whitelist button components
 */
function createComponents(targetMember) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`whitelist_spam_user_${targetMember.id}`)
                .setLabel('Whitelist This User')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<a:st:1461771374799622183>'),
            new ButtonBuilder()
                .setCustomId(`remove_punishment_${targetMember.id}`)
                .setLabel('Remove Punishment')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🛡️')
        );
    return [row];
}

/**
 * Helper: Create buttons for trusted user spam
 */
function createTrustedComponents(targetMember) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`unwhitelist_spam_user_${targetMember.id}`)
                .setLabel('Unwhitelist User')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`punish_spam_user_${targetMember.id}`)
                .setLabel('Punish User')
                .setStyle(ButtonStyle.Danger),
        );
    return [row];
}

/**
 * Notify about punishment (Log Channel/Owner)
 */
async function notifyPunishment(context, targetMember, violations, config, recentNotifications) {
    const notifKey = `${context.guild.id}:${targetMember.id}`;

    // Check if we recently notified about this user
    const lastNotif = recentNotifications.get(notifKey);
    if (lastNotif && Date.now() - lastNotif < config.notificationDebounce) {
        if (config.debug) {
            console.log(`[SpamProtection] Skipping duplicate notification for ${targetMember.user.username}`);
        }
        return;
    }

    recentNotifications.set(notifKey, Date.now());

    try {
        const violationList = formatViolationList(violations);
        const punishmentType = config.punishmentType.charAt(0).toUpperCase() + config.punishmentType.slice(1);

        // Common Embed Payload
        const embed = {
            title: '<a:verified:1342443653825826846> AntiSpam Action Taken',
            fields: [
                {
                    name: 'User',
                    value: `${targetMember.user.tag} (${targetMember.id})`,
                    inline: true
                },
                {
                    name: 'Action',
                    value: punishmentType,
                    inline: true
                },
                {
                    name: 'Channel',
                    value: `<#${context.channel.id}>`,
                    inline: true
                },
                {
                    name: 'Violations',
                    value: violationList,
                    inline: false
                }
            ],
            timestamp: new Date()
        };

        const components = createComponents(targetMember);
        const customId = `whitelist_spam_user_${targetMember.id}`;
        const relatedMessages = [];

        // 1. Log to Centralized Channel
        try {
            const alertMsg = await logManager.logAlert(context.guild, { embed, components });
            if (alertMsg) {
                relatedMessages.push({ channelId: alertMsg.channel.id, messageId: alertMsg.id });
                console.log(`[SpamProtection] Logged punishment alert to aero-alerts`);
            }
        } catch (e) { }

        // 2. Notify Owner
        if (config.notifyOwner) {
            try {
                const owner = await context.guild.fetchOwner();
                if (owner) {
                    const sentMsg = await owner.send({ embeds: [embed], components });
                    if (sentMsg) {
                        relatedMessages.push({ channelId: sentMsg.channel.id, messageId: sentMsg.id });
                    }
                }
            } catch (e) { }
        }

        // 3. Register Persistent Button
        if (relatedMessages.length > 0) {
            await registerAndPersist(context.guild.id, customId, {
                type: 'whitelist_user',
                targetId: targetMember.id,
                guildId: context.guild.id,
                relatedMessages
            });
            // Also register remove punishment button
            await registerAndPersist(context.guild.id, `remove_punishment_${targetMember.id}`, {
                type: 'remove_punishment',
                targetId: targetMember.id,
                guildId: context.guild.id,
                punishmentType: config.punishmentType,
                relatedMessages
            });
            console.log(`[SpamProtection] Registered persistent buttons for ${targetMember.user.username}`);
        }


    } catch (err) {
        console.error('[SpamProtection] Failed to send notification:', err.message);
    }
}

module.exports = {
    sendWarnings,
    sendPunishmentDM,
    notifyPunishment,
    notifyTrustedSpam
};

/**
 * Notify about Trusted User Spam (Log Channel/Owner)
 * No DM to user, different buttons
 */
async function notifyTrustedSpam(context, targetMember, violations, config, recentNotifications) {
    const notifKey = `${context.guild.id}:${targetMember.id}:trusted`;

    // Check if we recently notified about this user
    const lastNotif = recentNotifications.get(notifKey);
    if (lastNotif && Date.now() - lastNotif < config.notificationDebounce) {
        if (config.debug) {
            console.log(`[SpamProtection] Skipping duplicate trusted notification for ${targetMember.user.username}`);
        }
        return;
    }

    recentNotifications.set(notifKey, Date.now());

    try {
        const violationList = formatViolationList(violations);

        // Warning Embed Payload
        const embed = {
            title: '<a:computer6:1333357940341735464> Whitelister User Spam Detected',
            color: 0xFEE75C, // Yellow
            fields: [
                {
                    name: 'User',
                    value: `${targetMember.user.tag} (${targetMember.id})`,
                    inline: true
                },
                {
                    name: 'Status',
                    value: 'Whitelisted (No Action Taken)',
                    inline: true
                },
                {
                    name: 'Channel',
                    value: `<#${context.channel.id}>`,
                    inline: true
                },
                {
                    name: 'Violations',
                    value: violationList,
                    inline: false
                }
            ],
            timestamp: new Date()
        };

        const components = createTrustedComponents(targetMember);
        const relatedMessages = [];

        // 1. Log to Centralized Channel
        try {
            const alertMsg = await logManager.logAlert(context.guild, { embed, components });
            if (alertMsg) {
                relatedMessages.push({ channelId: alertMsg.channel.id, messageId: alertMsg.id });
                console.log(`[SpamProtection] Logged trusted spam alert to aero-alerts`);
            }
        } catch (e) { }

        // 2. Notify Owner
        if (config.notifyOwner) {
            try {
                const owner = await context.guild.fetchOwner();
                if (owner) {
                    const sentMsg = await owner.send({ embeds: [embed], components });
                    if (sentMsg) {
                        relatedMessages.push({ channelId: sentMsg.channel.id, messageId: sentMsg.id });
                    }
                }
            } catch (e) { }
        }

        // 3. Register Persistent Buttons
        if (relatedMessages.length > 0) {
            // Unwhitelist button
            await registerAndPersist(context.guild.id, `unwhitelist_spam_user_${targetMember.id}`, {
                type: 'unwhitelist_user',
                targetId: targetMember.id,
                guildId: context.guild.id,
                relatedMessages
            });
            // Punish button
            await registerAndPersist(context.guild.id, `punish_spam_user_${targetMember.id}`, {
                type: 'punish_user',
                targetId: targetMember.id,
                guildId: context.guild.id,
                violations, // Saving violations to use if punish is clicked
                relatedMessages
            });
            console.log(`[SpamProtection] Registered persistent buttons for trusted user ${targetMember.user.username}`);
        }

    } catch (err) {
        console.error('[SpamProtection] Failed to send trusted notification:', err.message);
    }
}
