const {
    PermissionsBitField,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { registerButton } = require('../../../handlers/buttonHandler');

module.exports = {
    name: 'unban',
    description: 'Unban a member from the guild.',
    usage: '!unban <userId> [reason]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            return message.reply(
                '<c:Lperms:1328691524245913680> You do not have permission to unban members! <a:FaceSlap:1327965185490550794>'
            );
        }

        if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            return message.reply(
                '<a:BlackHeart:1327965185490550794> I lack the necessary permissions to unban members! Please update my permissions.'
            );
        }

        if (!args[0]) {
            return message.reply(
                '<a:q:1327965185490550794> Please provide a user ID to unban! Example: !unban 123456789012345678 [reason]'
            );
        }

        const userId = args[0].replace(/[<@!>]/g, '');
        const reason = args.slice(1).join(' ') || 'No reason provided.';

        // try to find the user in the ban list
        let bannedUser = null;
        try {
            const ban = await message.guild.bans.fetch(userId);
            bannedUser = ban.user;
        } catch {
            // if not a valid id, search bans by tag/username
            try {
                const bans = await message.guild.bans.fetch();
                const found = bans.find(b =>
                    b.user.tag.toLowerCase() === args[0].toLowerCase() ||
                    b.user.username.toLowerCase() === args[0].toLowerCase()
                );
                if (found) {
                    bannedUser = found.user;
                }
            } catch (err) {
                console.error('failed to fetch ban list:', err);
            }
        }

        if (!bannedUser) {
            return message.reply('<a:cancel:1327965185490550794> That user is not banned or could not be found in the ban list!');
        }

        const confirmationEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('<a:q:1327965185490550794> Unban Confirmation')
            .setDescription(
                `Are you sure you want to unban **${bannedUser.tag}**?`
            )
            .addFields(
                { name: '<a:Spark:1327965151781064715> Reason', value: reason },
                {
                    name: '<a:Q_:1333361436323479634> Warning',
                    value: 'You have **30 seconds** to confirm or cancel this action.',
                }
            )
            .setFooter({
                text: 'Moderation System | unban confirmation!',
                iconURL:
                    'https://images-ext-1.discordapp.net/external/Vj5XAuCV3kpUCA121vpFLT_8Xo-EonGppjyCNaCd6Pw/%3Fsize%3D1024/https/cdn.discordapp.com/avatars/1107155830274523136/e84dd5b59ab14bcf7685a582db0a920e.webp?format=webp&width=332&height=332',
            })
            .setThumbnail(bannedUser.displayAvatarURL({ dynamic: true }));

        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`confirmUnban-${message.id}`)
                .setLabel('Confirm')
                .setEmoji('<a:Checkmark:1327965185490550794>')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`cancelUnban-${message.id}`)
                .setLabel('Cancel')
                .setEmoji('<a:cancel:1327965151781064715>')
                .setStyle(ButtonStyle.Secondary)
        );

        const confirmationMessage = await message.reply({
            embeds: [confirmationEmbed],
            components: [buttonRow],
        });

        const authorId = message.author.id;

        registerButton(`confirmUnban-${message.id}`, [authorId], async (interaction) => {
            try {
                await deferSafe(interaction);
                await message.guild.members.unban(bannedUser.id, reason);
                await editSafe(interaction, {
                    content: `<a:ee:1327965185490550794> **${bannedUser.tag}** has been unbanned :3`,
                    embeds: [],
                    components: [],
                });
            } catch (error) {
                console.error(error);
                await editSafe(interaction, {
                    content:
                        '<a:cancel:1327965185490550794> Please check my permissions and try again.',
                    embeds: [],
                    components: [],
                });
            }
        });

        registerButton(`cancelUnban-${message.id}`, [authorId], async (interaction) => {
            try {
                await deferSafe(interaction);
                await editSafe(interaction, {
                    content: '<a:good:1327965185490550794> Unban action cancelled!',
                    embeds: [],
                    components: [],
                });
            } catch (error) {
                console.error(`error handling cancel button: ${error.message}`);
            }
        });
    },
};

/**
 * safely defer interaction
 */
async function deferSafe(interaction) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(() => {
            console.warn('interaction already deferred or expired.');
        });
    }
}

/**
 * safely edit an interaction reply
 */
async function editSafe(interaction, options) {
    try {
        await interaction.editReply(options);
    } catch (error) {
        console.warn('failed to edit interaction reply. interaction may have expired or already been handled.');
    }
}
