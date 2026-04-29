/**
 * APA (Anti-Permission Abuse) Button Helpers
 * Persistent buttons for owner control with apa_{action}_{id} format
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registerButton } = require('../../../handlers/buttonHandler');
const { saveButtons, loadButtons, loadAllButtons, persistButtons, BUTTON_EXPIRY_MS } = require('./storage');
const { restoreUserRoles } = require('./punishment');
const { restoreRolePermissions } = require('./neutralize');
const { isTrusted } = require('./detection');

// Lazy getter to avoid circular dependency
function getAPAInstance() {
    // Points to src/modules/APA.js which exports the singleton instance
    return require('../../APA');
}

/**
 * Register all stored APA buttons on startup so they survive restarts.
 */
async function registerStoredButtons(client) {
    try {
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

        console.log(`[APA] 📂 Registered stored buttons for ${all.size} guilds`);
    } catch (err) {
        console.error('[APA] Failed to register stored buttons:', err);
    }
}

/**
 * Build owner action buttons for UNTRUSTED user notifications
 * - Whitelist User
 * - Restore User Roles (for punished executor)
 * - Restore Role Perms (if role was neutralized)
 */
function buildOwnerActionRow(executor, roleId, wasRoleNeutralized) {
    const whitelistId = `apa_whitelist_${executor.id}`;
    const restoreUserRolesId = `apa_restore_user_${executor.id}`;
    const restoreRolePermsId = `apa_restore_role_${roleId}`;

    const buttons = [
        new ButtonBuilder()
            .setCustomId(whitelistId)
            .setLabel('Whitelist User')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(restoreUserRolesId)
            .setLabel('Restore User Roles')
            .setStyle(ButtonStyle.Primary)
    ];

    if (wasRoleNeutralized) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(restoreRolePermsId)
                .setLabel('Restore Role Perms')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    return {
        row: new ActionRowBuilder().addComponents(buttons),
        whitelistId,
        restoreUserRolesId,
        restoreRolePermsId
    };
}

/**
 * Build action buttons for WHITELISTED user notifications
 * - Unwhitelist
 * - Strip Roles
 * - Kick
 * - Ban
 */
function buildWhitelistedActionRow(executor) {
    const unWhitelistId = `apa_unwhitelist_${executor.id}`;
    const stripId = `apa_strip_${executor.id}`;
    const kickId = `apa_kick_${executor.id}`;
    const banId = `apa_ban_${executor.id}`;

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
        stripId,
        kickId,
        banId
    };
}

/**
 * Register handlers for a set of buttons AND persist them to JSON.
 * This ensures buttons are clickable immediately and also survive restarts.
 */
