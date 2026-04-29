const { PermissionsBitField } = require("discord.js");

module.exports = {
  name: "unlock",
  description:
    "Unlocks the specified channel or the current channel if no argument is provided.",
  usage: "!unlock [channel]",
  async execute(message, args) {
    if (
      !message.member.permissions.has(PermissionsBitField.Flags.Administrator)
    ) {
      return message.reply("You do not have permission to use this command.");
    }

    const channel = message.mentions.channels.first() || message.channel;

    await unlockChannel(channel);
    await message.reply(`Channel ${channel.name} has been unlocked.`);
  },
};

async function unlockChannel(channel) {
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
    ViewChannel: true,
    SendMessages: true,
  });
  console.log(`Unlocked channel ${channel.name} in guild ${channel.guild.id}`);
}
