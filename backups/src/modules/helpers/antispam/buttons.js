/**
 * AntiSpam Button Handler
 * Handles persistent buttons for Spam Protection
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registerButton } = require('../../../handlers/buttonHandler');
const { saveButtons, getValidButtons } = require('../GlobalButtonStorage');

const MODULE_NAME = 'antispam';
const LOG_PREFIX = '[AntiSpam Buttons]';

/**
 * Initialize and restore buttons on startup
 */
async function init(client) {
    try {
        const validButtons = getValidButtons(MODULE_NAME);
        let restoredCount = 0;

        for (const meta of validButtons) {
            await registerButton(meta.customId, [], async (interaction) => {
                await handleButtonInteraction(interaction, meta);
            });
            restoredCount++;
        }
        console.log(`${LOG_PREFIX} ✅ Restored ${restoredCount} persistent buttons`);
    } catch (err) {
        console.error(`${LOG_PREFIX} Failed to init buttons:`, err);
    }
}

/**
 * Register a new button and persist it to disk
 */
async function registerAndPersist(guildId, customId, meta) {
    // 1. Register runtime handler
    await registerButton(customId, [], async (interaction) => {
        await handleButtonInteraction(interaction, meta);
    });

    // 2. Persist to JSON
    // Add expiry (24 hours default) if not present
    if (!meta.expiresAt) {
        meta.expiresAt = Date.now() + (24 * 60 * 60 * 1000);
    }

    meta.createdAt = Date.now();
    meta.module = MODULE_NAME;
    meta.guildId = guildId;

    saveButtons(MODULE_NAME, guildId, { [customId]: meta });
}

/**
 * Handle button interaction
 */
async function handleButtonInteraction(interaction, meta) {
    try {
        // lazy load instance
        const antiSpam = require('./index');
        const guildId = meta.guildId || interaction.guildId;

        if (!guildId) {
            return interaction.reply({ content: '❌ Error: Guild context missing.', ephemeral: true });
        }

        const currentConfig = antiSpam.getConfig(guildId);

        // Authorization Check
        // Allow Admins/ManageGuild
        const guild = interaction.guild || await interaction.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            return interaction.reply({ content: '❌ Error: Guild not found.', ephemeral: true });
        }

        const member = interaction.member || await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
            return interaction.reply({ content: '❌ Error: Member not found or not in guild.', ephemeral: true });
        }

        const authorized = member.permissions.has('Administrator') || member.permissions.has('ManageGuild');

        if (!authorized) {
            return interaction.reply({
                content: '⛔ You are not authorized to use this button.',
                ephemeral: true
            });
        }

        if (meta.type === 'whitelist_user') {
            await handleWhitelist(interaction, meta, antiSpam, currentConfig, guild);
        } else if (meta.type === 'unwhitelist_user') {
            await handleUnwhitelist(interaction, meta, antiSpam, currentConfig, guild);
        } else if (meta.type === 'punish_user') {
            await handlePunish(interaction, meta, antiSpam, currentConfig, guild);
        } else if (meta.type === 'remove_punishment') {
            await handleRemovePunishment(interaction, meta, antiSpam, currentConfig, guild);
        } else {
            await interaction.reply({ content: '❓ Unknown button action.', ephemeral: true });
        }

    } catch (err) {
        console.error(`${LOG_PREFIX} Interaction failed:`, err);
        if (!interaction.replied) {
            await interaction.reply({ content: '❌ processing failed.', ephemeral: true });
        }
    }
}

/**
 * Logic for Whitelisting a user
 */
