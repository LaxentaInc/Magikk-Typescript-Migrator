const { PermissionsBitField } = require("discord.js");

module.exports = {
  name: "leave",
  description: "Makes the bot leave the server. (Restricted)",
  usage: "!leave",
  async execute(message) {
    const ownerId = "953527567808356404";

    // Check if the user is the server owner or has a specific admin role
    if (
      !message.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
      message.author.id !== message.guild.ownerId &&
      message.author.id !== ownerId
    ) {
      return message
        .reply("Only The owner of me can use this command @laxenta <a:e:1310498098107387974>")
        .then((reply) => {
          setTimeout(() => {
            message.delete().catch(() => {});
            reply.delete().catch(() => {});
          }, 3000);
        });
    }

    // Confirm the action
    const confirmationMessage = await message.reply(
      "<a:e:1310498074673811538> Are you sure you want the bot to leave this server? Reply with `yes` to confirm.",
    );
    setTimeout(() => message.delete().catch(() => {}), 5000);

    const filter = (response) =>
      response.author.id === message.author.id &&
      response.content.toLowerCase() === "yes";
    const collector = message.channel.createMessageCollector({
      filter,
      time: 5000,
      max: 1,
    });

    collector.on("collect", async (collectedMessage) => {
      collector.stop();
      collectedMessage.delete().catch(() => {});
      confirmationMessage.delete().catch(() => {});

      try {
        await message.guild.leave();
        console.log(`Bot has left the server ${message.guild.name}`);
      } catch (error) {
        console.error("Error leaving the server:", error);
        const errorMessage = await message.channel.send(
          "There was an error trying to make the bot leave the server. Please try again later.",
        );
        setTimeout(() => errorMessage.delete().catch(() => {}), 3000);
      }
    });

    collector.on("end", (collected) => {
      if (collected.size === 0) {
        confirmationMessage.delete().catch(() => {});
        message.channel
          .send("Cancelled.. i am again stuck in this lonely place... <a:heh:1310498074673811538>")
          .then((cancelMessage) => {
            setTimeout(() => cancelMessage.delete().catch(() => {}), 3000);
          });
      }
    });
  },
};
