const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');
const axios = require('axios');
const { registerButton } = require('../../../handlers/buttonHandler.js');

const fs = require('fs');
const path = require('path');

// ========== gif cache ==========
const kissGifCache = {
  urls: [],
  lastFetch: 0,
  isLoading: false,
  CACHE_DURATION: 1000 * 60 * 30, // 30 minutes
  CACHE_SIZE: 100
};

// fill the cache in the background without blocking
const fillKissGifCache = () => {
  if (kissGifCache.isLoading) return;
  kissGifCache.isLoading = true;

  (async () => {
    try {
      const promises = [];
      for (let i = 0; i < kissGifCache.CACHE_SIZE; i++) {
        promises.push(
          axios.get('https://nekos.life/api/v2/img/kiss', { timeout: 5000 })
            .then(r => r.data.url)
            .catch(() => null)
        );
      }
      const results = (await Promise.all(promises)).filter(Boolean);
      if (results.length > 0) {
        kissGifCache.urls = results;
        kissGifCache.lastFetch = Date.now();
      }
    } catch (e) {
      // silent fail
    } finally {
      kissGifCache.isLoading = false;
    }
  })();
};

// kick off initial cache fill on load
fillKissGifCache();

// get a kiss gif url from cache or fetch one directly as fallback
const getKissGif = async () => {
  const now = Date.now();

  // refill cache if expired or running low
  if (now - kissGifCache.lastFetch > kissGifCache.CACHE_DURATION || kissGifCache.urls.length < 10) {
    fillKissGifCache();
  }

  // serve from cache instantly if available
  if (kissGifCache.urls.length > 0) {
    const idx = Math.floor(Math.random() * kissGifCache.urls.length);
    return kissGifCache.urls.splice(idx, 1)[0];
  }

  // fallback: direct fetch if cache is empty
  try {
    const response = await axios.get('https://nekos.life/api/v2/img/kiss', { timeout: 5000 });
    return response.data.url;
  } catch {
    return null;
  }
};

// ========== kiss counter ==========
const KISS_STATS_PATH = path.join(__dirname, '../../../data/kiss_stats.json');

