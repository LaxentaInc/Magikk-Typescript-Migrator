/**
 * AntiNuke Button Helpers
 * Persistent whitelist / restore buttons for owner & trusted users.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registerButton } = require('../../../handlers/buttonHandler');
const { saveButtons, loadButtons } = require('./storage');
const { restoreUserPermissions } = require('./punishment');
const { isTrusted } = require('./detection');

// Lazy getter to avoid circular dependency (buttons -> AntiNuke -> index -> notification -> buttons)
function getAntiNukeInstance() {
    return require('../../AntiNuke');
}

// 8 hours in ms (kept here for clarity even though expiry is enforced in buttonHandler)
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

/**
 * Register all stored AntiNuke buttons on startup so they survive restarts.
 */
async function registerStoredButtons(client) {
    try {
        const { loadAllButtons } = require('./storage');
        const all = loadAllButtons();

        for (const [guildId, buttons] of all.entries()) {
            for (const [customId, meta] of Object.entries(buttons)) {
                // Skip expired buttons
                if (meta.expiresAt && meta.expiresAt < Date.now()) continue;

                // Ensure guildId is always present on restored metadata
                const fullMeta = {
                    ...meta,
                    guildId
                };

                await registerButton(customId, [], async (interaction) => {
                    await handleButtonAction(interaction, fullMeta);
                });
            }
        }
    } catch (err) {
        console.error('[AntiNuke] Failed to register stored buttons:', err);
    }
}

/**
 * Build the main owner action buttons for AntiNuke user notifications.
 */
function buildOwnerActionRow(executor) {
    const userId = executor.id;

    const whitelistId = `antinuke_whitelist_${userId}`;
    const restoreId = `antinuke_restore_${userId}`;

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(whitelistId)
                .setLabel('Whitelist User')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(restoreId)
                .setLabel('Restore Permissions')
                .setStyle(ButtonStyle.Primary)
        );

    return { row, whitelistId, restoreId };
}

/**
 * Build compact action row used when a whitelisted user triggers AntiNuke thresholds.
 * Includes unwhitelist and manual punishment controls.
 */
function buildWhitelistedActionRow(executor) {
    const userId = executor.id;

    const unWhitelistId = `antinuke_unwhitelist_${userId}`;
    const kickId = `antinuke_kick_${userId}`;
    const banId = `antinuke_ban_${userId}`;
    const stripId = `antinuke_strip_${userId}`;

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(unWhitelistId)
                .setLabel('Unwhitelist')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(stripId)
                .setLabel('Strip Roles')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(kickId)
                .setLabel('Kick')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(banId)
                .setLabel('Ban')
                .setStyle(ButtonStyle.Danger)
        );

    return {
        row,
        unWhitelistId,
        kickId,
        banId,
        stripId
    };
}

/**
 * Persist a set of buttons for a guild.
 */
function persistButtons(guildId, buttonMetas) {
    const existing = loadButtons(guildId);
    const now = Date.now();

    const merged = {
        ...existing
    };

    for (const { customId, type, userId, guildId: metaGuildId, ownerId } of buttonMetas) {
        merged[customId] = {
            type,
            userId,
            guildId: metaGuildId || guildId,
            ownerId: ownerId || null,
            createdAt: now,
            expiresAt: now + EIGHT_HOURS
        };
    }

    saveButtons(guildId, merged);
}

/**
 * Register handlers for a set of buttons AND persist them to JSON.
 * This ensures buttons are clickable immediately and also survive restarts.
 */
async function registerAndPersistButtons(guildId, buttonMetas) {
    // Register handlers in memory / Mongo-backed button system
    for (const meta of buttonMetas) {
        const { customId } = meta;
        await registerButton(customId, [], async (interaction) => {
            await handleButtonAction(interaction, meta);
        });
    }

    // Persist metadata for restart recovery
    persistButtons(guildId, buttonMetas);
}

/**
 * Shared handler for AntiNuke buttons.
 */
