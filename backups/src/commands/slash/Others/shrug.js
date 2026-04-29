const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


const getShrugGif = async () => {
  try { const r = await axios.get('https://nekos.best/api/v2/shrug', { timeout: 5000 }); return r.data.results[0].url; } catch { return null; }
};


// ========== counter ==========
const SHRUG_STATS_PATH = path.join(__dirname, '../../../data/shrug_stats.json');
const loadStats = () => { try { if (!fs.existsSync(SHRUG_STATS_PATH)) { fs.writeFileSync(SHRUG_STATS_PATH, '{}', 'utf8'); return {}; } return JSON.parse(fs.readFileSync(SHRUG_STATS_PATH, 'utf8')); } catch { return {}; } };
const saveStats = (s) => { try { fs.writeFileSync(SHRUG_STATS_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { console.error('failed to save shrug stats:', e); } };
const incrementCount = (id1, id2) => { const s = loadStats(); const k = [id1, id2].sort().join(':'); s[k] = (s[k] || 0) + 1; saveStats(s); return s[k]; };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shrug')
    .setDescription('Shrug at someone ¯\\_(ツ)_/¯')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user you want to shrug at')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Whether to make the response visible only to you (default: false)')
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    const isEphemeral = interaction.options.getBoolean('ephemeral') || false;

    await interaction.deferReply({ ephemeral: isEphemeral });
    try {
      const shrugGif = await getShrugGif();
      if (!shrugGif) return interaction.editReply({ content: 'no shrugs!' });

      let desc;
      if (targetUser && targetUser.id !== interaction.user.id) {
        const count = incrementCount(interaction.user.id, targetUser.id);
        desc = `-# **${interaction.user.username}** shrugs at **${targetUser.username}...** ¯\\_(ツ)_/¯`;
      } else {
        desc = `-# **${interaction.user.username}** shrugs... ¯\\_(ツ)_/¯`;
      }

      const embed = new EmbedBuilder()
        .setDescription(desc)
        .setImage(shrugGif);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(`error fetching shrug gif: ${error.message}`);
      return interaction.editReply({ content: 'no shrugs!' });
    }
  }
};