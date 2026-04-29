const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


const getSleepGif = async () => {
  try { const r = await axios.get('https://nekos.best/api/v2/sleep', { timeout: 5000 }); return r.data.results[0].url; } catch { return null; }
};


// ========== counter ==========
const SLEEP_STATS_PATH = path.join(__dirname, '../../../data/sleep_stats.json');
const loadStats = () => { try { if (!fs.existsSync(SLEEP_STATS_PATH)) { fs.writeFileSync(SLEEP_STATS_PATH, '{}', 'utf8'); return {}; } return JSON.parse(fs.readFileSync(SLEEP_STATS_PATH, 'utf8')); } catch { return {}; } };
const saveStats = (s) => { try { fs.writeFileSync(SLEEP_STATS_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { console.error('failed to save sleep stats:', e); } };
const incrementCount = (id1, id2) => { const s = loadStats(); const k = [id1, id2].sort().join(':'); s[k] = (s[k] || 0) + 1; saveStats(s); return s[k]; };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sleep')
    .setDescription('Zzz...')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to INNOCENTLY ;-; sleep with (optional)')
        .setRequired(false)
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    let components = [];

    // rickroll button if targeting someone
    if (targetUser && targetUser.id !== interaction.user.id) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Surprise!')
          .setStyle(ButtonStyle.Link)
          .setURL('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
      );
      components.push(row);
    }

    await interaction.deferReply();
    try {
      const sleepGif = await getSleepGif();
      if (!sleepGif) {
        return interaction.editReply({ content: 'dont sleep :3', flags: MessageFlags.Ephemeral });
      }

      let desc;
      if (targetUser && targetUser.id !== interaction.user.id) {
        const count = incrementCount(interaction.user.id, targetUser.id);
        desc = `-# **${interaction.user.username}** is off to sleep with **${targetUser.username}..** Zzz...\n` +
          `-# ***${interaction.user.username}** has slept with **${targetUser.username}** ${count} ${count === 1 ? 'time' : 'times'}.*`;
      } else {
        desc = `-# **${interaction.user.username}** is sleeping. Zzz...`;
      }

      const embed = new EmbedBuilder()
        .setDescription(desc)
        .setImage(sleepGif);

      await interaction.editReply({ embeds: [embed], components });
    } catch (error) {
      console.error(`error executing sleep command: ${error.message}`);
      return interaction.editReply({ content: 'dont sleep!', flags: MessageFlags.Ephemeral });
    }
  },
};