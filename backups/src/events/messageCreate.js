const { EmbedBuilder, Collection, MessageFlags, PermissionsBitField } = require('discord.js');
const mongoose = require('mongoose');
const errorHandler = require('../handlers/errorhandler');
const spamProtection = require('../modules/AntiSpam');
const { BOT_ID } = process.env;
const { logger, handleError } = require('../utils/logger');
const { handleAgentMessage } = require('../handlers/aiAgent');

// Guild prefix schema & model
const guildPrefixSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, required: true },
});
const GuildPrefix = mongoose.models.GuildPrefix || mongoose.model('GuildPrefix', guildPrefixSchema);

// AFK Schema & Model (auto expires after 24h)
const afkSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  reason: String,
  timestamp: { type: Date, default: Date.now, expires: 86400 } // 24h expiration
});
const AFK = mongoose.models.AFK || mongoose.model('AFK', afkSchema);

// Cooldown collection for commands
const cooldowns = new Collection();

// ========== PREFIX CACHE (PERFORMANCE OPTIMIZATION) ==========
const prefixCache = new Map();
const PREFIX_CACHE_TTL = 60000; // 1 minute cache

// mongoose is already connected via index.js — no redundant connection needed

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    try {
      // Ignore messages from bots (except our own) or non-guild messages.
      if (shouldIgnoreMessage(message)) return;
      if (!message.guild) return;

      // ===== SPAM PROTECTION CHECK (RUNS FIRST) =====
      // Ensure client is set (lazy initialization)
      if (!spamProtection.client && client) {
        spamProtection.setClient(client);
      }
      await spamProtection.handleMessage(message);
      // ============================================

      // Check bot permissions.
      // Check bot permissions.
      if (!message.channel.permissionsFor) {
        try {
          await message.channel.fetch();
        } catch (error) {
          logger.error(`Failed to fetch channel ${message.channel.id}: ${error.message}`);
          return;
        }
      }

      const botPerms = message.channel.permissionsFor(client.user);
      if (
        !botPerms ||
        !botPerms.has(PermissionsBitField.Flags.SendMessages) ||
        !botPerms.has(PermissionsBitField.Flags.EmbedLinks)
      ) {
        logger.warn(`Missing permissions in channel ${message.channel.id}`);
        return;
      }

      // --- Global AFK Check (Optimized with Cache) ---
      try {
        const afkKey = `${message.guild.id}-${message.author.id}`;

        // Fallback: Initialize cache if it doesn't exist (backwards compatibility)
        if (!client.afkCache) {
          console.log(`[AFK] Cache missing, initializing...`);
          client.afkCache = new Collection();
          try {
            const allAfk = await AFK.find({});
            allAfk.forEach(doc => client.afkCache.set(`${doc.guildId}-${doc.userId}`, doc));
            console.log(`[AFK] Loaded ${allAfk.length} AFK users into cache.`);
          } catch (err) {
            console.error(`[AFK] Failed to load cache:`, err.message);
          }
        }

        // Check cache (instant)
        if (client.afkCache.has(afkKey)) {
          const afkStatus = client.afkCache.get(afkKey);

          // Remove AFK status from DB and Cache
          await AFK.deleteOne({
            guildId: message.guild.id,
            userId: message.author.id,
          });
          client.afkCache.delete(afkKey);

          if (message.member && message.member.displayName.includes('[AFK]')) {
            try {
              await message.member.setNickname(message.member.displayName.replace('[AFK] ', ''));
            } catch (err) {
              logger.warn('Unable to reset nickname:', err.message);
            }
          }
          const timeAFK = getTimeAFK(afkStatus.timestamp);
          message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x00FF00)
                .setDescription(`<a:e:1333357974751678524> Welcome back ${message.author}! You were AFK for ${timeAFK}.`)
            ]
          });
        }
      } catch (error) {
        logger.error('AFK check error:', error.message);
      }
      // --- End AFK Check ---

      // Retrieve the guild prefix.
      const guildPrefix = await getPrefix(message.guild.id, client);

      // --- ai agent check (runs before prefix commands) ---
      try {
        const handled = await handleAgentMessage(message, client);
        if (handled) return; // agent handled it, skip normal command processing
      } catch (error) {
        logger.error('ai agent error:', error.message);
      }
      // --- end ai agent check ---

      // Only process messages starting with the prefix or a bot mention.
      if (!message.content.startsWith(guildPrefix)) {
        const mentionRegex = new RegExp(`^<@!?${client.user.id}>`);
        if (mentionRegex.test(message.content)) {
          message.content = message.content.replace(mentionRegex, guildPrefix).trim();
        } else {
          return;
        }
      }

      // Process the command.
      await processCommand(message, client, guildPrefix);
    } catch (error) {
      logger.error(`Error in messageCreate: ${error.message}`, {
        error,
        messageId: message.id,
        channelId: message.channel.id,
        guildId: message.guild?.id
      });
      await errorHandler.handle(error, 'messageCreate');
    }
  },
};

