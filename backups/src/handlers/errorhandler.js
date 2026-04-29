const Discord = require('discord.js');
const { red, yellow } = require('colorette'); // Using colorette for colorful logs
const { logger } = require('../utils/logger');

module.exports = {
  handle: async (error, source, interaction) => {
    // Prevent double handling of the same error.
    if (error._handled) return;
    error._handled = true;

    // Log the full error stack trace in red for easy visibility.
    logger.error(red(`Error in ${source}: ${error.message}\nStack trace:\n${error.stack}`));

    // Handle Discord API errors.
    if (error instanceof Discord.DiscordAPIError) {
      logger.error(red(`Discord API Error: ${error.message} (Code: ${error.code})`));
      switch (error.code) {
        case 50013:
          logger.error(red('Missing Permissions.'));
          break;
        case 50007:
          logger.warn(yellow('Cannot message user (DMs likely disabled).'));
          break;
        case 10062:
          logger.warn(yellow('Unknown interaction: Possibly expired.'));
          break;
        case 50035:
          logger.error(red('Invalid Form Body: Check interaction payload or message structure.'));
          break;
        default:
          logger.error(red(`Unhandled API error code: ${error.code}`));
      }
      if (interaction && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: 'A Discord API error occurred. Please try again later!',
            ephemeral: true,
          });
        } catch (replyError) {
          logger.error(red(`Error sending fallback reply: ${replyError.message}`));
        }
      }
      return;
    }

    // Handle specific error messages.
    if (error.message?.includes('rate limit')) {
      logger.warn(yellow('Hit rate limit. Consider implementing retry logic.'));
      if (interaction && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: 'Rate limit hit. Please try again later!',
            ephemeral: true,
          });
        } catch (replyError) {
          logger.error(red(`Error sending fallback reply: ${replyError.message}`));
        }
      }
      return;
    } else if (error.message?.includes('timeout')) {
      logger.warn(yellow('Timeout error detected.'));
      if (interaction && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: 'Request timed out. Please try again later!',
            ephemeral: true,
          });
        } catch (replyError) {
          logger.error(red(`Error sending fallback reply: ${replyError.message}`));
        }
      }
      return;
    } else if (error.message?.includes('connection')) {
      logger.error(red('Connection error detected.'));
      if (interaction && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: 'Connection error occurred. Please try again later!',
            ephemeral: true,
          });
        } catch (replyError) {
          logger.error(red(`Error sending fallback reply: ${replyError.message}`));
        }
      }
      return;
    }

    // Handle button expiration error.
    if (error.message === 'This button has expired. Please try again.') {
      if (interaction && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: 'This button has expired. Please try again.',
            ephemeral: true,
          });
        } catch (replyError) {
          logger.error(red(`Error sending fallback reply: ${replyError.message}`));
        }
      }
      return;
    }

    // Default error handling: reply if the interaction hasn't been responded to yet.
    if (interaction && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: 'An unexpected error occurred. Please try again later!',
          ephemeral: true,
        });
      } catch (replyError) {
        logger.error(red(`Error sending fallback reply: ${replyError.message}`));
      }
    }

    // Log unhandled errors as a final catch-all.
    logger.error(red(`Unhandled error: ${error.name} - ${error.message}\nStack trace:\n${error.stack}`));
  },

  handleUnknownInteraction: (interaction) => {
    logger.warn(yellow(`Unknown interaction detected: ${interaction.type}`));
  },

  handleUnknownMessage: (message) => {
    logger.warn(yellow(`Unknown message received: ${message.content}`));
  },
};

// Global Error Handlers
process.on('unhandledRejection', (reason, promise) => {
  logger.error(red(`Unhandled Rejection at: ${promise}\nReason: ${reason}`));
});

process.on('uncaughtException', (error) => {
  logger.error(red(`Uncaught Exception: ${error.message}\nStack trace:\n${error.stack}`));
  // Uncomment the following line to exit the process after a fatal error.
  // process.exit(1);
});