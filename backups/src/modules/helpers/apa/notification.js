/**
 * APA (Anti-Permission Abuse) Notifications
 * Owner DMs and channel logging with who/when/why details
 */

const { getPermissionName } = require('./config');
const { getActionsTakenMessage } = require('./punishment');
const { buildOwnerActionRow, buildWhitelistedActionRow, registerAndPersistButtons } = require('./buttons');
const logManager = require('../logManager');

// Track recent owner DMs so we can disable old buttons when a new notification is sent
// Key: `${guildId}-${executorId}` -> [Message, ...]
const ownerDmMessages = new Map();

/**
 * Get human-readable action type title
 */
function getActionTitle(actionType) {
    const titles = {
        'ROLE_CREATE': '<a:marker_1326464173361856524:1342443432240746577> Role Created with Dangerous Permissions',
        'ROLE_UPDATE': '<a:marker_1326464173361856524:1342443432240746577> Dangerous Permissions Added to Role',
        'ROLE_ASSIGN': '<a:marker_1326464173361856524:1342443432240746577> Dangerous Role Assigned by Untrusted User'
    };
    return titles[actionType] || 'APA Triggered';
}

/**
 * Get action description for embeds
 */
function getActionDescription(actionType, role) {
    const descriptions = {
        'ROLE_CREATE': `Created role **${role.name}** with dangerous permissions`,
        'ROLE_UPDATE': `Added dangerous permissions to role **${role.name}**`,
        'ROLE_ASSIGN': `Assigned dangerous role **${role.name}** to a member`
    };
    return descriptions[actionType] || 'Performed dangerous permission action';
}

/**
 * Disable buttons on previous DM messages for this executor
 */
async function disablePreviousButtons(guildId, executorId) {
    const dmKey = `${guildId}-${executorId}`;
    const previousMessages = ownerDmMessages.get(dmKey) || [];

    for (const msg of previousMessages) {
        try {
            if (msg && msg.edit) {
                await msg.edit({ components: [] }).catch(() => { });
            }
        } catch {
            // Ignore failures (deleted/permissions)
        }
    }

    ownerDmMessages.delete(dmKey);
}

/**
 * PREPARE NOTIFICATION PAYLOAD (Shared between DM and Channel)
 * Ensures EXACT syncing of embeds and buttons
 */
