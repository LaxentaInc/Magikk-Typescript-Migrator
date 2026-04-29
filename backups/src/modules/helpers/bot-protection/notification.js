const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const EMOJIS = require('./emojis');
const { restoreBotPermissions } = require('./permissions');
const logManager = require('../logManager');
const { registerAndPersist } = require('./buttons'); // Persistent Buttons

// ... (logPunishmentFailure and notifyGoodBotPermissionStrip remain unchanged for now)

/**
 * Notify the guild owner about suspicious bot incident
 */
async function notifyOwner(guild, botUser, inviter, suspicionData, actionsTaken) {
    try {
        const owner = await guild.fetchOwner();

        const embed = {
            title: `${EMOJIS.COMPUTER} Potentially Dangerous Bot Alert`,
            description: `Suspicious bot detected and handled in **${guild.name}**`,
            fields: [
                {
                    name: `${EMOJIS.LOADING} Bot Information`,
                    value: [
                        `**Name:** ${botUser.username}`,
                        `**ID:** ${botUser.id}`,
                        `**Age:** ${suspicionData.analysis.botAgeHours} hours`,
                        `**Verified:** ${suspicionData.analysis.isVerified ? 'Yes' : 'No'}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: `${EMOJIS.Q_MARK} Reasons`,
                    value: suspicionData.reasons.join('\n') || 'None specified',
                    inline: true
                },
                {
                    name: `${EMOJIS.KILL} Actions Taken`,
                    value: [
                        actionsTaken.botKicked ? `Bot kicked ${EMOJIS.VERIFIED}` : `${EMOJIS.NO} Bot not kicked`,
                        actionsTaken.botBanned ? `Bot banned ${EMOJIS.VERIFIED}` : `${EMOJIS.NO} Bot not banned`,
                        actionsTaken.userPunished ? `User punished (${actionsTaken.punishmentTypes.join(', ')}) ${EMOJIS.VERIFIED}` : `${EMOJIS.NO} No user punishment`
                    ].join('\n'),
                    inline: false
                }
            ],
            timestamp: new Date(),
            footer: { text: 'Anti-Raid System | Bot Protection Module | /dashboard' }
        };

        if (inviter) {
            const { isTrustedUser } = require('./config');
            const config = require('./index').getConfig(guild.id);

            embed.fields.push({
                name: `${EMOJIS.MARKER} Added By`,
                value: [
                    `**User:** ${inviter.username}`,
                    `**ID:** ${inviter.id}`,
                    `**Trusted:** ${isTrustedUser(inviter, guild, config) ? 'Yes' : 'No'}`
                ].join('\n'),
                inline: false
            });
        }

        const components = [];
        if (actionsTaken.botKicked || actionsTaken.botBanned) {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`whitelist_bot_${botUser.id}`)
                        .setLabel('Whitelist This Bot')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji(EMOJIS.VERIFIED)
                );
            components.push(row);

            // Register persistent button
            await registerAndPersist(guild.id, `whitelist_bot_${botUser.id}`, {
                type: 'whitelist_bot',
                targetId: botUser.id,
                guildId: guild.id
            });
        }

        await owner.send({ embeds: [embed], components });

    } catch (error) {
        console.error(`[bot-protection] ❌ Failed to notify owner:`, error.message);
    }
}

/**
 * Log bot kick to centralized alert channel
 */
async function logBotKick(guild, botUser, inviter, suspicionData, config, actionsTaken) {
    const embed = {
        title: `${EMOJIS.COMPUTER} SUSPICIOUS BOT HANDLED`,
        description: `Bot protection system took action against: **${botUser.username}**`,
        fields: [
            {
                name: `${EMOJIS.LOADING} Bot Details`,
                value: [
                    `**Name:** ${botUser.username}`,
                    `**ID:** ${botUser.id}`,
                    `**Age:** ${Math.round(suspicionData.analysis.botAgeHours)} hours`,
                    `**Verified:** ${suspicionData.analysis.isVerified ? 'Yes' : 'No'}`,
                    `**Avatar:** ${suspicionData.analysis.hasAvatar ? 'Yes' : 'No'}`
                ].join('\n'),
                inline: true
            },
            {
                name: `${EMOJIS.Q_MARK} Suspicion Reasons`,
                value: suspicionData.reasons.join('\n') || 'None',
                inline: true
            },
            {
                name: `${EMOJIS.KILL} Actions Taken`,
                value: [
                    actionsTaken.botKicked ? `Bot kicked ${EMOJIS.VERIFIED}` : '',
                    actionsTaken.botBanned ? `Bot banned ${EMOJIS.VERIFIED}` : '',
                    actionsTaken.userPunished ? `User punished: ${actionsTaken.punishmentTypes.join(', ')} ${EMOJIS.VERIFIED}` : ''
                ].filter(Boolean).join('\n') || 'No actions taken',
                inline: false
            }
        ],
        timestamp: new Date(),
        footer: { text: 'Anti-Raid System | Bot Protection | /dashboard' }
    };

    if (inviter) {
        const { isTrustedUser } = require('./config');
        const trustedStatus = isTrustedUser(inviter, guild, config) ? 'Trusted User' : 'Regular User';

        embed.fields.push({
            name: `${EMOJIS.LOADING} Added By`,
            value: [
                `**User:** ${inviter.username}`,
                `**ID:** ${inviter.id}`,
                `**Status:** ${trustedStatus}`
            ].join('\n'),
            inline: false
        });
    }

    const components = [];
    if (actionsTaken.botKicked || actionsTaken.botBanned) {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`whitelist_bot_${botUser.id}`)
                    .setLabel('Whitelist This Bot')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji(EMOJIS.VERIFIED)
            );
        components.push(row);

        // Register persistent button
        await registerAndPersist(guild.id, `whitelist_bot_${botUser.id}`, {
            type: 'whitelist_bot',
            targetId: botUser.id,
            guildId: guild.id
        });
    }

    // Use LogManager to send to alert channel
    await logManager.logAlert(guild, { embed, components });
    console.log(`[bot-protection] Logged alert to aero-alerts`);

    // Also log to standard aero-logs (generic log)
    await logManager.log(guild, 'BOT_KICKED', {
        target: botUser,
        executor: guild.client.user,
        reason: `Suspicious Bot Detected: ${suspicionData.reasons.join(', ')}`,
        fields: [
            { name: 'Actions', value: Object.keys(actionsTaken).filter(k => actionsTaken[k] === true).join(', '), inline: true },
            { name: 'Inviter', value: inviter ? inviter.username : 'Unknown', inline: true }
        ]
    });
}

/**
 * Log punishment failure with detailed information to server channel AND DM owner
 */
async function logPunishmentFailure(guild, user, member, suspicionData, errorMessage, config) {
    const botMember = guild.members.cache.get(guild.client.user.id);
    const botHighestRole = botMember?.roles.highest;
    const targetHighestRole = member.roles.highest;
    const hasAdminPerm = member.permissions.has('Administrator');

    let solution = '';
    if (errorMessage.includes('HIERARCHY')) {
        solution = `**Solution:** Move the bot's role **@${botHighestRole?.name}** ABOVE **@${targetHighestRole.name}** in Server Settings → Roles. The bot's role must be positioned higher than any user it needs to moderate.`;
    } else if (errorMessage.includes('MANAGE_ROLES')) {
        solution = '**Solution:** Grant the bot the **Manage Roles** permission in Server Settings → Roles.';
    } else if (errorMessage.includes('MODERATE_MEMBERS')) {
        solution = '**Solution:** Grant the bot the **Timeout Members** permission in Server Settings → Roles.';
    } else if (errorMessage.includes('KICK_MEMBERS')) {
        solution = '**Solution:** Grant the bot the **Kick Members** permission in Server Settings → Roles.';
    } else if (errorMessage.includes('BAN_MEMBERS')) {
        solution = '**Solution:** Grant the bot the **Ban Members** permission in Server Settings → Roles.';
    } else {
        solution = `**Solution:** Check bot permissions and role hierarchy. Error: ${errorMessage}`;
    }

    const embed = {
        title: `${EMOJIS.SHIELD} PUNISHMENT FAILED - ACTION REQUIRED`,
        description: `The bot tried to punish **${user.username}** for adding a suspicious bot, but **FAILED** due to insufficient permissions or role hierarchy.`,
        fields: [
            {
                name: `${EMOJIS.NO} Error Details`,
                value: errorMessage,
                inline: false
            },
            {
                name: `${EMOJIS.MARKER} Target User Information`,
                value: [
                    `**User:** ${user.username} (${user.id})`,
                    `**Highest Role:** @${targetHighestRole.name} (position ${targetHighestRole.position})`,
                    `**Has Admin Permission:** ${hasAdminPerm ? `Yes ${EMOJIS.SHIELD}` : 'No'}`
                ].join('\n'),
                inline: true
            },
            {
                name: `${EMOJIS.COMPUTER} Bot Information`,
                value: [
                    `**Bot's Highest Role:** @${botHighestRole?.name} (position ${botHighestRole?.position})`,
                    `**Can Moderate:** ${botHighestRole && botHighestRole.position > targetHighestRole.position ? `Yes ${EMOJIS.VERIFIED}` : `No ${EMOJIS.NO}`}`
                ].join('\n'),
                inline: true
            },
            {
                name: `${EMOJIS.VERIFIED} How to Fix This`,
                value: solution,
                inline: false
            },
            {
                name: `${EMOJIS.COMPUTER} Suspicious Bot Details`,
                value: suspicionData.reasons.join('\n'),
                inline: false
            }
        ],
        timestamp: new Date(),
        footer: { text: 'Bot Protection Module | Fix the issue and try again' }
    };

    // Use LogManager to send to centralized alert channel (aero-alerts)
    await logManager.logAlert(guild, { embed });
    console.log(`[bot-protection] Sent punishment failure alert to aero-alerts`);

    // DM the owner
    try {
        const owner = await guild.fetchOwner();
        await owner.send({
            content: `${EMOJIS.SHIELD} **URGENT: Bot Protection Action Failed in ${guild.name}**`,
            embeds: [embed]
        });
        console.log(`[bot-protection] Sent punishment failure DM to owner`);
    } catch (err) {
        console.error(`[bot-protection] Failed to DM owner about punishment failure:`, err.message);
    }
}

/**
 * Notify owner and trusted users about a GOOD bot that had permissions stripped
 * Includes interactive "Restore Permissions" button
 */
async function notifyGoodBotPermissionStrip(member, inviter, strippedPermissions, botData, config) {
    const guild = member.guild;
    const botUser = member.user;

    // Build the embed (no color for clean look)
    const getEmbed = (restored = false, restorer = null) => {
        const embed = {
            title: `${EMOJIS.SHIELD} BOT PERMISSIONS AUTO-STRIPPED`,
            description: `A bot joined **${guild.name}** and passed security checks, but all permissions were automatically stripped as a precaution.`,
            fields: [
                {
                    name: `${EMOJIS.COMPUTER} Bot Information`,
                    value: [
                        `**Name:** ${botUser.username}`,
                        `**ID:** ${botUser.id}`,
                        `**Age:** ${Math.round(botData.botAgeHours)} hours (${Math.round(botData.botAgeHours / 24)} days)`,
                        `**Verified:** ${botData.isVerified ? `Yes ${EMOJIS.VERIFIED}` : 'No'}`,
                        `**Avatar:** ${botData.hasAvatar ? 'Yes' : 'No'}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: `${EMOJIS.MARKER} Added By`,
                    value: inviter ? [
                        `**User:** ${inviter.username}`,
                        `**ID:** ${inviter.id}`
                    ].join('\n') : 'Unknown',
                    inline: true
                },
                {
                    name: `${EMOJIS.NO} Stripped Roles`,
                    value: strippedPermissions.success && strippedPermissions.roleCount > 0
                        ? strippedPermissions.strippedRoles.map(r => `• @${r.name}`).join('\n')
                        : 'No roles were assigned',
                    inline: false
                },
                {
                    name: `${EMOJIS.VERIFIED} Security Status`,
                    value: [
                        `✓ Bot age check passed`,
                        `✓ ${botData.isVerified ? 'Verified by Discord' : 'Not verified (but acceptable)'}`,
                        `✓ No suspicious indicators detected`
                    ].join('\n'),
                    inline: false
                }
            ],
            timestamp: new Date(),
            footer: { text: 'Anti-Raid System | Bot Protection' }
        };

        if (restored && restorer) {
            embed.fields.push({
                name: `${EMOJIS.VERIFIED} ACTION UPDATE`,
                value: `**Permissions Restored** by ${restorer.username}`,
                inline: false
            });
            embed.color = 0x57F287; // Green for restored
        } else {
            embed.fields.push({
                name: `${EMOJIS.VINYL_RECORD} Next Steps`,
                value: [
                    `If this bot is **intended** and **trusted**, click the button below to restore permissions.`,
                    `Otherwise, kick it or leave it as is.`
                ].join('\n'),
                inline: false
            });
        }

        if (!strippedPermissions.success && strippedPermissions.errorMessage) {
            embed.fields.push({
                name: `${EMOJIS.SHIELD} Error During Permission Strip`,
                value: strippedPermissions.errorMessage,
                inline: false
            });
        }

        return embed;
    };

    // Create Button
    const getComponents = (disabled = false, restoredBy = null) => {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`restore_perms_${botUser.id}`)
                    .setLabel(restoredBy ? `Restored by ${restoredBy.username}` : 'Restore Permissions')
                    .setStyle(restoredBy ? ButtonStyle.Success : ButtonStyle.Primary)
                    .setEmoji(restoredBy ? '<a:wack_1327965151781064715:1332327203106717736>' : '<a:pats_1327965154998095973:1332327251253133383>')
                    .setDisabled(disabled)
            );
        return [row];
    };

    // Track all sent messages to update them later
    const sentMessages = [];

    // Send to owner
    try {
        const owner = await guild.fetchOwner();
        const msg = await owner.send({ embeds: [getEmbed()], components: getComponents() });
        sentMessages.push(msg);
        console.log(`[bot-protection] Sent good bot notification to owner`);
    } catch (err) {
        console.error(`[bot-protection] Failed to DM owner:`, err.message);
    }

    // Send to trusted users
    if (config.trustedUsers && config.trustedUsers.length > 0) {
        for (const userId of config.trustedUsers) {
            try {
                const user = await guild.client.users.fetch(userId);
                const msg = await user.send({ embeds: [getEmbed()], components: getComponents() });
                sentMessages.push(msg);
                console.log(`[bot-protection] Sent good bot notification to trusted user ${user.username}`);
            } catch (err) {
                console.error(`[bot-protection] Failed to DM trusted user ${userId}:`, err.message);
            }
        }
    }

    // Log to centralized alert channel (aero-alerts) AND generic log channel
    if (config.logActions) {
        const alertMsg = await logManager.logAlert(guild, { embed: getEmbed(), components: getComponents() });
        if (alertMsg) {
            sentMessages.push(alertMsg);
            console.log(`[bot-protection] Logged good bot permission strip to aero-alerts`);
        }

        // Also log to standard aero-logs (TEXT LOG)
        await logManager.log(guild, 'ROLES_STRIPPED', {
            target: member.user,
            executor: guild.client.user,
            reason: 'Automated Bot Protection (New Bot Join)',
            fields: [
                { name: 'Bot', value: member.user.username, inline: true },
                { name: 'Inviter', value: inviter ? inviter.username : 'Unknown', inline: true },
                { name: 'Status', value: 'Permissions Stripped', inline: true }
            ]
        });
    }

    // Register Persistent Button with Related Messages for Simultaneous Updates
    if (sentMessages.length > 0) {
        const relatedMessages = sentMessages.map(m => ({
            channelId: m.channel.id,
            messageId: m.id
        }));

        await registerAndPersist(guild.id, `restore_perms_${botUser.id}`, {
            type: 'restore_perms',
            targetId: botUser.id,
            memberId: member.id,
            strippedPermissions, // Persist the stripped roles data!
            guildId: guild.id,
            relatedMessages
        });

        console.log(`[bot-protection] Registered persistent restore button for ${botUser.username} with ${relatedMessages.length} linked messages`);
    }
}

/**
 * Notify the guild owner about suspicious bot incident
 */
async function notifyOwner(guild, botUser, inviter, suspicionData, actionsTaken) {
    try {
        const owner = await guild.fetchOwner();

        const embed = {
            title: `${EMOJIS.COMPUTER} Potentially Dangerous Bot Alert`,
            description: `Suspicious bot detected and handled in **${guild.name}**`,
            fields: [
                {
                    name: `${EMOJIS.LOADING} Bot Information`,
                    value: [
                        `**Name:** ${botUser.username}`,
                        `**ID:** ${botUser.id}`,
                        `**Age:** ${suspicionData.analysis.botAgeHours} hours`,
                        `**Verified:** ${suspicionData.analysis.isVerified ? 'Yes' : 'No'}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: `${EMOJIS.Q_MARK} Reasons`,
                    value: suspicionData.reasons.join('\n') || 'None specified',
                    inline: true
                },
                {
                    name: `${EMOJIS.KILL} Actions Taken`,
                    value: [
                        actionsTaken.botKicked ? `Bot kicked ${EMOJIS.VERIFIED}` : `${EMOJIS.NO} Bot not kicked`,
                        actionsTaken.botBanned ? `Bot banned ${EMOJIS.VERIFIED}` : `${EMOJIS.NO} Bot not banned`,
                        actionsTaken.userPunished ? `User punished (${actionsTaken.punishmentTypes.join(', ')}) ${EMOJIS.VERIFIED}` : `${EMOJIS.NO} No user punishment`
                    ].join('\n'),
                    inline: false
                }
            ],
            timestamp: new Date(),
            footer: { text: 'Anti-Raid System | Bot Protection Module | /dashboard' }
        };

        if (inviter) {
            const { isTrustedUser } = require('./config');
            const config = require('./index').getConfig(guild.id);

            embed.fields.push({
                name: `${EMOJIS.MARKER} Added By`,
                value: [
                    `**User:** ${inviter.username}`,
                    `**ID:** ${inviter.id}`,
                    `**Trusted:** ${isTrustedUser(inviter, guild, config) ? 'Yes' : 'No'}`
                ].join('\n'),
                inline: false
            });
        }

        const components = [];
        if (actionsTaken.botKicked || actionsTaken.botBanned) {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`whitelist_bot_${botUser.id}`)
                        .setLabel('Whitelist This Bot')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji(EMOJIS.VERIFIED)
                );
            components.push(row);
        }

        const msg = await owner.send({ embeds: [embed], components });

        if (components.length > 0) {
            handleWhitelistCollector(msg, guild, botUser);
        }

    } catch (error) {
        console.error(`[bot-protection] ❌ Failed to notify owner:`, error.message);
    }
}

