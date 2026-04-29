const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


const getPoutGif = async () => {
  try { const r = await axios.get('https://nekos.best/api/v2/pout', { timeout: 5000 }); return r.data.results[0].url; } catch { return null; }
};


// ========== counter ==========
const POUT_STATS_PATH = path.join(__dirname, '../../../data/pout_stats.json');
const loadStats = () => { try { if (!fs.existsSync(POUT_STATS_PATH)) { fs.writeFileSync(POUT_STATS_PATH, '{}', 'utf8'); return {}; } return JSON.parse(fs.readFileSync(POUT_STATS_PATH, 'utf8')); } catch { return {}; } };
const saveStats = (s) => { try { fs.writeFileSync(POUT_STATS_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { console.error('failed to save pout stats:', e); } };
const incrementCount = (id1, id2) => { const s = loadStats(); const k = [id1, id2].sort().join(':'); s[k] = (s[k] || 0) + 1; saveStats(s); return s[k]; };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pout')
    .setDescription('Pout at someone >:c')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to pout at')
        .setRequired(false)
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    let components = [];

    await interaction.deferReply();
    try {
      const poutGif = await getPoutGif();
      if (!poutGif) {
        return interaction.editReply({ content: 'failed to fetch pout gif!', flags: MessageFlags.Ephemeral });
      }

      let desc;
      if (targetUser && targetUser.id !== interaction.user.id) {
        const count = incrementCount(interaction.user.id, targetUser.id);
        desc = `-# **${interaction.user.username}** pouts at **${targetUser.username}!** >:c\n` +
          `-# ***${interaction.user.username}** has pouted at **${targetUser.username}** ${count} ${count === 1 ? 'time' : 'times'}.*`;

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('pout_back')
            .setLabel('Pout Back')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('pat_back')
            .setLabel('Pat Pat')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('hug_back')
            .setLabel('Hug')
            .setStyle(ButtonStyle.Secondary)
        );
        components.push(row);
      } else {
        desc = `-# **${interaction.user.username}** is pouting... someone cheer them up!`;
      }

      const embed = new EmbedBuilder()
        .setDescription(desc)
        .setImage(poutGif);

      const reply = await interaction.editReply({
        embeds: [embed],
        components,
        fetchReply: true
      });

      if (!targetUser || targetUser.id === interaction.user.id) return;

      const collector = reply.createMessageComponentCollector({
        time: 30000,
        filter: i => i.user.id === targetUser.id,
      });

      collector.on('collect', async i => {
        const actions = {
          pout_back: 'pout',
          pat_back: 'pat',
          hug_back: 'hug'
        };

        const func = actions[i.customId];

        const responseGif = await axios.get(`https://nekos.best/api/v2/${func}`);
        const actionGif = responseGif.data.results[0].url;

        const responseEmbed = new EmbedBuilder()
          .setDescription(`-# **${targetUser.username}** chose to **${func}** back at **${interaction.user.username}!**`)
          .setImage(actionGif);

        components[0].components.forEach(btn => btn.setDisabled(true));
        await i.update({ components });
        await interaction.followUp({ embeds: [responseEmbed] });
        collector.stop();
      });

      collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
          components[0].components.forEach(btn => btn.setDisabled(true));
          try { await reply.edit({ components }); } catch (error) { if (error.code !== 50001) console.error('failed to update message after collector ended:', error); }
        }
      });

    } catch (error) {
      console.error(`error executing pout command: ${error.message}`);
      return interaction.editReply({ content: 'failed to pout!', flags: MessageFlags.Ephemeral });
    }
  },
};