async function registerAndPersistButtons(guildId, buttonMetas) {
    // Register handlers in memory
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
 * Shared handler for APA buttons
 */
async function handleButtonAction(interaction, meta) {
    if (!meta) return;

    const client = interaction.client;
    const metaGuildId = meta.guildId;

    // Resolve guild: from interaction when in a guild, or from stored guildId when in DMs
    let guild = interaction.guild;
    if (!guild && metaGuildId) {
        guild = client.guilds.cache.get(metaGuildId) || await client.guilds.fetch(metaGuildId).catch(() => null);
    }
    if (!guild) {
        console.error('[APA] Button action without guild context; meta:', meta);
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({
                content: 'Unable to resolve server context for this APA button. It may be expired.',
                ephemeral: true
            }).catch(() => { });
        }
        return;
    }

    const targetUserId = meta.userId;
    const targetRoleId = meta.roleId;
    const actionType = meta.type;

    // Lazy load APA instance to avoid circular dependency
    let apaInstance;
    try {
        apaInstance = getAPAInstance();
    } catch (e) {
        // Fallback: try to get configs from the guild
        apaInstance = null;
    }

    const guildId = guild.id;
    const currentConfig = apaInstance?.getConfig?.(guildId) || { trustedUsers: [], trustedRoles: [], whitelistedUsers: [] };

    // Resolve executor member (owner / trusted user) even in DMs
    let executorMember = interaction.member || guild.members.cache.get(interaction.user.id);
    if (!executorMember) {
        executorMember = await guild.members.fetch(interaction.user.id).catch(() => null);
    }

    // Only owner or trusted users can use these controls
    const isOwner = interaction.user.id === guild.ownerId || (meta.ownerId && interaction.user.id === meta.ownerId);
    if (!executorMember && !isOwner) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'You are not allowed to use APA owner controls.',
                ephemeral: true
            }).catch(() => { });
        }
        return;
    }

    if (executorMember && !isOwner && !isTrusted(interaction.user, guild, currentConfig)) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'You are not allowed to use APA owner controls.',
                ephemeral: true
            }).catch(() => { });
        }
        return;
    }

    try {


        // Get target user/member for user actions
        let targetUser = null;
        let targetMember = null;
        if (targetUserId) {
            targetUser = await client.users.fetch(targetUserId).catch(() => null);
            targetMember = await guild.members.fetch(targetUserId).catch(() => null);
        }

        // Handle different action types
        if (actionType === 'whitelist') {
            // Add user to APA whitelist
            const list = Array.isArray(currentConfig.whitelistedUsers) ? currentConfig.whitelistedUsers : [];
            if (!list.includes(targetUserId)) {
                list.push(targetUserId);
            }
            const newConfig = { ...currentConfig, whitelistedUsers: list };
            if (apaInstance?.updateConfig) {
                await apaInstance.updateConfig(guildId, newConfig);
            }

            await interaction.reply({
                content: `✅ **${targetUser?.username || targetUserId}** has been whitelisted for APA.`,
                ephemeral: true
            }).catch(() => { });

        } else if (actionType === 'unwhitelist') {
            // Remove user from APA whitelist
            const list = Array.isArray(currentConfig.whitelistedUsers) ? currentConfig.whitelistedUsers : [];
            const filtered = list.filter(id => id !== targetUserId);
            const newConfig = { ...currentConfig, whitelistedUsers: filtered };
            if (apaInstance?.updateConfig) {
                await apaInstance.updateConfig(guildId, newConfig);
            }

            await interaction.reply({
                content: `✅ **${targetUser?.username || targetUserId}** has been removed from the APA whitelist.`,
                ephemeral: true
            }).catch(() => { });

        } else if (actionType === 'restore_user') {
            // Restore stripped roles to the user
            const result = await restoreUserRoles(guild, targetUserId);
            if (result.success) {
                await interaction.reply({
                    content: `✅ Restored **${result.restoredCount}** role(s) to ${targetUser?.username || targetUserId}.`,
                    ephemeral: true
                }).catch(() => { });
            } else {
                await interaction.reply({
                    content: `⚠️ Could not restore roles: ${result.errors?.join('\n') || 'No stored data'}`,
                    ephemeral: true
                }).catch(() => { });
            }

        } else if (actionType === 'restore_role') {
            // Restore neutralized role permissions
            const result = await restoreRolePermissions(guild, targetRoleId);
            if (result.success) {
                await interaction.reply({
                    content: `✅ Restored permissions for role **${result.roleName}**.`,
                    ephemeral: true
                }).catch(() => { });
            } else {
                await interaction.reply({
                    content: `⚠️ Could not restore role permissions: ${result.reason}`,
                    ephemeral: true
                }).catch(() => { });
            }

        } else if (actionType === 'strip' && targetMember) {
            // Strip dangerous roles from user again
            const { stripDangerousRoles } = require('./punishment');
            const result = await stripDangerousRoles(guild, targetUser, targetMember);
            await interaction.reply({
                content: result.success
                    ? `🛡️ Stripped **${result.count}** dangerous role(s) from ${targetUser?.username || targetUserId}.`
                    : `⚠️ Could not strip roles: ${result.reason}`,
                ephemeral: true
            }).catch(() => { });

        } else if (actionType === 'kick' && targetMember) {
            // Kick the user
            await targetMember.kick('APA: Owner action via button');
            await interaction.reply({
                content: `👢 Kicked **${targetUser?.username || targetUserId}** from the server.`,
                ephemeral: true
            }).catch(() => { });

        } else if (actionType === 'ban' && targetMember) {
            // Ban the user
            await targetMember.ban({ reason: 'APA: Owner action via button' });
            await interaction.reply({
                content: `🔨 Banned **${targetUser?.username || targetUserId}** from the server.`,
                ephemeral: true
            }).catch(() => { });

        } else if ((actionType === 'kick' || actionType === 'ban' || actionType === 'strip') && !targetMember) {
            await interaction.reply({
                content: '⚠️ The target user is no longer in the server.',
                ephemeral: true
            }).catch(() => { });
        }

        // Simultaneous Update Logic
        const relatedMessages = meta.relatedMessages || [];

        // Include the interaction message itself if not present/legacy
        if (!relatedMessages.some(m => m.messageId === interaction.message.id)) {
            relatedMessages.push({
                channelId: interaction.channelId,
                messageId: interaction.message.id
            });
        }

        const { EmbedBuilder } = require('discord.js');
        const updatePromises = relatedMessages.map(async (info) => {
            try {
                // Fetch channel (handle DM or Guild)
                let channel = interaction.client.channels.cache.get(info.channelId);
                if (!channel) {
                    try {
                        channel = await interaction.client.channels.fetch(info.channelId);
                    } catch (e) { return; }
                }

                if (!channel) return;

                const msg = await channel.messages.fetch(info.messageId).catch(() => null);
                if (!msg) return;

                // Create disabled buttons
                const updatedRows = msg.components.map(row => {
                    const newRow = new ActionRowBuilder();
                    const newButtons = row.components.map(component => {
                        const btn = ButtonBuilder.from(component);
                        // Disable all buttons, mark the clicked one as success/selected
                        btn.setDisabled(true);
                        if (component.customId === interaction.customId) {
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
                // Avoid adding duplicate fields if already updated
                const alreadyUpdated = newEmbed.data.fields?.some(f => f.name && f.name.includes('ACTION UPDATE'));

                if (!alreadyUpdated) {
                    newEmbed.addFields({
                        name: '✅ ACTION UPDATE',
                        value: `**Action (${actionType}) taken** by ${interaction.user.username}`,
                        inline: false
                    });
                }

                await msg.edit({ embeds: [newEmbed], components: updatedRows });

            } catch (e) {
                console.error(`[APA] Failed to update related message ${info.messageId}:`, e.message);
            }
        });

        await Promise.all(updatePromises);

    } catch (err) {
        console.error('[APA] Button action failed:', err);
        if (!interaction.replied) {
            await interaction.reply({
                content: `❌ Failed to process APA button action: ${err.message}`,
                ephemeral: true
            }).catch(() => { });
        }
    }
}

module.exports = {
    buildOwnerActionRow,
    buildWhitelistedActionRow,
    registerStoredButtons,
    registerAndPersistButtons,
    handleButtonAction
};