async function handleWhitelist(interaction, meta, antiSpam, currentConfig, guild) {
    const targetId = meta.targetId;

    // 1. Check if already whitelisted
    if (currentConfig.trustedUsers && currentConfig.trustedUsers.includes(targetId)) {
        return interaction.reply({ content: '✅ User is already whitelisted.', ephemeral: true });
    }

    // 2. Update Config
    const newTrusted = [...(currentConfig.trustedUsers || []), targetId];
    await antiSpam.updateConfig(meta.guildId, { trustedUsers: newTrusted });

    // 3. User Feedback
    await interaction.reply({
        content: `✅ **Successfully Whitelisted <@${targetId}>**.\nThey are now exempt from Spam checks.`,
        ephemeral: true
    });

    // 4. Simultaneous Update (Visual)
    const relatedMessages = meta.relatedMessages || [];

    // Include the interaction message itself if not present
    if (!relatedMessages.some(m => m.messageId === interaction.message.id)) {
        relatedMessages.push({
            channelId: interaction.channelId,
            messageId: interaction.message.id
        });
    }

    const { EmbedBuilder } = require('discord.js');
    const updatePromises = relatedMessages.map(async (info) => {
        try {
            // Fetch channel
            let channel = interaction.client.channels.cache.get(info.channelId);
            if (!channel) {
                try {
                    channel = await interaction.client.channels.fetch(info.channelId);
                } catch (e) { return; }
            }

            if (!channel) return;

            const msg = await channel.messages.fetch(info.messageId).catch(() => null);
            if (!msg) return;

            // Updated Components (Disable all)
            const updatedRows = msg.components.map(row => {
                const newRow = new ActionRowBuilder();
                const newButtons = row.components.map(component => {
                    const btn = ButtonBuilder.from(component);
                    btn.setDisabled(true);
                    if (component.customId === interaction.customId) {
                        btn.setLabel('Whitelisted');
                        btn.setStyle(ButtonStyle.Success);
                        btn.setEmoji('✅');
                    }
                    return btn;
                });
                return newRow.addComponents(newButtons);
            });

            // Update Embed (Green + Action Field)
            const newEmbed = EmbedBuilder.from(msg.embeds[0]);
            newEmbed.setColor(0x57F287);

            const alreadyUpdated = newEmbed.data.fields?.some(f => f.name && f.name.includes('ACTION UPDATE'));
            if (!alreadyUpdated) {
                newEmbed.addFields({
                    name: '✅ ACTION UPDATE',
                    value: `**User Whitelisted** by ${interaction.user.username}`,
                    inline: false
                });
            }

            await msg.edit({ embeds: [newEmbed], components: updatedRows });

        } catch (e) {
            console.error(`${LOG_PREFIX} Failed to update related message ${info.messageId}:`, e.message);
        }
    });

    await Promise.all(updatePromises);
}

/**
 * Logic for Unwhitelisting a user
 */
async function handleUnwhitelist(interaction, meta, antiSpam, currentConfig, guild) {
    const targetId = meta.targetId;

    // 1. Check if actually whitelisted
    if (!currentConfig.trustedUsers || !currentConfig.trustedUsers.includes(targetId)) {
        return interaction.reply({ content: '⚠️ User is not whitelisted.', ephemeral: true });
    }

    // 2. Update Config
    const newTrusted = currentConfig.trustedUsers.filter(id => id !== targetId);
    await antiSpam.updateConfig(meta.guildId, { trustedUsers: newTrusted });

    // 3. User Feedback
    await interaction.reply({
        content: `⚠️ **Successfully Unwhitelisted <@${targetId}>**.\nThey are no longer exempt from Spam checks.`,
        ephemeral: true
    });

    // 4. Update Visuals
    await updateRelatedMessages(interaction, meta, 'Unwhitelisted', ButtonStyle.Danger, '⚠️');
}

/**
 * Logic for Punishing a Trusted User (Manual Trigger)
 */
