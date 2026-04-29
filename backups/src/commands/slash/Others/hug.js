// path: commands/hug.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ========== gif cache ==========
const hugGifCache = {
  urls: [],
  lastFetch: 0,
  isLoading: false,
  CACHE_DURATION: 1000 * 60 * 30, // 30 minutes
  CACHE_SIZE: 100
};

// fill the cache in the background without blocking
const fillHugGifCache = () => {
  if (hugGifCache.isLoading) return;
  hugGifCache.isLoading = true;

  (async () => {
    try {
      const promises = [];
      for (let i = 0; i < hugGifCache.CACHE_SIZE; i++) {
        promises.push(
          axios.get('https://nekos.best/api/v2/hug', { timeout: 5000 })
            .then(r => r.data.results[0].url)
            .catch(() => null)
        );
      }
      const results = (await Promise.all(promises)).filter(Boolean);
      if (results.length > 0) {
        hugGifCache.urls = results;
        hugGifCache.lastFetch = Date.now();
      }
    } catch (e) {
      // silent fail
    } finally {
      hugGifCache.isLoading = false;
    }
  })();
};

// kick off initial cache fill on load
fillHugGifCache();

// get a hug gif url from cache or fetch one directly as fallback
const getHugGif = async () => {
  const now = Date.now();

  // refill cache if expired or running low
  if (now - hugGifCache.lastFetch > hugGifCache.CACHE_DURATION || hugGifCache.urls.length < 10) {
    fillHugGifCache();
  }

  // serve from cache instantly if available
  if (hugGifCache.urls.length > 0) {
    const idx = Math.floor(Math.random() * hugGifCache.urls.length);
    return hugGifCache.urls.splice(idx, 1)[0];
  }

  // fallback: direct fetch if cache is empty
  try {
    const response = await axios.get('https://nekos.best/api/v2/hug', { timeout: 5000 });
    return response.data.results[0].url;
  } catch {
    return null;
  }
};

// ========== hug counter ==========
const HUG_STATS_PATH = path.join(__dirname, '../../../data/hug_stats.json');

// load hug stats from json file
const loadHugStats = () => {
  try {
    if (!fs.existsSync(HUG_STATS_PATH)) {
      fs.writeFileSync(HUG_STATS_PATH, '{}', 'utf8');
      return {};
    }
    const data = fs.readFileSync(HUG_STATS_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
};

// save hug stats to json file
const saveHugStats = (stats) => {
  try {
    fs.writeFileSync(HUG_STATS_PATH, JSON.stringify(stats, null, 2), 'utf8');
  } catch (e) {
    console.error('failed to save hug stats:', e);
  }
};

// increment hug count for a user pair
const incrementHugCount = (userId1, userId2) => {
  const stats = loadHugStats();
  const key = [userId1, userId2].sort().join(':');
  stats[key] = (stats[key] || 0) + 1;
  saveHugStats(stats);
  return stats[key];
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hug')
    .setDescription('Hug someone warmly!')
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('The user you want to hug')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Whether to make the response visible only to you (default: false)')
    )
    .setIntegrationTypes(0, 1) // guild and dm integrations
    .setContexts(0, 1, 2), // guild, dm, and voice contexts
  async execute(interaction) {
    const userToHug = interaction.options.getUser('target');
    const isEphemeral = interaction.options.getBoolean('ephemeral') || false;

    await interaction.deferReply({ ephemeral: isEphemeral });

    try {
      const hugGif = await getHugGif();
      if (!hugGif) {
        return interaction.editReply({
          content: 'couldn\'t fetch the hug gif. try again later!',
        });
      }

      // increment hug counter
      const hugCount = incrementHugCount(interaction.user.id, userToHug.id);

      const embed = new EmbedBuilder()
        .setDescription(
          `-# **${interaction.user.username}** gives **${userToHug.username}** a warm hug!**\n` +
          `-# ***${interaction.user.username}** has hugged **${userToHug.username}** ${hugCount} ${hugCount === 1 ? 'time' : 'times'}.*`
        )
        .setImage(hugGif);

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      console.error(`error fetching hug gif: ${error.message}`);
      await interaction.editReply({
        content: 'couldn\'t fetch the hug gif. try again later!',
      });
    }
  },
};