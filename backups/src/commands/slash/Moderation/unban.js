const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');
const { registerButton } = require('../../../handlers/buttonHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unbans a user from the server.')
        .addStringOption((option) =>
            option.setName('user')
                .setDescription('The user ID to unban (or use user#tag format).')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('reason')
                .setDescription('The reason for unbanning.')
                .setMaxLength(512)
        )
        .addBooleanOption((option) =>
            option.setName('ephemeral')
                .setDescription('Whether to make the response visible only to you (default: false)')
        )
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        try {
            const userInput = interaction.options.getString('user');
            const reason = interaction.options.getString('reason') || 'No reason provided.';
            const isEphemeral = interaction.options.getBoolean('ephemeral') || false;

            // check permissions
            const isOwner = interaction.member.id === interaction.guild.ownerId;
            if (!isOwner && !interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
                return await ephemeralReply(interaction, "<a:no:1332327203106717736> You don't have permission to unban members!");
            }

            if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
                return await ephemeralReply(interaction, "<a:no:1332327203106717736> I need the 'Ban Members' permission!");
            }

            // extract user id from input (supports raw id, <@id>, or user#tag search)
            let userId = userInput.replace(/[<@!>]/g, '');
            let bannedUser = null;

            // try to fetch from ban list
            try {
                const ban = await interaction.guild.bans.fetch(userId);
                bannedUser = ban.user;
            } catch {
                // if not a valid id, search bans by tag
                const bans = await interaction.guild.bans.fetch();
                const found = bans.find(b =>
                    b.user.tag.toLowerCase() === userInput.toLowerCase() ||
                    b.user.username.toLowerCase() === userInput.toLowerCase()
                );
                if (found) {
                    bannedUser = found.user;
                    userId = found.user.id;
                }
            }

            if (!bannedUser) {
                return await ephemeralReply(interaction, '<a:no:1332327203106717736> That user is not banned or could not be found in the ban list!');
            }

            const confirmationEmbed = createUnbanEmbed(bannedUser, reason);
            const buttonRow = createButtonRow(interaction.id);

            const replyOptions = {
                embeds: [confirmationEmbed],
                components: [buttonRow],
            };
            if (isEphemeral) replyOptions.flags = MessageFlags.Ephemeral;

            await interaction.reply(replyOptions);

            registerButton(
                `confirmUnban_${interaction.id}`,
                [interaction.user.id],
                async (buttonInteraction) => {
                    try {
                        if (!buttonInteraction.deferred) {
                            await buttonInteraction.deferUpdate();
                        }

                        await interaction.guild.members.unban(userId, reason);
                        await buttonInteraction.editReply({
                            content: `<a:done:1327965185490550794> Successfully unbanned **${bannedUser.tag}**\nReason: ${reason}`,
                            components: [],
                            embeds: [],
                        });
                    } catch (error) {
                        console.error('unban execution error:', error);
                        await buttonInteraction.editReply({
                            content: `❌ Failed to unban user: ${error.message}`,
                            components: [],
                            embeds: [],
                        });
                    }
                },
                { globalCooldown: true }
            );

            registerButton(
                `cancelUnban_${interaction.id}`,
                [interaction.user.id],
                async (buttonInteraction) => {
                    try {
                        if (!buttonInteraction.deferred) {
                            await buttonInteraction.deferUpdate();
                        }

                        await buttonInteraction.editReply({
                            content: '<a:c:1310498065328898108> Unban Action | cancelled',
                            components: [],
                            embeds: [],
                        });
                    } catch (error) {
                        console.error('cancel button error:', error);
                        if (!buttonInteraction.replied && !buttonInteraction.deferred) {
                            await buttonInteraction.reply({
                                content: '❌ An error occurred while cancelling.',
                                ephemeral: true,
                            });
                        }
                    }
                },
                { globalCooldown: true }
            );

            setTimeout(async () => {
                try {
                    const message = await interaction.fetchReply();
                    if (message.editable) {
                        await interaction.editReply({
                            components: [],
                            content: '<a:close:1310498100833554442> No validation received',
                            embeds: []
                        });
                    }
                } catch (err) {
                    console.error('timeout cleanup error:', err);
                }
            }, 30000);

        } catch (error) {
            console.error('unban command error:', error);
            await ephemeralReply(interaction, `❌ An error occurred: ${error.message}`);
        }
    },
};


// utility functions
function createUnbanEmbed(user, reason) {
    const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('<a:eh:1327965185490550794> Unban Confirmation')
        .setDescription(`Are you sure you want to unban **${user.tag}**?`)
        .addFields(
            { name: '<a:eh:1310498074673811538> User', value: `${user.tag} (${user.id})` },
            { name: '<a:eh:1327965158361792548> Reason', value: reason },
            { name: '<a:eh:1333361436323479634> Warning', value: 'You have 30 seconds to confirm or cancel.' }
        )
        .setFooter({
            text: 'Moderation System | Confirmation',
            iconURL: 'https://cdn.discordapp.com/avatars/1107155830274523136/e84dd5b59ab14bcf7685a582db0a920e.webp?size=1024'
        })
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

    return embed;
}

function createButtonRow(interactionId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirmUnban_${interactionId}`)
            .setLabel('Confirm Unban')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<a:ehe:1327965184425332756>'),
        new ButtonBuilder()
            .setCustomId(`cancelUnban_${interactionId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✖️')
    );
}

async function ephemeralReply(interaction, content) {
    await interaction.reply({
        content,
        flags: MessageFlags.Ephemeral
    });
}