async function handlePunish(interaction, meta, antiSpam, currentConfig, guild) {
    const targetId = meta.targetId;
    // const guild is passed in now, usage below is correct
    const targetMember = await guild.members.fetch(targetId).catch(() => null);

    if (!targetMember) {
        return interaction.reply({ content: '❌ User not found in server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    // Lazy load punishment
    const { executePunishment } = require('./punishment');
    const { notifyPunishment } = require('./notification');
    // We need recentNotifications map from index, but it's not exported directly.
    // However, executePunishment takes a callback for notification.
    // We can use a dummy map or access it via antiSpam instance if exposed?
    // antiSpam is the instance exported from index.js, checking its exports...
    // It exports methods, not properties directly usually unless we access instance (which we have).
    // Let's check index.js export. It exports `instance`. So `antiSpam` IS the instance.
    // So we can access `antiSpam.recentNotifications`.

    // Use violations from meta or default
    const violations = meta.violations || [{ type: 'manual_warn', data: { reason: 'Manual Punishment via Button', moderator: interaction.user.username } }];

    // Dummy stats object if needed, or link to main stats
    const stats = antiSpam.stats || { usersPunished: 0 };

    // Create safe context since interaction.guild might be null 
    // and executePunishment needs context.guild.members.me
    const safeContext = {
        guild: guild,
        channel: interaction.channel || interaction.message.channel,
        client: interaction.client,
        author: interaction.user
    };

    await executePunishment(
        safeContext,
        targetMember,
        violations,
        currentConfig,
        stats,
        (ctx, tm, viols, cfg) => notifyPunishment(ctx, tm, viols, cfg, antiSpam.recentNotifications)
    );

    await interaction.editReply({ content: `**Punishment Command Executed on <@${targetId}>**.` });

    // Update Visuals (Disable buttons)
    await updateRelatedMessages(interaction, meta, 'Punished', ButtonStyle.Danger, '🔨');
}

/**
 * Logic for Removing Punishment
 */
async function handleRemovePunishment(interaction, meta, antiSpam, currentConfig, guild) {
    const targetId = meta.targetId;
    // const guild is passed in now
    const targetMember = await guild.members.fetch(targetId).catch(() => null);

    await interaction.deferReply({ ephemeral: true });

    let actionTaken = '';

    try {
        if (meta.punishmentType === 'timeout') {
            if (targetMember) {
                if (targetMember.isCommunicationDisabled()) {
                    await targetMember.timeout(null, `Punishment removed by ${interaction.user.username}`);
                    actionTaken = 'Timeout Removed';
                } else {
                    actionTaken = 'User was not timed out';
                }
            } else {
                actionTaken = 'User not found';
            }
        } else if (meta.punishmentType === 'ban') {
            await guild.members.unban(targetId, `Punishment removed by ${interaction.user.username}`).catch(() => {
                actionTaken = 'Failed to unban (User might not be banned)';
            });
            if (!actionTaken) actionTaken = 'Unbanned';
        } else if (meta.punishmentType === 'kick') {
            actionTaken = 'Kick cannot be undone';
        } else {
            // Default: try to remove timeout just in case
            if (targetMember && targetMember.isCommunicationDisabled()) {
                await targetMember.timeout(null, `Punishment removed by ${interaction.user.username}`);
                actionTaken = 'Timeout Removed';
            } else {
                actionTaken = 'No active punishment found';
            }
        }
    } catch (err) {
        actionTaken = `Error: ${err.message}`;
    }

    await interaction.editReply({ content: `🛡️ **${actionTaken}** for <@${targetId}>` });

    // Update visuals
    await updateRelatedMessages(interaction, meta, 'Punishment Removed', ButtonStyle.Secondary, '🛡️');
}

/**
 * Helper to update related messages
 */
async function updateRelatedMessages(interaction, meta, label, style, emoji) {
    const relatedMessages = meta.relatedMessages || [];
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require('discord.js');

    // Include current interaction message if not in persistent list
    if (interaction.message && !relatedMessages.some(m => m.messageId === interaction.message.id)) {
        relatedMessages.push({ channelId: interaction.channelId, messageId: interaction.message.id });
    }

    const updatePromises = relatedMessages.map(async (info) => {
        try {
            let channel = interaction.client.channels.cache.get(info.channelId);
            if (!channel) try { channel = await interaction.client.channels.fetch(info.channelId); } catch (e) { return; }
            if (!channel) return;

            const msg = await channel.messages.fetch(info.messageId).catch(() => null);
            if (!msg) return;

            // Updated Components (Disable specific button or all?) -> Disable ALL for safety/clarity
            const updatedRows = msg.components.map(row => {
                const newRow = new ActionRowBuilder();
                const newButtons = row.components.map(component => {
                    const btn = ButtonBuilder.from(component);

                    if (component.customId === interaction.customId) {
                        btn.setDisabled(true);
                        btn.setLabel(label);
                        btn.setStyle(style);
                        if (emoji) btn.setEmoji(emoji);
                    }
                    // Else leave as is (enabled)

                    return btn;
                });
                return newRow.addComponents(newButtons);
            });

            // Update Embed Field
            const newEmbed = EmbedBuilder.from(msg.embeds[0]);
            // Maybe change color?
            // newEmbed.setColor(0x......); 

            const alreadyUpdated = newEmbed.data.fields?.some(f => f.name && f.name.includes('ACTION UPDATE'));
            if (!alreadyUpdated) {
                newEmbed.addFields({
                    name: '✅ ACTION UPDATE',
                    value: `**${label}** by <@${interaction.user.id}>`,
                    inline: false
                });
            }

            await msg.edit({ embeds: [newEmbed], components: updatedRows });
        } catch (e) {
            console.error(`[AntiSpam Buttons] Failed to update message ${info.messageId}:`, e.message);
        }
    });

    await Promise.all(updatePromises);
}

module.exports = {
    init,
    registerAndPersist
};
