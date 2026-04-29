const {
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { registerButton } = require('../../../handlers/buttonHandler'); // Import button handler

module.exports = {
  name: 'kick',
  description: 'Kick a member from the guild.',
  usage: '!kick <@user> [reason]',
  async execute(message, args) {
    try {
      // Check if the user has Kick permissions
      if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return message.reply(
          '<a:BlackHeart:1328691744094552064> You do not have permission to kick members! <a:FaceSlap:1140133589078524005>'
        );
      }

      // Check if the bot has the necessary permissions
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return message.reply(
          '<a:noperm:1328691744094552064> I lack the necessary permissions to kick members! Please update my permissions.'
        );
      }

      // Get the member to kick
      const member = message.mentions.members.first();
      if (!member) {
        return message.reply(
          '<a:brh:1328691744094552064> Please mention a valid member to kick! Example: `!kick @username [reason]`'
        );
      }

      if (!member.kickable) {
        return message.reply(
          '<:aaa:1328691744094552064> I cannot kick this user. They may have a higher role than me or be the server owner.'
        );
      }

      const reason = args.slice(1).join(' ') || 'No reason provided.';

      // Create the confirmation embed
      const confirmationEmbed = new EmbedBuilder()
        .setTitle('<a:BlackHeart:1327965196265721916> Kick Confirmation hehehaha :3')
        .setDescription(
          `Are you sure you want to kick **${member.user.tag}**?`
        )
        .addFields(
          { name: '<:aglespar:1327965202192273549> Reason', value: reason },
          { name: '<a:BlackHeart:1327965161050603602> Warning', value: 'You have **30 seconds** to confirm or cancel this action.' }
        )
        .setColor('#FFA500') // Orange color for a warning
        .setFooter({ 
          text: 'Moderation System',
          iconURL: message.author.displayAvatarURL({ dynamic: true })
        })
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));

      // Create the buttons for confirmation
      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirmKick-${message.author.id}-${message.id}`)
          .setLabel('Confirm')
          .setEmoji('<a:Checkmark:1327965167455305780>')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`cancelKick-${message.author.id}-${message.id}`)
          .setLabel('Cancel')
          .setEmoji('<:sed:1327965141676851291>')
          .setStyle(ButtonStyle.Secondary)
      );

      // Send the embed with buttons
      const confirmationMessage = await message.reply({
        embeds: [confirmationEmbed],
        components: [buttonRow],
        ephemeral: true, // Send the embed as ephemeral (visible only to the user who triggered the command)
      });

      // Ensure only the command author can interact with the buttons
      const authorId = message.author.id;

      // Register the Confirm button
      registerButton(`confirmKick-${message.author.id}-${message.id}`, [authorId], async (interaction) => {
        await interaction.deferUpdate(); // Acknowledge interaction
        try {
          await member.kick(reason);

          // Kick confirmation embed
          const kickEmbed = new EmbedBuilder()
            .setTitle('<a:mod:1327965158361792548> Thanks! Action Carried out.')
            .setColor('#FF0000') // Red for success
            .addFields(
              { name: 'Member <a:kicked:1140133458606309386>', value: `${member.user.tag} (${member.id})` },
              { name: 'Kicked by <a:kicked:1327965151781064715>', value: `${message.author.tag} (${message.author.id})` },
              { name: 'Reason <a:kicked:1327965161050603602>', value: reason }
            )
            .setTimestamp();

          await interaction.editReply({ embeds: [kickEmbed], components: [] });

          // Log the action
          console.log(
            `[${new Date().toISOString()}] Member ${member.user.tag} (${member.id}) was kicked by ${message.author.tag} (${message.author.id}) for reason: ${reason}`
          );
        } catch (error) {
          console.error(error);
          await interaction.editReply({
            content: '<a:nop:1327965161050603602> An error occurred while trying to kick the user. Please check my permissions and try again.',
          });
        }
      });

      // Register the Cancel button
      registerButton(`cancelKick-${message.author.id}-${message.id}`, [authorId], async (interaction) => {
        await interaction.deferUpdate(); // Acknowledge interaction
        await interaction.editReply({
          content: '<a:gud:1327965161050603602> Kick action cancelled!',
          embeds: [], // Remove the embed
          components: [],
        });
      });

      // Add timeout to disable buttons after 30 seconds
      setTimeout(() => {
        confirmationMessage.edit({
          content: 'The confirmation time has expired.',
          components: [], // Disable buttons by clearing them
        });
      }, 30000); // 30 seconds timeout

    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error executing kick command by ${message.author.tag}:`, error);
      message.reply(
        '<a:BlackHeart:1327965161050603602> An unexpected error occurred while trying to execute the kick command.'
      );
    }
  },
};