async function prepareNotificationPayload(guild, executor, actionType, role, dangerousPerms, results, config) {
    // Need owner ID for button permissions
    const owner = await guild.fetchOwner();
    const ownerId = owner.id;

    const isWhitelisted = config.whitelistedUsers?.includes(executor.id);
    const now = Math.floor(Date.now() / 1000);

    let embed;
    let components = [];
    let buttonMetas = [];

    if (isWhitelisted) {
        // WHITELISTED PAYLOAD
        const { row, unWhitelistId, kickId, banId, stripId } = buildWhitelistedActionRow(executor);

        embed = {
            title: '<:mod:1422451081224392816> Whitelisted User Triggered APA',
            description: [
                `A **whitelisted user** performed an action that would normally trigger APA in **${guild.name}**.`,
                `No automatic punishment was taken because they are whitelisted.`
            ].join('\n\n'),
            color: 0xFFA500, // Orange
            fields: [
                {
                    name: '👤 Who',
                    value: `${executor.username} (<@${executor.id}>)${executor.bot ? ' 🤖' : ''}`,
                    inline: true
                },
                {
                    name: '⏰ When',
                    value: `<t:${now}:R>`,
                    inline: true
                },
                {
                    name: '❓ Why',
                    value: getActionDescription(actionType, role),
                    inline: false
                },
                {
                    name: '<a:computer6:1333357940341735464> Dangerous Permissions',
                    value: dangerousPerms.map(p => `• ${getPermissionName(p)}`).join('\n'),
                    inline: false
                }
            ],
            timestamp: new Date(),
            footer: { text: `APA System | ${guild.name}` }
        };

        components = [row];
        buttonMetas = [
            { customId: unWhitelistId, type: 'unwhitelist', userId: executor.id, guildId: guild.id, ownerId },
            { customId: kickId, type: 'kick', userId: executor.id, guildId: guild.id, ownerId },
            { customId: banId, type: 'ban', userId: executor.id, guildId: guild.id, ownerId },
            { customId: stripId, type: 'strip', userId: executor.id, guildId: guild.id, ownerId }
        ];

    } else {
        // UNTRUSTED PAYLOAD
        const roleNeutralized = results.roleNeutralized || false;
        const { row, whitelistId, restoreUserRolesId, restoreRolePermsId } = buildOwnerActionRow(executor, role.id, roleNeutralized);

        embed = {
            title: getActionTitle(actionType),
            description: `<:mod:1422451081224392816> **${guild.name}** - Untrusted user attempted permission abuse. Action has been taken automatically.\n\nUse /dashboard to configure trusted users/roles.`,
            color: executor.bot ? 0xFF0000 : 0xFF6600, // Red for bots, orange for users
            fields: [
                {
                    name: '<:timeout:1422451090259181568> Violator (Who)',
                    value: [
                        `**<a:loading:1333357988953460807> User:** ${executor.username}${executor.bot ? ' 🤖 (BOT)' : ''}`,
                        `**ID:** ${executor.id}`,
                        `**Mention:** <@${executor.id}>`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '<a:Q__1327982827844927552:1342443037371928627> Affected Role',
                    value: [
                        `**<a:loading:1333357988953460807> Role:** ${role.name}`,
                        `**Mention:** <@&${role.id}>`,
                        `**Position:** ${role.position}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '⏰ When',
                    value: `<t:${now}:F>\n(<t:${now}:R>)`,
                    inline: false
                },
                {
                    name: '<a:computer6:1333357940341735464> Why (Dangerous Permissions)',
                    value: dangerousPerms.map(p => `• ${getPermissionName(p)}`).join('\n'),
                    inline: false
                },
                {
                    name: '<a:wack_1327965151781064715:1332327203106717736> Actions Taken',
                    value: getActionsTakenMessage(results),
                    inline: false
                }
            ],
            timestamp: new Date(),
            footer: { text: `APA System | ${guild.name} | /dashboard to configure` }
        };

        // Add bot warning if applicable
        if (executor.bot) {
            embed.fields.push({
                name: '<a:pats_1327965154998095973:1332327251253133383> CRITICAL WARNING',
                value: '<a:server_markerse_1311202842920488:1342443400636403733> **BOT ACCOUNT DETECTED!** This bot may be compromised or misconfigured. Review its permissions and if it\'s yours - reset the token immediately.',
                inline: false
            });
        }

        components = [row];
        buttonMetas = [
            { customId: whitelistId, type: 'whitelist', userId: executor.id, guildId: guild.id, ownerId },
            { customId: restoreUserRolesId, type: 'restore_user', userId: executor.id, guildId: guild.id, ownerId }
        ];

        if (roleNeutralized) {
            buttonMetas.push({
                customId: restoreRolePermsId,
                type: 'restore_role',
                roleId: role.id,
                guildId: guild.id,
                ownerId
            });
        }
    }

    return { embed, components, buttonMetas, isWhitelisted };
}

/**
 * Unified Notification: Notify Owner + Log to Channel + Persist Buttons
 * Ensures simultaneous button updates across DMs and channels
 */
async function notifyAndLog(guild, executor, actionType, role, dangerousPerms, results, config) {
    try {
        const { embed, components, buttonMetas } = await prepareNotificationPayload(
            guild, executor, actionType, role, dangerousPerms, results, config
        );

        const relatedMessages = [];

        // 1. Notify Owner
        if (config.notifyOwner) {
            try {
                const owner = await guild.fetchOwner();
                if (owner) {
                    await disablePreviousButtons(guild.id, executor.id);
                    const sentMessage = await owner.send({ embeds: [embed], components });
                    if (sentMessage) {
                        relatedMessages.push({ channelId: sentMessage.channel.id, messageId: sentMessage.id });
                        const dmKey = `${guild.id}-${executor.id}`;
                        ownerDmMessages.set(dmKey, [sentMessage]);
                        console.log(`[APA] 📧 Owner notified`);
                    }
                }
            } catch (err) {
                console.error(`[APA] ❌ Failed to notify owner:`, err.message);
            }
        }

        // 2. Log to Centralized Channel
        try {
            const alertMsg = await logManager.logAlert(guild, { embed, components });
            if (alertMsg) {
                relatedMessages.push({ channelId: alertMsg.channel.id, messageId: alertMsg.id });
                console.log(`[APA] Logged alert to aero-alerts channel`);
            }
        } catch (err) {
            console.error(`[APA] Failed to log to channel:`, err.message);
        }

        // 3. Register Buttons with Linked Messages
        if (buttonMetas && buttonMetas.length > 0) {
            const linkedMetas = buttonMetas.map(meta => ({
                ...meta,
                relatedMessages // Attach list of all message locations
            }));
            await registerAndPersistButtons(guild.id, linkedMetas);
            console.log(`[APA] Registered persistent buttons with ${relatedMessages.length} linked messages`);
        }

    } catch (err) {
        console.error(`[APA] NotifyAndLog failed:`, err.message);
    }
}

// Deprecated: kept for compatibility if needed, but notifyAndLog should be used
async function notifyOwner() { console.warn('Deprecated notifyOwner called'); }
async function logToChannel() { console.warn('Deprecated logToChannel called'); }

/**
 * Notify owner about permission failure (bot lacks perms)
 */
async function notifyPermissionFailure(guild, executor, actionType, role, dangerousPerms, permCheck, config) {
    if (!config.notifyOwner || !config.notifyOnPermissionFailure) return;

    try {
        const owner = await guild.fetchOwner();
        if (!owner) return;
        const now = Math.floor(Date.now() / 1000);

        const fields = [
            {
                name: '<:LaxnetaInc:1422449088351178804> CRITICAL SECURITY ALERT',
                value: '**BOT NEEDS necessary permissions and highest role to protect your server!**',
                inline: false
            }
        ];
        // ... (Existing fields logic preserved but shortened for this overwrite) ...
        // Re-implementing fields construction as per original file to preserve detailed error messaging

        if (executor) {
            fields.push({
                name: '👤 Violator',
                value: `${executor.username} (<@${executor.id}>)${executor.bot ? ' 🤖' : ''}`,
                inline: true
            });
        }

        fields.push({
            name: '🎭 Affected Role',
            value: `${role.name} (<@&${role.id}>)\n**Position:** ${role.position}`,
            inline: true
        });

        fields.push({
            name: '⏰ When',
            value: `<t:${now}:R>`,
            inline: true
        });

        fields.push({
            name: '<a:computer6:1333357940341735464> Dangerous Permissions Detected',
            value: dangerousPerms.map(p => `• ${getPermissionName(p)}`).join('\n'),
            inline: false
        });

        if (permCheck.missingPermissions.length > 0) {
            const critical = permCheck.missingPermissions.filter(p => p.critical);
            const optional = permCheck.missingPermissions.filter(p => !p.critical);

            let permText = '';
            if (critical.length > 0) {
                permText += '**CRITICAL (Required):**\n' + critical.map(p => `• ${p.name}`).join('\n');
            }
            if (optional.length > 0) {
                if (critical.length > 0) permText += '\n\n';
                permText += '**OPTIONAL (For Punishment):**\n' + optional.map(p => `• ${p.name}`).join('\n');
            }

            fields.push({
                name: '❌ Missing Bot Permissions',
                value: permText,
                inline: false
            });
        }

        const botMember = guild.members.me;
        if (botMember.roles.highest.position <= role.position) {
            fields.push({
                name: '<a:computer6:1333357940341735464> Role Hierarchy Issue',
                value: `The bot's highest role (position: ${permCheck.rolePosition}) is not high enough to manage this role (position: ${role.position}). Move the bot's role above this role.`,
                inline: false
            });
        }

        fields.push({
            name: '<a:computer6:1333357940341735464> Required Actions',
            value: [
                '1️⃣ Grant the bot the missing permissions listed above',
                '2️⃣ Ensure the bot\'s role is positioned above ALL roles you want to moderate',
                '3️⃣ Manually remove the dangerous permissions from the role',
                '4️⃣ Investigate and punish the violator if necessary'
            ].join('\n'),
            inline: false
        });

        const embed = {
            title: `${getActionTitle(actionType)} - BOT PERMISSION FAILURE`,
            description: '**The bot could not automatically protect your server due to insufficient permissions!**',
            color: 0xFF0000,
            fields,
            timestamp: new Date(),
            footer: { text: `APA System | ${guild.name}` }
        };

        await owner.send({ embeds: [embed] }).catch(err => {
            console.error(`[APA] ❌ Failed to send permission failure DM to owner:`, err.message);
        });

        // Log to centralized alert channel (aero-alerts)
        await logManager.logAlert(guild, { embed });

    } catch (error) {
        console.error(`[APA] ❌ Failed to notify owner of permission failure:`, error.message);
    }
}

/**
 * Notify owner/log channel about ignored action
 */
async function notifyIgnoredAction(guild, executor, actionType, role, dangerousPerms, reason, config) {
    if (!config.notifyOwner) return;

    try {
        const owner = await guild.fetchOwner();
        const now = Math.floor(Date.now() / 1000);

        const embed = {
            title: `<:warning:1422451081224392816> APA Action Ignored`,
            description: `**${guild.name}** - Dangerous permission action detected but **IGNORED** due to: **${reason}**`,
            color: 0x3498DB, // Blue
            fields: [
                {
                    name: '👤 Executor',
                    value: `${executor.username} (<@${executor.id}>)${executor.bot ? ' 🤖' : ''}`,
                    inline: true
                },
                {
                    name: '🎭 Target Role',
                    value: `${role.name} (<@&${role.id}>)`,
                    inline: true
                },
                {
                    name: '⏰ When',
                    value: `<t:${now}:R>`,
                    inline: true
                },
                {
                    name: '❓ Reason Ignored',
                    value: reason,
                    inline: false
                },
                {
                    name: '⚠️ Permissions',
                    value: dangerousPerms.map(p => getPermissionName(p)).join(', '),
                    inline: false
                }
            ],
            timestamp: new Date(),
            footer: { text: `APA System | ${guild.name}` }
        };

        // Notify Owner
        if (owner) {
            await owner.send({ embeds: [embed] }).catch(() => { });
        }

        // Log to alert channel
        await logManager.logAlert(guild, { embed });

    } catch (err) {
        console.error(`[APA] Failed to send ignored notification:`, err.message);
    }
}

module.exports = {
    notifyAndLog, // Replaces notifyOwner + logToChannel
    notifyPermissionFailure,
    getActionTitle,
    getActionDescription,
    disablePreviousButtons,
    notifyIgnoredAction,
    notifyOwner, // Deprecated exports to prevent crashes if consumed elsewhere
    logToChannel
};
