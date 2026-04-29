const { PermissionsBitField } = require("discord.js");

module.exports = {
  name: "lock",
  description:
    "Lock the current channel to prevent everyone from sending messages",
  async execute(message, args) {
    if (
      !message.member.permissions.has(PermissionsBitField.Flags.Administrator)
    ) {
      return message.reply("You do not have permission to use this command!");
    }

    const channel = message.channel;

    await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
      SendMessages: false,
    });

    await message.channel.send(
      `This channel has been locked by ${message.author.username}.`,
    );
  },
};