async function getPrefix(guildId, client) {
  // Fallback: Initialize cache if it doesn't exist
  if (!client.prefixCache) {
    console.log(`[Prefix] Cache missing, initializing...`);
    client.prefixCache = new Map();
    try {
      const allPrefixes = await GuildPrefix.find({});
      allPrefixes.forEach(doc => client.prefixCache.set(doc.guildId, doc.prefix));
      console.log(`[Prefix] Loaded ${allPrefixes.length} guild prefixes into cache.`);
    } catch (err) {
      console.error(`[Prefix] Failed to load cache:`, err.message);
    }
  }

  // Check cache
  if (client.prefixCache.has(guildId)) {
    return client.prefixCache.get(guildId);
  }
  return '!'; // Default fallback
}

function shouldIgnoreMessage(message) {
  return message.author.bot && message.author.id !== BOT_ID;
}

async function processCommand(message, client, guildPrefix) {
  const args = message.content.slice(guildPrefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();
  const command = client.prefixCommands.get(commandName);
  if (!command) return;

  // Permission check.
  if (command.permissions) {
    const authorPerms = message.channel.permissionsFor?.(message.author);
    if (!authorPerms || !authorPerms.has(command.permissions)) {
      await autoDeleteLog(message.channel, 'You do not have permission to use this command.');
      return;
    }
  }

  // Cooldown check.
  if (await isOnCooldown(message.author.id, command.name, command.cooldown || 1)) {
    await autoDeleteLog(message.channel, 'Please wait before using this command again.');
    return;
  }

  try {
    await command.execute(message, args, client);
  } catch (error) {
    logger.error(`Error executing command ${commandName}`, {
      error,
      command: commandName,
      userId: message.author.id,
      guildId: message.guild.id
    });
    await autoDeleteLog(message.channel, 'An error occurred while executing the command.');
    await errorHandler.handle(error, `Command: ${commandName}`);
  }
}

async function isOnCooldown(userId, action, cooldownInSeconds) {
  const key = `${userId}-${action}`;
  const now = Date.now();
  const cooldownAmount = cooldownInSeconds * 1000;

  if (cooldowns.has(key)) {
    const expirationTime = cooldowns.get(key) + cooldownAmount;
    if (now < expirationTime) return true;
  }

  cooldowns.set(key, now);
  setTimeout(() => cooldowns.delete(key), cooldownAmount);
  return false;
}

async function autoDeleteLog(channel, content, deleteAfter = 3000) {
  try {
    const logMessage = await channel.send({
      content,
      allowedMentions: { parse: [] }
    });
    setTimeout(() => logMessage.delete().catch(() => { }), deleteAfter);
  } catch (error) {
    logger.error(`Error sending auto-delete message: ${error.message}`, {
      channelId: channel.id,
      content
    });
  }
}

function getTimeAFK(timestamp) {
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}