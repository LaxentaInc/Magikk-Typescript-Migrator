const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, Collection, MessageFlags } = require('discord.js');
const mongoose = require('mongoose');

// cooldown collection
const cooldowns = new Collection();
const COOLDOWN_DURATION = 30000; // 30 seconds cooldown

// mongoose is already connected via index.js — no need to connect again

// AFK Schema with auto-cleanup after 24h (86400 seconds)
const afkSchema = new mongoose.Schema({
  guildId: String,
  userId: String,
  reason: String,
  timestamp: { type: Date, default: Date.now, expires: 86400 }
});
const AFK = mongoose.models.AFK || mongoose.model('AFK', afkSchema);

// Command Builder
const command = new SlashCommandBuilder()
  .setName('afk')
  .setDescription('Set your AFK status')
  .addStringOption(option =>
    option.setName('reason')
      .setDescription('Reason for going AFK')
      .setRequired(false)
  );

module.exports = {
  data: command,
  async execute(interaction) {
    try {
      // Cooldown check
      const cooldownKey = `${interaction.user.id}-afk`;
      const cooldownExpiration = cooldowns.get(cooldownKey);
      if (cooldownExpiration && Date.now() < cooldownExpiration) {
        const remainingTime = Math.ceil((cooldownExpiration - Date.now()) / 1000);
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF0000)
              .setDescription(`⏰ Please wait ${remainingTime} seconds before using AFK again.`)
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      // Check if user is already AFK
      const existingAfk = await AFK.findOne({
        guildId: interaction.guild.id,
        userId: interaction.user.id
      });
      if (existingAfk) {
        // Remove the AFK status if already set
        await AFK.deleteOne({
          guildId: interaction.guild.id,
          userId: interaction.user.id
        });

        // Remove from cache
        if (interaction.client.afkCache) {
          interaction.client.afkCache.delete(`${interaction.guild.id}-${interaction.user.id}`);
        }
        await resetNickname(interaction);
        cooldowns.delete(cooldownKey);
        const timeAFK = getTimeAFK(existingAfk.timestamp);
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x0000FF)
              .setDescription(`<a:yay:1327982490144735253> Welcome back ${interaction.user}! You were AFK for ${timeAFK}.`)
          ]
        });
      }

      // Set new AFK status
      const reason = interaction.options.getString('reason') || 'AFK';
      const newAfk = await AFK.create({
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        reason: reason
      });

      // Update cache
      if (interaction.client.afkCache) {
        interaction.client.afkCache.set(`${interaction.guild.id}-${interaction.user.id}`, newAfk);
      }
      // Set cooldown
      cooldowns.set(cooldownKey, Date.now() + COOLDOWN_DURATION);

      // Update nickname to include [AFK]
      await updateNickname(interaction);

      // Send confirmation
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x0000FF)
            .setDescription(`<a:kittycat:1333358006720794624> ${interaction.user} is now AFK: ${reason}`)
            .setFooter({ text: 'Send any message anywhere in the guild to remove your AFK status :3 Cya' })
        ]
      });

      // NOTE: Instead of setting up a channel-specific message collector here,
      // it's best to have a global message listener (in your main bot file) that checks for messages
      // from AFK users (by querying MongoDB) and then resets their status if they speak anywhere in the guild.
      // See the example snippet below.

    } catch (error) {
      console.error("AFK Command Error:", error);
      interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF0000)
            .setDescription('<a:kittycat:1333358006720794624> Unable to set your AFK status.')
        ],
        flags: MessageFlags.Ephemeral
      });
    }
  }
};

// Helper Functions

async function updateNickname(interaction) {
  const currentNickname = interaction.member.displayName;
  if (!currentNickname.includes('[AFK]')) {
    try {
      await interaction.member.setNickname(`[AFK] ${currentNickname}`);
    } catch (error) {
      console.warn('Unable to update nickname:', error);
    }
  }
}

async function resetNickname(interaction) {
  const currentNickname = interaction.member.displayName;
  if (currentNickname.includes('[AFK]')) {
    try {
      await interaction.member.setNickname(currentNickname.replace('[AFK] ', ''));
    } catch (error) {
      console.warn('Unable to reset nickname:', error);
    }
  }
}

function getTimeAFK(timestamp) {
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}