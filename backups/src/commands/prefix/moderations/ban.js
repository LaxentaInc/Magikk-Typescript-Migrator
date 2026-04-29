const {
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { registerButton } = require('../../../handlers/buttonHandler');

module.exports = {
  name: 'ban',
  description: 'Ban a member from the guild.',
  usage: '!ban <@user> [reason]',
  async execute(message, args) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return message.reply(
        '<:Lperms:1328691524245913680> You do not have permission to ban members! <a:FaceSlap:1327965185490550794>'
      );
    }

    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return message.reply(
        '<a:BlackHeart:1327965185490550794> I lack the necessary permissions to ban members! Please update my permissions.'
      );
    }

    const userToBan = message.mentions.users.first();
    if (!userToBan) {
      return message.reply(
        '<a:q:1327965185490550794> Please mention a user to ban! Example: !ban @username [reason]'
      );
    }

    if (userToBan.id === message.author.id) {
      return message.reply('<a:cancel:1327965185490550794> You cannot ban yourself!');
    }
    if (userToBan.id === message.guild.ownerId) {
      return message.reply('<a:cancel:1327965185490550794> You cannot ban the server owner!');
    }

    const memberToBan = await message.guild.members.fetch(userToBan.id).catch(() => null);
    if (!memberToBan || !memberToBan.bannable) {
      return message.reply('<a:cancel:1327965185490550794> I cannot ban this user, make sure my rule is at the top of everyone : 3.');
    }

    const reason = args.slice(1).join(' ') || 'No reason provided.';

    const confirmationEmbed = new EmbedBuilder()
      .setColor(0xff4747)
      .setTitle('<a:q:1327965185490550794> Ban Confirmation')
      .setDescription(
        `Are you sure you want to ban <a:banned:1140133494199173121> **${userToBan.tag}**? Please confirm!`
      )
      .addFields(
        { name: '<a:Spark:1327965151781064715> Reason', value: reason },
        {
          name: '<a:Q_:1333361436323479634> Warning',
          value: 'You have **30 seconds** to confirm or cancel this action.',
        }
      )
      .setFooter({
        text: 'Moderation System | ban confirmation!',
        iconURL:
          'https://images-ext-1.discordapp.net/external/Vj5XAuCV3kpUCA121vpFLT_8Xo-EonGppjyCNaCd6Pw/%3Fsize%3D1024/https/cdn.discordapp.com/avatars/1107155830274523136/e84dd5b59ab14bcf7685a582db0a920e.webp?format=webp&width=332&height=332',
      })
      .setThumbnail(userToBan.displayAvatarURL({ dynamic: true }));

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirmBan-${message.id}`)
        .setLabel('Confirm')
        .setEmoji('<a:Checkmark:1327965185490550794>')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`cancelBan-${message.id}`)
        .setLabel('Cancel')
        .setEmoji('<a:cancel:1327965151781064715>')
        .setStyle(ButtonStyle.Secondary)
    );

    const confirmationMessage = await message.reply({
      embeds: [confirmationEmbed],
      components: [buttonRow],
    });

    const authorId = message.author.id;

    registerButton(`confirmBan-${message.id}`, [authorId], async (interaction) => {
      try {
        await deferSafe(interaction); // Safe deferral of interaction
        await message.guild.members.ban(userToBan.id, { reason });
        await editSafe(interaction, {
          content: `<a:ee:1327965185490550794> **${userToBan.tag}** has been banished by our mighty mods :3`,
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

    registerButton(`cancelBan-${message.id}`, [authorId], async (interaction) => {
      try {
        await deferSafe(interaction); // Safe deferral of interaction
        await editSafe(interaction, {
          content: '<a:good:1327965185490550794> Ban action cancelled!',
          embeds: [],
          components: [],
        });
      } catch (error) {
        console.error(`Error handling cancel button: ${error.message}`);
      }
    });
  },
};

/**
 * Utility: Safely defer interaction
 */
async function deferSafe(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => {
      console.warn('Interaction already deferred or expired.');
    });
  }
}

/**
 * Utility: Safely edit an interaction reply
 */
async function editSafe(interaction, options) {
  try {
    await interaction.editReply(options);
  } catch (error) {
    console.warn('Failed to edit interaction reply. Interaction may have expired or already been handled.');
  }
}