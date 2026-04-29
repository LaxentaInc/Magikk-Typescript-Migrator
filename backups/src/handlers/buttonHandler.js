const { Collection, ActionRowBuilder, ButtonBuilder, MessageFlags, ChannelType } = require('discord.js');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const interactionSchema = new mongoose.Schema({
  customId: { type: String, required: true, unique: true },
  userIds: [String],
  createdAt: { type: Date, default: Date.now },
  handlerData: {
    type: {
      type: String,
      enum: ['basic', 'custom'],
      default: 'basic'
    },
    options: mongoose.Schema.Types.Mixed
  }
});

const Interaction = mongoose.model('Interaction', interactionSchema);

const handlers = new Collection();
const cooldowns = new Collection();
const COOLDOWN_DURATION = 10; // 10ms cooldown 
// Extended expiry so important moderation buttons (e.g. AntiNuke actions) stay usable for longer.
// 8 hours = 8 * 60 * 60 * 1000 ms
const EXPIRY_DURATION = 8 * 60 * 60 * 1000;
const CLEANUP_INTERVAL = 10 * 60 * 1000; // Cleanup every 10 minutes

// Utility class for DM operations
class DMChannelUtils {
  static async safeMessageEdit(message, data) {
    try {
      return await message.edit(data);
    } catch (error) {
      if (error.code === 50001) { // Missing Access
        logger.warn(`Missing access for DM message edit: ${error.message}`);
        return null;
      }
      throw error;
    }
  }

  static async safeMessageDelete(message) {
    try {
      return await message.delete();
    } catch (error) {
      if (error.code === 50001) { // Missing Access
        logger.warn(`Missing access for DM message delete: ${error.message}`);
        return null;
      }
      throw error;
    }
  }
}

/**
 * Registers a button handler with MongoDB persistence.
 * 
 * This function now checks if the second parameter is a function (i.e. if the caller
 * omitted authorizedIds), and adjusts accordingly.
 */
async function registerButton(customId, authorizedIds = [], callback, options = {}) {
  // Patch: if authorizedIds is actually a function, shift the parameters.
  if (typeof authorizedIds === 'function') {
    callback = authorizedIds;
    authorizedIds = [];
  }

  try {
    const handlerData = {
      type: options.type || 'basic',
      options: options
    };

    // Store in memory
    handlers.set(customId, {
      callback,
      authorizedIds,
      handlerData
    });

    // Store in MongoDB
    await Interaction.findOneAndUpdate(
      { customId },
      {
        customId,
        userIds: authorizedIds,
        handlerData,
        createdAt: new Date()
      },
      { upsert: true }
    );

    return customId;
  } catch (error) {
    logger.error(`Error registering button "${customId}": ${error.message}`);
    throw error;
  }
}

/**
 * Updates the original message to disable the expired/unknown button.
 */
async function updateMessageButtons(message, targetCustomId) {
  try {
    const updatedComponents = message.components.map(row => {
      const newRow = new ActionRowBuilder();
      const updatedButtons = row.components.map(button => {
        const newButton = ButtonBuilder.from(button);
        if (button.customId === targetCustomId) {
          newButton.setDisabled(true);
        }
        return newButton;
      });
      return newRow.addComponents(updatedButtons);
    });

    if (message.channel?.type === ChannelType.DM) {
      // For DMs, use webhook if available, fallback to interaction update
      if (message.interaction?.webhook) {
        await message.interaction.webhook.editMessage(message.id, { components: updatedComponents });
      } else {
        await message.interaction?.update({ components: updatedComponents }).catch(() => {
          logger.warn('Failed to update DM message buttons');
        });
      }
    } else {
      await message.edit({ components: updatedComponents });
    }
    return true;
  } catch (error) {
    logger.error(`Failed to update message buttons: ${error.message}`);
    return false;
  }
}

/**
 * Handles expired/unknown buttons silently by disabling them.
 */
async function handleExpiredButton(interaction) {
  try {
    // Disable the button on the original message
    await updateMessageButtons(interaction.message, interaction.customId);
    // Acknowledge the interaction silently
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => { });
    }
    // Remove the button from the database
    await Interaction.deleteOne({ customId: interaction.customId });
  } catch (error) {
    logger.error(`Failed to handle expired button: ${error.message}`);
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => { });
    }
  }
}