/**
 * Log bot kick to centralized alert channel
 */
async function logBotKick(guild, botUser, inviter, suspicionData, config, actionsTaken) {
    // Guild passed directly, no need to resolve from channel

    const embed = {
        title: `${EMOJIS.COMPUTER} SUSPICIOUS BOT HANDLED`,
        description: `Bot protection system took action against: **${botUser.username}**`,
        fields: [
            {
                name: `${EMOJIS.LOADING} Bot Details`,
                value: [
                    `**Name:** ${botUser.username}`,
                    `**ID:** ${botUser.id}`,
                    `**Age:** ${Math.round(suspicionData.analysis.botAgeHours)} hours`,
                    `**Verified:** ${suspicionData.analysis.isVerified ? 'Yes' : 'No'}`,
                    `**Avatar:** ${suspicionData.analysis.hasAvatar ? 'Yes' : 'No'}`
                ].join('\n'),
                inline: true
            },
            {
                name: `${EMOJIS.Q_MARK} Suspicion Reasons`,
                value: suspicionData.reasons.join('\n') || 'None',
                inline: true
            },
            {
                name: `${EMOJIS.KILL} Actions Taken`,
                value: [
                    actionsTaken.botKicked ? `Bot kicked ${EMOJIS.VERIFIED}` : '',
                    actionsTaken.botBanned ? `Bot banned ${EMOJIS.VERIFIED}` : '',
                    actionsTaken.userPunished ? `User punished: ${actionsTaken.punishmentTypes.join(', ')} ${EMOJIS.VERIFIED}` : ''
                ].filter(Boolean).join('\n') || 'No actions taken',
                inline: false
            }
        ],
        timestamp: new Date(),
        footer: { text: 'Anti-Raid System | Bot Protection | /dashboard' }
    };

    if (inviter) {
        const { isTrustedUser } = require('./config');
        const trustedStatus = isTrustedUser(inviter, guild, config) ? 'Trusted User' : 'Regular User';

        embed.fields.push({
            name: `${EMOJIS.LOADING} Added By`,
            value: [
                `**User:** ${inviter.username}`,
                `**ID:** ${inviter.id}`,
                `**Status:** ${trustedStatus}`
            ].join('\n'),
            inline: false
        });
    }

    const components = [];
    if (actionsTaken.botKicked || actionsTaken.botBanned) {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`whitelist_bot_${botUser.id}`)
                    .setLabel('Whitelist This Bot')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji(EMOJIS.VERIFIED)
            );
        components.push(row);
    }

    // Use LogManager to send to alert channel
    const logManager = require('../logManager');
    const alertMsg = await logManager.logAlert(guild, { embed, components });
    console.log(`[bot-protection] Logged alert to aero-alerts`);

    // Attach interaction collector to the alert message
    if (alertMsg && components.length > 0) {
        handleWhitelistCollector(alertMsg, guild, botUser, true);
    }

    // Also log to standard aero-logs (generic log)
    await logManager.log(guild, 'BOT_KICKED', {
        target: botUser,
        executor: guild.client.user,
        reason: `Suspicious Bot Detected: ${suspicionData.reasons.join(', ')}`,
        fields: [
            { name: 'Actions', value: Object.keys(actionsTaken).filter(k => actionsTaken[k] === true).join(', '), inline: true },
            { name: 'Inviter', value: inviter ? inviter.username : 'Unknown', inline: true }
        ]
    });
}

