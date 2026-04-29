const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ========== gif cache ==========
const cuddleGifCache = {
  urls: [],
  lastFetch: 0,
  isLoading: false,
  CACHE_DURATION: 1000 * 60 * 30, // 30 minutes
  CACHE_SIZE: 100
};

// fill the cache in the background without blocking
const fillCuddleGifCache = () => {
  if (cuddleGifCache.isLoading) return;
  cuddleGifCache.isLoading = true;

  (async () => {
    try {
      const promises = [];
      for (let i = 0; i < cuddleGifCache.CACHE_SIZE; i++) {
        promises.push(
          axios.get('https://nekos.best/api/v2/cuddle', { timeout: 5000 })
            .then(r => r.data.results[0].url)
            .catch(() => null)
        );
      }
      const results = (await Promise.all(promises)).filter(Boolean);
      if (results.length > 0) {
        cuddleGifCache.urls = results;
        cuddleGifCache.lastFetch = Date.now();
      }
    } catch (e) {
      // silent fail
    } finally {
      cuddleGifCache.isLoading = false;
    }
  })();
};

// kick off initial cache fill on load
fillCuddleGifCache();

// get a cuddle gif url from cache or fetch one directly as fallback
const getCuddleGif = async () => {
  const now = Date.now();

  // refill cache if expired or running low
  if (now - cuddleGifCache.lastFetch > cuddleGifCache.CACHE_DURATION || cuddleGifCache.urls.length < 10) {
    fillCuddleGifCache();
  }

  // serve from cache instantly if available
  if (cuddleGifCache.urls.length > 0) {
    const idx = Math.floor(Math.random() * cuddleGifCache.urls.length);
    return cuddleGifCache.urls.splice(idx, 1)[0];
  }

  // fallback: direct fetch if cache is empty
  try {
    const response = await axios.get('https://nekos.best/api/v2/cuddle', { timeout: 5000 });
    return response.data.results[0].url;
  } catch {
    return null;
  }
};

// ========== cuddle counter ==========
const CUDDLE_STATS_PATH = path.join(__dirname, '../../../data/cuddle_stats.json');

// load cuddle stats from json file
const loadCuddleStats = () => {
  try {
    if (!fs.existsSync(CUDDLE_STATS_PATH)) {
      fs.writeFileSync(CUDDLE_STATS_PATH, '{}', 'utf8');
      return {};
    }
    const data = fs.readFileSync(CUDDLE_STATS_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
};

// save cuddle stats to json file
const saveCuddleStats = (stats) => {
  try {
    fs.writeFileSync(CUDDLE_STATS_PATH, JSON.stringify(stats, null, 2), 'utf8');
  } catch (e) {
    console.error('failed to save cuddle stats:', e);
  }
};

// increment cuddle count for a user pair
const incrementCuddleCount = (userId1, userId2) => {
  const stats = loadCuddleStats();
  const key = [userId1, userId2].sort().join(':');
  stats[key] = (stats[key] || 0) + 1;
  saveCuddleStats(stats);
  return stats[key];
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cuddle')
    .setDescription('Cuddle with someone!')
    .setIntegrationTypes(0, 1) // guild and dm integrations
    .setContexts(0, 1, 2) // guild, dm, and voice contexts
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to cuddle with')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Whether to make the response visible only to you (default: false)')
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    const isEphemeral = interaction.options.getBoolean('ephemeral') || false;

    // prevent users from cuddling themselves
    if (targetUser.id === interaction.user.id) {
      return interaction.reply({
        content: "you can't cuddle yourself! try cuddling someone else.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: isEphemeral });

    try {
      const cuddleGif = await getCuddleGif();
      if (!cuddleGif) {
        return interaction.editReply({
          content: 'there was an error fetching the cuddle gif. please try again later!',
        });
      }

      // increment cuddle counter
      const cuddleCount = incrementCuddleCount(interaction.user.id, targetUser.id);

      const embed = new EmbedBuilder()
        .setDescription(
          `-# **${interaction.user.username}** cuddles with **${targetUser.username}!**\n` +
          `-# ***${interaction.user.username}** has cuddled with **${targetUser.username}** ${cuddleCount} ${cuddleCount === 1 ? 'time' : 'times'}.*`
        )
        .setImage(cuddleGif);

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      console.error(`error executing the cuddle command: ${error.message}`);
      return interaction.editReply({
        content: 'there was an error executing that command. please try again later!',
      });
    }
  }
};