/**
 * Handles button interactions globally, including DM-specific behavior.
 */
async function handleButton(interaction) {
  if (!interaction.isButton()) return;

  const customId = interaction.customId;

  // Query the database to check if the button is expired.
  let interactionDoc = null;
  try {
    interactionDoc = await Interaction.findOne({ customId });
  } catch (dbError) {
    logger.error(`DB error while fetching interaction for ${customId}: ${dbError.message}`);
  }

  // If no document is found or it has expired, disable the button.
  if (!interactionDoc || (Date.now() - new Date(interactionDoc.createdAt).getTime() > EXPIRY_DURATION)) {
    await handleExpiredButton(interaction);
    return;
  }

  // Retrieve handler data from memory
  const handlerData = handlers.get(customId);
  if (!handlerData) {
    await handleExpiredButton(interaction);
    return;
  }

  const { callback, authorizedIds } = handlerData;
  // Ensure authorizedIds is always an array
  const validAuthorizedIds = Array.isArray(authorizedIds) ? authorizedIds : [];
  const isDM = interaction.channel?.type === ChannelType.DM;

  // Authorization check: if the user is not allowed, reply with an ephemeral message.
  if (validAuthorizedIds.length && !validAuthorizedIds.includes(interaction.user.id)) {
    if (!interaction.replied) {
      try {
        await interaction.reply({
          content: "Listen, you cannot click someone else's command button. Do the command yourself to use buttons, e.g. </search:1342786347726802944>.",
          ephemeral: true
        });
      } catch (error) {
        if (!interaction.deferred) {
          await interaction.deferUpdate().catch(() => { });
        }
      }
    }
    return;
  }

  // Cooldown check for button spam
  if (cooldowns.has(`${customId}-${interaction.user.id}`)) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => { });
    }
    return;
  }

  try {
    cooldowns.set(`${customId}-${interaction.user.id}`, Date.now());
    setTimeout(() => cooldowns.delete(`${customId}-${interaction.user.id}`), COOLDOWN_DURATION);

    if (isDM) {
      // await interaction.deferUpdate().catch(() => { });

      await callback(interaction);
    } else {
      // Normal server channel handling
      await callback(interaction);
    }
  } catch (error) {
    logger.error(`Button error "${customId}": ${error.message}`);
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => { });
    }
    try {
      await interaction.followUp({
        content: 'An error occurred while processing your request.',
        ephemeral: true
      });
    } catch (followUpError) {
      logger.error(`Failed to send error message: ${followUpError.message}`);
    }
  }
}

/**
 * Reload button handlers from the database on startup.
 */
async function reloadHandlers() {
  try {
    const interactions = await Interaction.find({});
    for (const interactionDoc of interactions) {
      const { customId, userIds, handlerData } = interactionDoc;
      // Create a callback based on handler type
      let callback;
      if (handlerData.type === 'basic') {
        callback = async (interaction) => {
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate().catch(() => { });
          }
        };
      } else {
        // For custom handlers, use a placeholder callback that can be updated later
        callback = async (interaction) => {
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate().catch(() => { });
          }
        };
      }
      // Prevent overwriting handlers that were registered (e.g. by modules) while DB was loading
      if (!handlers.has(customId)) {
        handlers.set(customId, {
          callback,
          // Ensure userIds is an array
          authorizedIds: Array.isArray(userIds) ? userIds : [],
          handlerData
        });
      }
    }
    logger.info(`Reloaded ${interactions.length} button handlers from the database`);
  } catch (error) {
    logger.error(`Error reloading button handlers: ${error.message}`);
  }
}

// Cleanup expired interactions from the database on an interval.
setInterval(async () => {
  try {
    const expiryDate = new Date(Date.now() - EXPIRY_DURATION);
    const result = await Interaction.deleteMany({ createdAt: { $lt: expiryDate } });
    if (result.deletedCount > 0) {
      logger.info(`Cleaned up ${result.deletedCount} expired interactions`);
    }
  } catch (error) {
    logger.error(`Cleanup error: ${error.message}`);
  }
}, CLEANUP_INTERVAL);

// Reload handlers on startup.
reloadHandlers();

module.exports = {
  registerButton,
  handleButton,
  handlers,
  Interaction // Export the model for external use
};