async function handleButtonAction(interaction, meta) {
    if (!meta) return;

    const client = interaction.client;
    const metaGuildId = meta.guildId;

    // Resolve guild: from interaction when in a guild, or from stored guildId when in DMs
    const guild = interaction.guild || (metaGuildId ? client.guilds.cache.get(metaGuildId) : null);
    if (!guild) {
        console.error('[AntiNuke] Button action without guild context; meta:', meta);
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({
                content: 'Unable to resolve server context for this AntiNuke button. It may be expired.',
                ephemeral: true
            }).catch(() => { });
        }
        return;
    }

    const targetUserId = meta.userId;

    const targetUser = await guild.client.users.fetch(targetUserId).catch(() => null);
    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);

    if (!targetUser) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'The target user is no longer available.',
                ephemeral: true
            }).catch(() => { });
        }
        return;
    }

    // Lazy load AntiNuke instance to avoid circular dependency
    const antiNuke = getAntiNukeInstance();
    const guildId = guild.id;
    const currentConfig = antiNuke.getConfig(guildId);

    const actionType = meta.type;

    // Resolve executor member (owner / trusted user) even in DMs
    let executorMember = interaction.member || guild.members.cache.get(interaction.user.id);
    if (!executorMember) {
        executorMember = await guild.members.fetch(interaction.user.id).catch(() => null);
    }

    // Only owner or trusted users (as per AntiNuke config) can use these controls.
    const isOwner = interaction.user.id === guild.ownerId || (meta.ownerId && interaction.user.id === meta.ownerId);
    if (!executorMember && !isOwner) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'You are not allowed to use AntiNuke owner controls.',
                ephemeral: true
            }).catch(() => { });
        }
        return;
    }

    if (executorMember && !isOwner && !isTrusted(interaction.user, guild, currentConfig)) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'You are not allowed to use AntiNuke owner controls.',
                ephemeral: true
            }).catch(() => { });
        }
        return;
    }

    try {


        if (actionType === 'whitelist') {
            const list = Array.isArray(currentConfig.whitelistedUsers) ? currentConfig.whitelistedUsers : [];
            if (!list.includes(targetUserId)) {
                list.push(targetUserId);
            }
            const newConfig = { ...currentConfig, whitelistedUsers: list };
            await antiNuke.updateConfig(guildId, newConfig);

            await interaction.reply({
                content: `✅ **${targetUser.tag || targetUser.username}** has been whitelisted for AntiNuke.`,
                ephemeral: true
            }).catch(() => { });
        } else if (actionType === 'unwhitelist') {
            const list = Array.isArray(currentConfig.whitelistedUsers) ? currentConfig.whitelistedUsers : [];
            const filtered = list.filter(id => id !== targetUserId);
            const newConfig = { ...currentConfig, whitelistedUsers: filtered };
            await antiNuke.updateConfig(guildId, newConfig);

            await interaction.reply({
                content: `✅ **${targetUser.tag || targetUser.username}** has been removed from the AntiNuke whitelist.`,
                ephemeral: true
            }).catch(() => { });
        } else if (actionType === 'restore') {
            const result = await restoreUserPermissions(guild, targetUserId);
            if (result.success) {
                await interaction.reply({
                    content: `✅ Restored **${result.restoredCount}** role/permission changes for ${targetUser.tag || targetUser.username}.`,
                    ephemeral: true
                }).catch(() => { });
            } else {
                await interaction.reply({
                    content: `⚠️ Could not restore permissions for ${targetUser.tag || targetUser.username}: ${result.errors?.join('\n') || 'Unknown reason'}`,
                    ephemeral: true
                }).catch(() => { });
            }
        } else if (actionType === 'kick' && targetMember) {
            await targetMember.kick('AntiNuke owner action (kick via button)');
            await interaction.reply({
                content: `👢 Kicked **${targetUser.tag || targetUser.username}** from the server.`,
                ephemeral: true
            }).catch(() => { });
        } else if (actionType === 'ban' && targetMember) {
            await targetMember.ban({ reason: 'AntiNuke owner action (ban via button)' });
            await interaction.reply({
                content: `🔨 Banned **${targetUser.tag || targetUser.username}** from the server.`,
                ephemeral: true
            }).catch(() => { });
        } else if (actionType === 'strip' && targetMember) {
            const { stripDangerousRoles } = require('./punishment');
            await stripDangerousRoles(guild, targetUser, targetMember);
            await interaction.reply({
                content: `🛡️ Stripped dangerous roles/permissions from **${targetUser.tag || targetUser.username}** again.`,
                ephemeral: true
            }).catch(() => { });
        }

        // After successful handling, gray out JUST the clicked button on the original message
        try {
            const msg = interaction.message;
            if (msg && Array.isArray(msg.components) && msg.components.length > 0) {
                const updatedRows = msg.components.map(row => {
                    const newRow = new ActionRowBuilder();
                    const newButtons = row.components.map(component => {
                        const btn = ButtonBuilder.from(component);
                        if (component.customId === interaction.customId) {
                            btn.setDisabled(true);
                        }
                        return btn;
                    });
                    return newRow.addComponents(newButtons);
                });

                await msg.edit({ components: updatedRows }).catch(() => { });
            }
        } catch (e) {
            console.error('[AntiNuke] Failed to disable used button:', e);
        }
    } catch (err) {
        console.error('[AntiNuke] Button action failed:', err);
        if (!interaction.replied) {
            await interaction.reply({
                content: `❌ Failed to process AntiNuke button action: ${err.message}`,
                ephemeral: true
            }).catch(() => { });
        }
    }
}

module.exports = {
    buildOwnerActionRow,
    buildWhitelistedActionRow,
    persistButtons,
    registerStoredButtons,
    registerAndPersistButtons
};