// load kiss stats from json file
const loadKissStats = () => {
  try {
    if (!fs.existsSync(KISS_STATS_PATH)) {
      fs.writeFileSync(KISS_STATS_PATH, '{}', 'utf8');
      return {};
    }
    const data = fs.readFileSync(KISS_STATS_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
};

// save kiss stats to json file
const saveKissStats = (stats) => {
  try {
    fs.writeFileSync(KISS_STATS_PATH, JSON.stringify(stats, null, 2), 'utf8');
  } catch (e) {
    console.error('failed to save kiss stats:', e);
  }
};

// increment kiss count for a user pair
const incrementKissCount = (userId1, userId2) => {
  const stats = loadKissStats();
  const key = [userId1, userId2].sort().join(':');
  stats[key] = (stats[key] || 0) + 1;
  saveKissStats(stats);
  return stats[key];
};

// get ordinal suffix for numbers (1st, 2nd, 3rd, 4th, etc)
const getOrdinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kiss')
    .setDescription('Sends a random kiss to the specified user.')
    .setIntegrationTypes(0, 1) // Works in guilds and DMs
    .setContexts([0, 1, 2])    // Available in Guild, DM, and Voice contexts
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('The user to kiss')
        .setRequired(true)
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');

    // no self gooning
    if (targetUser.id === interaction.user.id) {
      return interaction.reply({
        content: `**${interaction.user.username}**, you cannot kiss yourself!`,
        flags: MessageFlags.Ephemeral
      });
    }

    const customIdKissBack = `kissBack_${interaction.id}`;
    const customIdSlap = `slap_${interaction.id}`;
    const customIdCuddle = `cuddle_${interaction.id}`;

    try {
      await interaction.deferReply();
      const gifUrl = await getKissGif();
      if (!gifUrl) {
        return interaction.editReply({
          content: 'Failed to fetch a kiss GIF :(',
        });
      }

      // increment kiss counter
      const kissCount = incrementKissCount(interaction.user.id, targetUser.id);
      const ordinalCount = getOrdinal(kissCount);

      const embed = new EmbedBuilder()
        .setDescription(
          `-# **${interaction.user.username}** kisses **${targetUser.username}!**\n` +
          `-# ***${interaction.user.username}** has kissed **${targetUser.username}** ${kissCount} ${kissCount === 1 ? 'time' : 'times'}.*`
        )
        .setImage(gifUrl);

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(customIdKissBack)
          .setLabel('uwu back~')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(customIdSlap)
          .setLabel('slap')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(customIdCuddle)
          .setLabel('coddle em!')
          .setStyle(ButtonStyle.Success)
      );
      await interaction.editReply({ embeds: [embed], components: [buttons] });

      /* -------------------- Button Handlers -------------------- */
      const removeButtons = async (btnInteraction) => {
        try {
          if (interaction.inGuild()) {
            // Fetch the channel and message if not in cache
            const channel = await interaction.client.channels.fetch(btnInteraction.channelId).catch(() => null);
            if (!channel) {
              console.warn('Channel not found for message edit');
              return;
            }
            const message = await channel.messages.fetch(btnInteraction.message.id).catch(() => null);
            if (!message) {
              console.warn('Message not found for button removal');
              return;
            }
            await message.edit({ components: [] });
          } else {
            await btnInteraction.editReply({ components: [] });
          }
        } catch (error) {
          console.error('Error removing buttons:', error);
        }
      };

      registerButton(customIdKissBack, [targetUser.id], async (btnInteraction) => {
        try {
          if (!btnInteraction.deferred && !btnInteraction.replied)
            await btnInteraction.deferUpdate();

          const kissBackGif = await getKissGif();
          if (!kissBackGif) throw new Error('No kiss back GIF available.');

          const kissBackEmbed = new EmbedBuilder()
            // .setColor('#ff69b4')
            .setTitle(`**${targetUser.username}** kisses **${interaction.user.username}** back!`)
            .setImage(kissBackGif)
            // .setFooter({
            //   text: 'A sweet smooch has been returned!',
            //   iconURL: targetUser.displayAvatarURL({ dynamic: true, size: 2048 })
            // });

          await removeButtons(btnInteraction);
          await btnInteraction.followUp({ embeds: [kissBackEmbed] });
        } catch (error) {
          console.error('Error in kiss back button:', error);
          await btnInteraction.followUp({
            content: 'Failed to process kiss back.',
            flags: MessageFlags.Ephemeral
          });
        }
      });

      // Handler for "Slap" button.
      registerButton(customIdSlap, [targetUser.id], async (btnInteraction) => {
        try {
          if (!btnInteraction.deferred && !btnInteraction.replied)
            await btnInteraction.deferUpdate();

          const slapRes = await axios.get('https://nekos.best/api/v2/slap', { timeout: 5000 });
          const slapGif = slapRes.data.results[0].url;
          if (!slapGif) throw new Error('No slap GIF available.');

          const slapEmbed = new EmbedBuilder()
            // .setColor('#ff0000')
            .setTitle(`**${targetUser.username}** slapped **${interaction.user.username}**! Ouch!`)
            .setImage(slapGif)
            .setFooter({
              text: 'That must have hurt lmao!',
              iconURL: targetUser.displayAvatarURL({ dynamic: true, size: 2048 })
            });

          await removeButtons(btnInteraction);
          await btnInteraction.followUp({ embeds: [slapEmbed] });
        } catch (error) {
          console.error('Error in slap button:', error);
          await btnInteraction.followUp({
            content: 'Failed to process slap.',
            flags: MessageFlags.Ephemeral
          });
        }
      });

      registerButton(customIdCuddle, [targetUser.id], async (btnInteraction) => {
        try {
          if (!btnInteraction.deferred && !btnInteraction.replied)
            await btnInteraction.deferUpdate();

          const cuddleRes = await axios.get('https://nekos.best/api/v2/cuddle', { timeout: 5000 });
          const cuddleGif = cuddleRes.data.results[0].url;

          if (!cuddleGif) throw new Error('No cuddle GIF available.');

          const cuddleEmbed = new EmbedBuilder()
            // .setColor('#ff69b4')
            .setTitle(`**${targetUser.username}** cuddles with **${interaction.user.username}**! So cozy!`)
            .setImage(cuddleGif)
            .setFooter({
              text: 'some cozy cuddles after kissie!.. Do not watch netflix now please...',
              iconURL: targetUser.displayAvatarURL({ dynamic: true, size: 2048 })
            });

          await removeButtons(btnInteraction);
          await btnInteraction.followUp({ embeds: [cuddleEmbed] });
        } catch (error) {
          console.error('Error in cuddle button:', error);
          await btnInteraction.followUp({
            content: 'Failed to process cuddle.',
            flags: MessageFlags.Ephemeral
          }).catch(() => { });
        }
      });
      /* ------------------ End of Button Handlers ------------------ */

    } catch (error) {
      console.error('Error executing kiss command:', error);
      const msg = { content: 'No kisses for you ;c' };
      if (interaction.deferred || interaction.replied) return interaction.editReply(msg);
      return interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
    }
  }
};