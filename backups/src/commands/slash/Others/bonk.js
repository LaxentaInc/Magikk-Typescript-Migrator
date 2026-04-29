const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


const getBonkGif = async () => {
  try { const r = await axios.get('https://nekos.best/api/v2/pat', { timeout: 5000 }); return r.data.results[0].url; } catch { return null; }
};


// ========== counter ==========
const BONK_STATS_PATH = path.join(__dirname, '../../../data/bonk_stats.json');
const loadStats = () => { try { if (!fs.existsSync(BONK_STATS_PATH)) { fs.writeFileSync(BONK_STATS_PATH, '{}', 'utf8'); return {}; } return JSON.parse(fs.readFileSync(BONK_STATS_PATH, 'utf8')); } catch { return {}; } };
const saveStats = (s) => { try { fs.writeFileSync(BONK_STATS_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { console.error('failed to save bonk stats:', e); } };
const incrementCount = (id1, id2) => { const s = loadStats(); const k = [id1, id2].sort().join(':'); s[k] = (s[k] || 0) + 1; saveStats(s); return s[k]; };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bonk')
    .setDescription('Bonk someone : 3 for being naughti!')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('The user you want to bonk')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Whether to make the response visible only to you (default: false)')
    ),
  async execute(interaction) {
    const userToBonk = interaction.options.getUser('target');
    const isEphemeral = interaction.options.getBoolean('ephemeral') || false;

    await interaction.deferReply({ ephemeral: isEphemeral });
    try {
      const bonkGif = await getBonkGif();
      if (!bonkGif) return interaction.editReply({ content: 'couldn\'t fetch the bonk gif. try again later!' });

      const count = incrementCount(interaction.user.id, userToBonk.id);

      const embed = new EmbedBuilder()
        .setDescription(
          `-# **${interaction.user.username}** bonks **${userToBonk.username}!**\n` +
          `-# ***${interaction.user.username}** has bonked **${userToBonk.username}** ${count} ${count === 1 ? 'time' : 'times'}.*`
        )
        .setImage(bonkGif);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(`error fetching bonk gif: ${error.message}`);
      await interaction.editReply({ content: 'couldn\'t fetch the bonk gif. try again later!' });
    }
  },
};