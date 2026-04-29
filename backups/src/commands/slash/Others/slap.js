const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


const getSlapGif = async () => {
  try { const r = await axios.get('https://nekos.best/api/v2/slap', { timeout: 5000 }); return r.data.results[0].url; } catch { return null; }
};


// ========== counter ==========
const SLAP_STATS_PATH = path.join(__dirname, '../../../data/slap_stats.json');
const loadStats = () => { try { if (!fs.existsSync(SLAP_STATS_PATH)) { fs.writeFileSync(SLAP_STATS_PATH, '{}', 'utf8'); return {}; } return JSON.parse(fs.readFileSync(SLAP_STATS_PATH, 'utf8')); } catch { return {}; } };
const saveStats = (s) => { try { fs.writeFileSync(SLAP_STATS_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { console.error('failed to save slap stats:', e); } };
const incrementCount = (id1, id2) => { const s = loadStats(); const k = [id1, id2].sort().join(':'); s[k] = (s[k] || 0) + 1; saveStats(s); return s[k]; };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slap')
    .setDescription('Slap someone playfully!')
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('The user you want to slap')
        .setRequired(true)
    )
    .setDMPermission(true)
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2),
  async execute(interaction) {
    const userToSlap = interaction.options.getUser('target');

    if (userToSlap.id === interaction.user.id) {
      return interaction.reply({ content: "you can't slap yourself! that's just sad...", ephemeral: true });
    }

    await interaction.deferReply();
    try {
      const slapGif = await getSlapGif();
      if (!slapGif) return interaction.editReply({ content: 'couldn\'t fetch a slap gif. try again later!' });

      const count = incrementCount(interaction.user.id, userToSlap.id);

      const embed = new EmbedBuilder()
        .setDescription(
          `-# **${interaction.user.username}** gives **${userToSlap.username}** a big slap!**\n` +
          `-# ***${interaction.user.username}** has slapped **${userToSlap.username}** ${count} ${count === 1 ? 'time' : 'times'}.*`
        )
        .setImage(slapGif);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(`error fetching slap gif: ${error.message}`);
      await interaction.editReply({ content: 'couldn\'t fetch a slap gif. pls die of embarrassment!' });
    }
  },
};