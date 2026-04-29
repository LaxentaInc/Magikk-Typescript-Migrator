const { logger } = require("../../../utils/logger");

module.exports = {
  name: "say",
  description: "Repeats the input message",
  async execute(message, args) {
    try {
      // Delete the user's message immediately
      await message.delete().catch((err) => {
        logger.warn(`Failed to delete message from ${message.author.tag}: ${err.message}`);
      });

      // Check permissions
      if (!message.member.permissions.has("ADMINISTRATOR")) {
        logger.warn(
          `User ${message.author.tag} tried to use the say command without sufficient permissions in ${message.guild.name}.`
        );
        return message.channel.send("You do not have permission to use this command!");
      }

      // Prepare the echo message
      const echoMessage = args.join(" ");
      if (!echoMessage) {
        logger.warn(`No message provided for say command by ${message.author.tag}.`);
        return message.channel.send("You need to provide a message to repeat!");
      }

      // Send the echo message
      await message.channel.send(echoMessage);
      logger.info(`Echoed message for ${message.author.tag}: "${echoMessage}"`);
    } catch (error) {
      logger.error("Error executing the say command:");
      logger.error(error.stack || error.message);
      message.channel
        .send("<a:block:1084349801346367518> There was an error executing the say command.")
        .catch((err) => logger.error(`Failed to send error message: ${err.message}`));
    }
  },
};