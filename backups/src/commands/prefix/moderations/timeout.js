const { PermissionsBitField, EmbedBuilder } = require("discord.js");

function parseDuration(duration) {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

module.exports = {
  name: 'timeout',
  aliases: ['mute'],
  description: 'Temporarily time out a user in the server for a specified duration. Usage: !timeout @user/id 5m [reason]',
  async execute(message, args) {
    try {
      // Check if command user has permissions
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply({
          content: '<a:Noo:1326464297080983655> You do not have permission to use this command.',
          ephemeral: true
        });
      }

      // Check if bot has permissions
      if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply({
          content: '<a:Noo:1326464297080983655> I do not have permission to timeout members.',
          ephemeral: true
        });
      }

      // Check for minimum arguments
      if (args.length < 2) {
        return message.reply({
          content: '<:q:1326464001793855531> Usage: `!timeout @user/id duration [reason]` (e.g., `!timeout @user 5m spam`)',
          ephemeral: true
        });
      }

      // Get target user
      let targetUser = message.mentions.members.first();
      if (!targetUser && args[0]) {
        targetUser = await message.guild.members.fetch(args[0]).catch(() => null);
      }
      if (!targetUser) {
        return message.reply({
          content: '<:q:1326464001793855531> Please mention or provide a valid member ID.',
          ephemeral: true
        });
      }

      // Prevent timing out the server owner
      if (targetUser.id === message.guild.ownerId) {
        return message.reply({
          content: '<:q:1326464001793855531> I cannot timeout the server owner.',
          ephemeral: true
        });
      }

      // Prevent timing out Administrators
      if (targetUser.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply({
          content: '<:q:1326464001793855531> I cannot timeout a member with Administrator permissions.',
          ephemeral: true
        });
      }

      // Check if command user can moderate target (hierarchy check)
      if (message.member.roles.highest.position <= targetUser.roles.highest.position && message.member.id !== message.guild.ownerId) {
        return message.reply({
          content: '<:q:1326464001793855531> You cannot timeout this user because their role is equal to or higher than yours.',
          ephemeral: true
        });
      }

      // Check if bot can moderate target (hierarchy check)
      if (message.guild.members.me.roles.highest.position <= targetUser.roles.highest.position) {
        return message.reply({
          content: '<:q:1326464001793855531> I cannot timeout this user because their role is equal to or higher than mine.',
          ephemeral: true
        });
      }

      const durationInput = args[1];
      const durationMs = parseDuration(durationInput);
      if (!durationMs || durationMs > 25 * 24 * 60 * 60 * 1000) {
        return message.reply({
          content: '<:Warning:1326464001793855531> Specify a valid duration up to 25 days (e.g., 10s, 1m, 1h, 1d).',
          ephemeral: true
        });
      }

      const reason = args.slice(2).join(' ') || 'No reason provided <:c:1326464001793855531>';

      await targetUser.timeout(durationMs, reason);
      const timeoutEndDate = new Date(Date.now() + durationMs);

      message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("Timeout Issued")
            .setDescription(`**${targetUser.user.tag}** has been timed out.`)
            .addFields(
              { name: "Duration <a:w:1326464173361856524>", value: durationInput, inline: true },
              { name: "Reason <:r:1326464001793855531>", value: reason, inline: true },
              { name: "Ends At <a:Warning:1326464273467179130>", value: `<t:${Math.floor(timeoutEndDate.getTime() / 1000)}:F>`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: "Moderation Action", iconURL: message.guild.iconURL() })
        ]
      });
    } catch (error) {
      console.error('Error executing the timeout command:', error);

      let errorMessage = '<a:block:1326464261953818664> There was an error executing the timeout command.';
      if (error.code === 50013) {
        errorMessage = '<a:block:1326464261953818664> I do not have permission to timeout this user. Check my role hierarchy and permissions.';
      }

      message.reply({
        content: errorMessage,
        ephemeral: true
      });
    }
  },
};