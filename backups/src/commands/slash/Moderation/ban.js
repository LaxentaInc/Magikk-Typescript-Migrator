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
        .setName('ban')
        .setDescription('Bans a user from the server.')
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('The user to ban.')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('reason')
                .setDescription('The reason for banning.')
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
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'No reason provided.';
            const isEphemeral = interaction.options.getBoolean('ephemeral') || false;
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);

            if (!await validatePermissions(interaction, member, user)) return;

            const confirmationEmbed = createBanEmbed(user, reason, member);
            const buttonRow = createButtonRow(interaction.id);

            const replyOptions = {
                embeds: [confirmationEmbed],
                components: [buttonRow],
            };
            if (isEphemeral) replyOptions.flags = MessageFlags.Ephemeral;

            await interaction.reply(replyOptions);

            registerButton(
                `confirmBan_${interaction.id}`,
                [interaction.user.id],
                async (buttonInteraction) => {
                    try {
                        if (!buttonInteraction.deferred) {
                            await buttonInteraction.deferUpdate();
                        }

                        await interaction.guild.members.ban(user.id, { reason });
                        await buttonInteraction.editReply({
                            content: `<a:done:1327965185490550794> Successfully banned **${user.tag}**\nReason: ${reason}`,
                            components: [],
                            embeds: [],
                        });
                    } catch (error) {
                        console.error('Ban execution error:', error);
                        await buttonInteraction.editReply({
                            content: `❌ Failed to ban user: ${error.message}`,
                            components: [],
                            embeds: [],
                        });
                    }
                },
                { globalCooldown: true }
            );

            registerButton(
                `cancelBan_${interaction.id}`,
                [interaction.user.id],
                async (buttonInteraction) => {
                    try {
                        if (!buttonInteraction.deferred) {
                            await buttonInteraction.deferUpdate();
                        }

                        await buttonInteraction.editReply({
                            content: '<a:c:1310498065328898108> Ban Action | cancelled',
                            components: [],
                            embeds: [],
                        });
                    } catch (error) {
                        console.error('Cancel button error:', error);
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
                    console.error('Timeout cleanup error:', err);
                }
            }, 30000);

        } catch (error) {
            console.error('Ban command error:', error);
            await ephemeralReply(interaction, `❌ An error occurred: ${error.message}`);
        }
    },
};


// Utility Functions
async function validatePermissions(interaction, member, user) {
    // Server owner can always ban (unless they're trying to ban themselves lol)
    const isOwner = interaction.member.id === interaction.guild.ownerId;

    // Check if command user has permission (Owner OR has BanMembers permission)
    // Note: Administrator permission automatically includes BanMembers
    if (!isOwner && !interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
        await ephemeralReply(interaction, "<a:no:1332327203106717736> You don't have permission to ban members!");
        return false;
    }

    // Check if bot has permission
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
        await ephemeralReply(interaction, "<a:no:1332327203106717736> I need the 'Ban Members' permission!");
        return false;
    }

    // Only do role checks if the user is actually in the server
    // Only do role checks if the user is actually in the server
    if (member) {
        if (member.id === interaction.guild.ownerId) {
            await sendGuideEmbed(interaction, '<a:no:1332327203106717736> Cannot ban the server owner!');
            return false;
        }

        // SERVER OWNER BYPASS
        const isCommandUserOwner = interaction.member.id === interaction.guild.ownerId;

        if (!isCommandUserOwner && member.roles.highest.position >= interaction.member.roles.highest.position) {
            await sendGuideEmbed(interaction, '<a:no:1332327203106717736> Cannot ban someone with equal or higher role.');
            return false;
        }

        if (member.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
            await sendGuideEmbed(interaction, '<a:no:1332327203106717736> My role is too low to ban this user.');
            return false;
        }
    }
    // If member is null, user isn't in server - but we can still ban them by ID

    return true;
}

function createBanEmbed(user, reason, member) {
    const embed = new EmbedBuilder()
        .setColor(0xff4747)
        .setTitle('<a:eh:1327965185490550794> Ban Confirmation')
        .setDescription(`Are you sure you want to ban **${user.tag}**?${member ? '' : '\n⚠️ *User is not in the server but can still be banned.*'}`)
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
            .setCustomId(`confirmBan_${interactionId}`)
            .setLabel('Confirm Ban')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('<a:ehe:1327965184425332756>'),
        new ButtonBuilder()
            .setCustomId(`cancelBan_${interactionId}`)
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