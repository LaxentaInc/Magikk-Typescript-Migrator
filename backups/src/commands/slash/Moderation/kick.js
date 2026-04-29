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
        .setName('kick')
        .setDescription('Kicks a user from the server.')
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('The user to kick.')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('reason')
                .setDescription('The reason for kicking.')
                .setMaxLength(512)
        )
        .addBooleanOption((option) =>
            option.setName('ephemeral')
                .setDescription('Whether to make the response visible only to you (default: false)')
        )
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    async execute(interaction) {
        try {
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'No reason provided.';
            const isEphemeral = interaction.options.getBoolean('ephemeral') || false;
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);

            if (!await validatePermissions(interaction, member, user)) return;

            // user must be in the server to be kicked
            if (!member) {
                await ephemeralReply(interaction, '<a:no:1332327203106717736> That user is not in this server!');
                return;
            }

            const confirmationEmbed = createKickEmbed(user, reason, member);
            const buttonRow = createButtonRow(interaction.id);

            const replyOptions = {
                embeds: [confirmationEmbed],
                components: [buttonRow],
            };
            if (isEphemeral) replyOptions.flags = MessageFlags.Ephemeral;

            await interaction.reply(replyOptions);

            registerButton(
                `confirmKick_${interaction.id}`,
                [interaction.user.id],
                async (buttonInteraction) => {
                    try {
                        if (!buttonInteraction.deferred) {
                            await buttonInteraction.deferUpdate();
                        }

                        await member.kick(reason);
                        await buttonInteraction.editReply({
                            content: `<a:done:1327965185490550794> Successfully kicked **${user.tag}**\nReason: ${reason}`,
                            components: [],
                            embeds: [],
                        });
                    } catch (error) {
                        console.error('kick execution error:', error);
                        await buttonInteraction.editReply({
                            content: `❌ Failed to kick user: ${error.message}`,
                            components: [],
                            embeds: [],
                        });
                    }
                },
                { globalCooldown: true }
            );

            registerButton(
                `cancelKick_${interaction.id}`,
                [interaction.user.id],
                async (buttonInteraction) => {
                    try {
                        if (!buttonInteraction.deferred) {
                            await buttonInteraction.deferUpdate();
                        }

                        await buttonInteraction.editReply({
                            content: '<a:c:1310498065328898108> Kick Action | cancelled',
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
            console.error('kick command error:', error);
            await ephemeralReply(interaction, `❌ An error occurred: ${error.message}`);
        }
    },
};


// utility functions
async function validatePermissions(interaction, member, user) {
    const isOwner = interaction.member.id === interaction.guild.ownerId;

    if (!isOwner && !interaction.memberPermissions.has(PermissionFlagsBits.KickMembers)) {
        await ephemeralReply(interaction, "<a:no:1332327203106717736> You don't have permission to kick members!");
        return false;
    }

    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
        await ephemeralReply(interaction, "<a:no:1332327203106717736> I need the 'Kick Members' permission!");
        return false;
    }

    if (user.id === interaction.user.id) {
        await ephemeralReply(interaction, '<a:no:1332327203106717736> You cannot kick yourself!');
        return false;
    }

    if (member) {
        if (member.id === interaction.guild.ownerId) {
            await sendGuideEmbed(interaction, '<a:no:1332327203106717736> Cannot kick the server owner!');
            return false;
        }

        const isCommandUserOwner = interaction.member.id === interaction.guild.ownerId;

        if (!isCommandUserOwner && member.roles.highest.position >= interaction.member.roles.highest.position) {
            await sendGuideEmbed(interaction, '<a:no:1332327203106717736> Cannot kick someone with equal or higher role.');
            return false;
        }

        if (member.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
            await sendGuideEmbed(interaction, '<a:no:1332327203106717736> My role is too low to kick this user.');
            return false;
        }
    }

    return true;
}

function createKickEmbed(user, reason, member) {
    const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle('<a:eh:1327965185490550794> Kick Confirmation')
        .setDescription(`Are you sure you want to kick **${user.tag}**?`)
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
            .setCustomId(`confirmKick_${interactionId}`)
            .setLabel('Confirm Kick')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('<a:ehe:1327965184425332756>'),
        new ButtonBuilder()
            .setCustomId(`cancelKick_${interactionId}`)
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

async function sendGuideEmbed(interaction, message) {
    const guideEmbed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle('<a:eh:1310498074673811538> Action Restricted | User have Admin/Higher Role')
        .setDescription(message)
        .addFields(
            {
                name: '<a:eh:1310498074673811538> Why?',
                value: 'Either I don\'t have permissions, or the user has a higher/equal role to yours or mine.'
            },
            {
                name: '<a:eh:1325374132182847528> Solution',
                value: 'Check role positions and permissions in server settings. Make sure my role is higher than the target user\'s role.'
            }
        )
        .setFooter({
            text: 'Moderation System | Confirmation',
            iconURL: 'https://images-ext-1.discordapp.net/external/pCWWi-RkK8T154d2e-MDLIuufPsX95XiUBu6D-4rJTY/%3Fsize%3D1024/https/cdn.discordapp.com/avatars/953527567808356404/a_f23371769e15cc9079dcc637253faed2.gif?width=292&height=292'
        })
        .setTimestamp();

    await interaction.reply({
        embeds: [guideEmbed],
        flags: MessageFlags.Ephemeral
    });
}
