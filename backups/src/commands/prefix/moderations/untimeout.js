const { PermissionsBitField } = require('discord.js');

module.exports = {
  name: 'untimeout',
  description: 'Removes a timeout from a user',

  async execute(message, args) {
    try {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply('You do not have permission to use this command.');
      }
      const user = message.mentions.members.first();
      if (!user) {
        return message.reply('Please mention a user to remove their timeout.');
      }
      const botMember = await message.guild.members.fetch(message.client.user.id);
      if (!botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply('I do not have permission to remove timeouts.');
      }
      await user.timeout(null);
      message.reply(`The timeout has been revoked from ${user.user.tag}!`);

    } catch (err) {
      console.error(err);
      message.reply('An error occurred while trying to remove the timeout.');
    }
  },
};