/**
 * Helper to handle whitelist button interaction
 */
function handleWhitelistCollector(message, guild, botUser, checkPermissions = false) {
    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 8 * 60 * 60 * 1000 // 8 hours
    });

    collector.on('collect', async i => {
        if (i.customId !== `whitelist_bot_${botUser.id}`) return;

        if (checkPermissions) {
            const { isTrustedUser } = require('./config');
            const config = require('./index').getConfig(guild.id);
            const authorized = isTrustedUser(i.user, guild, config);

            if (!authorized) {
                return i.reply({
                    content: `${EMOJIS.NO} You are not authorized to whitelist bots. Only Admins/Trusted Users can do this.`,
                    ephemeral: true
                });
            }
        }

        await i.deferUpdate();

        try {
            const botProtection = require('./index');
            const currentConfig = botProtection.getConfig(guild.id);

            const whitelist = currentConfig.whitlistedBots || [];
            if (!whitelist.includes(botUser.id)) {
                whitelist.push(botUser.id);
                await botProtection.updateConfig(guild.id, { whitlistedBots: whitelist });
            }

            const { EmbedBuilder } = require('discord.js');
            const newEmbed = EmbedBuilder.from(i.message.embeds[0]);
            newEmbed.addFields({
                name: `${EMOJIS.VERIFIED} UPDATE`,
                value: `**Whitelisted by ${i.user.username}**\nYou can now re-invite this bot safely.`
            });
            newEmbed.setColor(0x57F287);

            const newRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('whitelisted_done')
                        .setLabel(`Whitelisted by ${i.user.username}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                        .setEmoji('✅')
                );

            await i.editReply({ embeds: [newEmbed], components: [newRow] });

            await i.followUp({
                content: `${EMOJIS.VERIFIED} **Bot Whitelisted!**\nYou can now re-invite **${botUser.username}** and it will be ignored by bot protection.`,
                ephemeral: true
            });

        } catch (error) {
            console.error('[bot-protection] Failed to whitelist bot:', error);
            await i.followUp({ content: `❌ Failed to whitelist bot: ${error.message}`, ephemeral: true });
        }
    });

    collector.on('end', async () => {
        try {
            // Optional: disable button on timeout
        } catch (e) { }
    });
}

module.exports = {
    logPunishmentFailure,
    notifyGoodBotPermissionStrip,
    notifyOwner,
    logBotKick
};
