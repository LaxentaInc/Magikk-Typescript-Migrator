const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


const getHappyGif = async () => {
  try { const r = await axios.get('https://nekos.best/api/v2/happy', { timeout: 5000 }); return r.data.results[0].url; } catch { return null; }
};


// ========== counter ==========
const HAPPY_STATS_PATH = path.join(__dirname, '../../../data/happy_stats.json');
const loadStats = () => { try { if (!fs.existsSync(HAPPY_STATS_PATH)) { fs.writeFileSync(HAPPY_STATS_PATH, '{}', 'utf8'); return {}; } return JSON.parse(fs.readFileSync(HAPPY_STATS_PATH, 'utf8')); } catch { return {}; } };
const saveStats = (s) => { try { fs.writeFileSync(HAPPY_STATS_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { console.error('failed to save happy stats:', e); } };
const incrementCount = (id1, id2) => { const s = loadStats(); const k = [id1, id2].sort().join(':'); s[k] = (s[k] || 0) + 1; saveStats(s); return s[k]; };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('happy')
    .setDescription("Because I'm happy...")
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to share your happiness with (optional)')
        .setRequired(false)
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');

    await interaction.deferReply();
    try {
      const happyGif = await getHappyGif();
      if (!happyGif) {
        return interaction.editReply({ content: 'u cant be happy', flags: MessageFlags.Ephemeral });
      }

      let desc;
      if (targetUser && targetUser.id !== interaction.user.id) {
        const count = incrementCount(interaction.user.id, targetUser.id);
        desc = `happy happy!`;
      } else {
        desc = `happy happy!`;
      }

      const embed = new EmbedBuilder()
        .setDescription(desc)
        .setImage(happyGif);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(`error executing happy command: ${error.message}`);
      return interaction.editReply({ content: 'damn error came! not like anyone gaf', flags: MessageFlags.Ephemeral });
    }
  },
};