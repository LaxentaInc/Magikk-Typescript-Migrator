/**
 * AntiNuke Notifications
 * Owner DMs and channel logging
 */

const { getActionsTakenMessage } = require('./punishment');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildOwnerActionRow, buildWhitelistedActionRow, registerAndPersistButtons } = require('./buttons');
const logManager = require('../logManager');

// Track recent owner DMs so we can disable old buttons when a new notification is sent
// Key: `${guildId}-${executorId}` -> [Message, ...]
const ownerDmMessages = new Map();

/**
 * Get human-readable action type
 */
function getActionDescription(type, count) {
    const descriptions = {
        'CHANNEL_DELETE': `Deleted ${count} channel(s)`,
        'CHANNEL_CREATE': `Mass created ${count} channel(s)`,
        'ROLE_DELETE': `Deleted ${count} role(s)`,
        'EMOJI_DELETE': `Deleted ${count} emoji(s)`,
        'WEBHOOK_CREATE': `Created ${count} webhook(s)`,
        'WEBHOOK_UPDATE': `Modified ${count} webhook(s)`
    };
    return descriptions[type] || `${count} destructive action(s)`;
}

/**
 * PREPARE NOTIFICATION PAYLOAD (Shared between DM and Channel)
 */
async function prepareAntiNukePayload(guild, executor, type, config, actionCount, actionType, extra) {
    const owner = await guild.fetchOwner();
    const isBot = executor.bot;
    const whitelisted = !!extra?.whitelisted;

    let embed;
    let components = [];
    let buttonMetas = [];

    if (isBot) {
        // ========================================
        // BOT ATTACK - Scary, detailed message
        // ========================================
        const accountAge = Math.floor((Date.now() - executor.createdTimestamp) / (1000 * 60 * 60 * 24));

        embed = {
            title: '<a:computer6:1333357940341735464> **ANTI-NUKE TRIGGERED**',
            description: [
                `**${guild.name}** experienced an automated attack. Last resort emergency response activated.`,
                `We neutralized the threat as fast as technically possible, but some damage occurred before we could respond AS Discord tells us AFTER an event happened.`,
                `This is expected behavior for last-resort protection.`
            ].join(' '),
            fields: [
                {
                    name: '<:timeout:1422451090259181568> **Attacker Information**',
                    value: [
                        `**Bot:** ${executor.username}`,
                        `**ID:** \`${executor.id}\``,
                        `**Mention:** <@${executor.id}>`,
                        `**Account Age:** ${accountAge} days`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '<a:loading_1310498088724729876:1342443735039868989> **Attack Summary**',
                    value: `Compromised bot launched destructive actions (${actionCount} actions detected)`,
                    inline: false
                },
                {
                    name: '<a:check:1422451073825902684> **Actions Taken**',
                    value: getActionsTakenMessage('bot', config),
                    inline: false
                },
                {
                    name: '<a:inf_1310498068126498897:1342443448556458075> **Understanding What Happened**',
                    value: [
                        '**This is a LAST RESORT module.** It only activates when preventive protections fail.',
                        '',
                        '**Why Discord Makes This Hard:**',
                        'Discord processes API requests instantly (0-100ms)',
                        'Events reach us AFTER completion (200-500ms delay)',
                        '**NO bot can intercept requests before Discord processes them**',
                        '',
                        '**How To Actually Prevent This:**',
                        'Go to https://www.laxenta.tech/dashboard and enable **ALL THE MODULES**',
                        'Enable **bot permission stripping** on join',
                        'Use **AMA, APA, BOT-PROT Modules**'
                    ].join('\n'),
                    inline: false
                }
            ],
            timestamp: new Date(),
            footer: {
                text: `Anti-Nuke System (Last Resort)`
            }
        };
        // Bots don't get interaction buttons usually in this module (automated response), 
        // OR we should add them if they were present? Original code had none for bots.

    } else {
        // ========================================
        // USER ACTION - Calm, short message
        // ========================================
        const actionDesc = getActionDescription(actionType, actionCount);

        if (whitelisted) {
            // WHitelisted User
            const { row, unWhitelistId, kickId, banId, stripId } = buildWhitelistedActionRow(executor);

            embed = {
                title: 'Whitelisted User Triggered AntiNuke Threshold',
                description: [
                    `A **whitelisted user** performed actions that would normally trigger AntiNuke in **${guild.name}**.`,
                    `No automatic punishment was taken because they are whitelisted.`
                ].join('\n\n'),
                fields: [
                    {
                        name: 'User',
                        value: `${executor.username} (<@${executor.id}>)`,
                        inline: true
                    },
                    {
                        name: 'What They Did?',
                        value: actionDesc,
                        inline: true
                    }
                ],
                timestamp: new Date(),
                footer: {
                    text: `Anti-Nuke System`
                }
            };

            components = [row];
            buttonMetas = [
                { customId: unWhitelistId, type: 'unwhitelist', userId: executor.id, guildId: guild.id, ownerId: owner.id },
                { customId: kickId, type: 'kick', userId: executor.id, guildId: guild.id, ownerId: owner.id },
                { customId: banId, type: 'ban', userId: executor.id, guildId: guild.id, ownerId: owner.id },
                { customId: stripId, type: 'strip', userId: executor.id, guildId: guild.id, ownerId: owner.id }
            ];

        } else {
            // Untrusted User
            const { row, whitelistId, restoreId } = buildOwnerActionRow(executor);

            embed = {
                title: '<a:check:1422451073825902684> Potential Admin Abuse Action Handled',
                description: [
                    `A user in **${guild.name}** exceeded action thresholds set for raid/nuke preventions.`,
                    `**Everything is under control** - the situation has been handled automatically and restoration has been initiated.`,
                    `If you want this user to not get caught up in these violations, or you want to change the configuration, do /dashboard :D`
                ].join('\n\n'),
                fields: [
                    {
                        name: 'User',
                        value: `${executor.username} (<@${executor.id}>)`,
                        inline: true
                    },
                    {
                        name: 'What They Did?',
                        value: actionDesc,
                        inline: true
                    },
                    {
                        name: 'Our Response',
                        value: getActionsTakenMessage('user', config).replace(/\n/g, ', ').replace(/• /g, ''),
                        inline: false
                    }
                ],
                timestamp: new Date(),
                footer: {
                    text: `Anti-Nuke System`
                }
            };

            components = [row];
            buttonMetas = [
                { customId: whitelistId, type: 'whitelist', userId: executor.id, guildId: guild.id, ownerId: owner.id },
                { customId: restoreId, type: 'restore', userId: executor.id, guildId: guild.id, ownerId: owner.id }
            ];
        }
    }

    return { embed, components, buttonMetas, isBot };
}

/**
 * Notify server owner about an attack
 */
async function notifyOwner(guild, executor, type, config, actionCount, actionType = null, extra = {}) {
    if (!config.notifyOwner) return;

    try {
        const { embed, components, buttonMetas, isBot } = await prepareAntiNukePayload(
            guild, executor, type, config, actionCount, actionType, extra
        );

        // Register handlers (idempotent)
        if (buttonMetas.length > 0) {
            await registerAndPersistButtons(guild.id, buttonMetas);
        }

        // Disable components on any previous DM messages
        const dmKey = `${guild.id}-${executor.id}`;
        const previousMessages = ownerDmMessages.get(dmKey) || [];
        for (const msg of previousMessages) {
            try {
                if (msg && msg.edit) {
                    await msg.edit({ components: [] }).catch(() => { });
                }
            } catch {
                // Ignore failures
            }
        }

        const owner = await guild.fetchOwner();
        const sentMessage = await owner.send({ embeds: [embed], components }).catch(() => null);
        if (sentMessage) {
            ownerDmMessages.set(dmKey, [sentMessage]);
        }

        console.log(`[AntiNuke] Owner notified (${isBot ? 'bot attack' : 'user action'})`);

    } catch (err) {
        console.error(`[AntiNuke] Failed to notify owner:`, err.message);
    }
}

/**
 * Log attack to centralized alert channel (synced with owner embed)
 */
async function logToChannel(guild, executor, type, config, actionCount, actionType = null, extra = {}) {
    try {
        const { embed, components, buttonMetas } = await prepareAntiNukePayload(
            guild, executor, type, config, actionCount, actionType, extra
        );

        // Register handlers (ensures functionality even if notifyOwner is disabled)
        if (buttonMetas.length > 0) {
            await registerAndPersistButtons(guild.id, buttonMetas);
        }

        // Use LogManager to send to alert channel
        await logManager.logAlert(guild, { embed, components });
        console.log(`[AntiNuke] Logged alert to aero-alerts channel with ${components.length > 0 ? 'buttons' : 'no buttons'}`);

    } catch (err) {
        console.error(`[AntiNuke] Failed to log to channel:`, err.message);
    }
}

module.exports = {
    notifyOwner,
    logToChannel,
    getActionDescription
};
