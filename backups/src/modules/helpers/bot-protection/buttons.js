/**
 * BotProtection Button Handler
 * Handles persistent buttons for Bot Protection
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registerButton } = require('../../../handlers/buttonHandler');
const { saveButtons, getValidButtons } = require('../GlobalButtonStorage');

const MODULE_NAME = 'bot-protection';
const LOG_PREFIX = '[BotProtection Buttons]';

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
    // Add expiry (24 hours) if not present
    if (!meta.expiresAt) {
        meta.expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24h
    }

    // Ensure vital data
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
        const botProtection = require('./index');
        const guildId = meta.guildId || interaction.guildId;

        if (!guildId) {
            return interaction.reply({ content: '❌ Error: Guild context missing.', ephemeral: true });
        }

        // Fetch guild if interaction is from DM
        const guild = interaction.guild || await interaction.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            return interaction.reply({ content: '❌ Error: Guild not found.', ephemeral: true });
        }

        const currentConfig = botProtection.getConfig(guildId);
        const { isTrustedUser } = require('./config');

        // Verify Permission
        // Only trusted users or owner can use this
        // interaction.user must be trusted
        const authorized = isTrustedUser(interaction.user, guild, currentConfig);

        if (!authorized) {
            return interaction.reply({
                content: '⛔ You are not authorized to use this button.',
                ephemeral: true
            });
        }

        if (meta.type === 'whitelist_bot') {
            await handleWhitelist(interaction, meta, botProtection, currentConfig);
        } else if (meta.type === 'restore_perms') {
            await handleRestorePerms(interaction, meta, botProtection, currentConfig);
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
 * Logic for Whitelisting a bot
 */
async function handleWhitelist(interaction, meta, botProtection, currentConfig) {
    const targetId = meta.targetId; // Bot ID

    // 1. Check if already whitelisted
    if (currentConfig.whitlistedBots && currentConfig.whitlistedBots.includes(targetId)) {
        return interaction.reply({ content: '✅ Bot is already whitelisted.', ephemeral: true });
    }

    // 2. Update Config
    const whitelist = currentConfig.whitlistedBots || [];
    whitelist.push(targetId);

    await botProtection.updateConfig(meta.guildId, { whitlistedBots: whitelist });

    // 3. User Feedback
    await interaction.reply({
        content: `✅ **Successfully Whitelisted <@${targetId}>**.\nYou can reinvite it safely.`,
        ephemeral: true
    });

    // 4. Disable Button (Visual)
    try {
        const msg = interaction.message;
        const newRows = msg.components.map(row => {
            const newRow = new ActionRowBuilder();
            row.components.forEach(comp => {
                const btn = ButtonBuilder.from(comp);
                if (comp.customId === interaction.customId) {
                    btn.setDisabled(true);
                    btn.setLabel('Whitelisted');
                    btn.setStyle(ButtonStyle.Success);
                    btn.setEmoji('✅');
                }
                newRow.addComponents(btn);
            });
            return newRow;
        });

        await msg.edit({ components: newRows });
    } catch (e) {
        // Ignore
    }
}

/**
 * Logic for Restoring Perms
 */
async function handleRestorePerms(interaction, meta, botProtection, currentConfig) {
    const targetId = meta.targetId;
    const memberId = meta.memberId;
    const strippedPermissions = meta.strippedPermissions;
    const relatedMessages = meta.relatedMessages || [];

    if (!strippedPermissions) {
        return interaction.reply({ content: '❌ Error: Missing permission data in button metadata.', ephemeral: true });
    }

    const { restoreBotPermissions } = require('./permissions');
    const { EmbedBuilder } = require('discord.js');
    const EMOJIS = require('./emojis');

    const guild = interaction.guild || interaction.client.guilds.cache.get(meta.guildId);
    if (!guild) return interaction.reply({ content: '❌ Guild not found.', ephemeral: true });

    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) {
        return interaction.reply({ content: '❌ Bot is no longer in the server.', ephemeral: true });
    }


    // 1. Restore Permissions
    const result = await restoreBotPermissions(member, strippedPermissions);

    if (result.success) {
        // 2. Prepare Success UI
        const restorer = interaction.user;
        const successEmbedUpdate = (oldEmbed) => {
            const embed = EmbedBuilder.from(oldEmbed);
            embed.setColor(0x57F287); // Green
            embed.addFields({
                name: `${EMOJIS.VERIFIED || '✅'} ACTION UPDATE`,
                value: `**Permissions Restored** by ${restorer.username}`,
                inline: false
            });
            return embed;
        };

        const successRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('restored_done')
                .setLabel(`Restored by ${restorer.username}`)
                .setStyle(ButtonStyle.Success)
                .setEmoji(EMOJIS.VERIFIED || '✅')
                .setDisabled(true)
        );

        // 3. Update ALL related messages (Simultaneous Update)
        const updatePromises = relatedMessages.map(async (info) => {
            try {
                const channel = await interaction.client.channels.fetch(info.channelId).catch(() => null);
                if (channel) {
                    const msg = await channel.messages.fetch(info.messageId).catch(() => null);
                    if (msg) {
                        await msg.edit({
                            embeds: [successEmbedUpdate(msg.embeds[0])],
                            components: [successRow]
                        });
                    }
                }
            } catch (err) {
                if (err.code === 50001 || err.code === 10008) { // Missing Access or Unknown Message
                    console.log(`${LOG_PREFIX} Could not update related message ${info.messageId} (likely DM closed/deleted): ${err.message}`);
                } else {
                    console.error(`${LOG_PREFIX} Failed to update related message ${info.messageId}:`, err.message);
                }
            }
        });

        // Also update the interaction message itself ensure it's covered
        // (It should be in relatedMessages, but just in case)
        if (!relatedMessages.some(m => m.messageId === interaction.message.id)) {
            updatePromises.push(
                interaction.message.edit({
                    embeds: [successEmbedUpdate(interaction.message.embeds[0])],
                    components: [successRow]
                }).catch(err => console.log(`${LOG_PREFIX} Failed to update interaction message: ${err.message}`))
            );
        }

        await Promise.all(updatePromises);

        await interaction.reply({
            content: `✅ **Permissions Restored!**\nSynced across ${relatedMessages.length} notifications.`,
            ephemeral: true
        });

    } else {
        await interaction.followUp({
            content: `❌ **Failed to restore permissions:**\n${result.errors.join('\n')}`,
            ephemeral: true
        });
    }
}

module.exports = {
    init,
    registerAndPersist
};
