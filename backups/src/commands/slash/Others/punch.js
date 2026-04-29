const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


const getPunchGif = async () => {
  try { const r = await axios.get('https://nekos.best/api/v2/punch', { timeout: 5000 }); return r.data.results[0].url; } catch { return null; }
};


// ========== counter ==========
const PUNCH_STATS_PATH = path.join(__dirname, '../../../data/punch_stats.json');
const loadStats = () => { try { if (!fs.existsSync(PUNCH_STATS_PATH)) { fs.writeFileSync(PUNCH_STATS_PATH, '{}', 'utf8'); return {}; } return JSON.parse(fs.readFileSync(PUNCH_STATS_PATH, 'utf8')); } catch { return {}; } };
const saveStats = (s) => { try { fs.writeFileSync(PUNCH_STATS_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { console.error('failed to save punch stats:', e); } };
const incrementCount = (id1, id2) => { const s = loadStats(); const k = [id1, id2].sort().join(':'); s[k] = (s[k] || 0) + 1; saveStats(s); return s[k]; };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('punch')
    .setDescription('Punch someone! Show them who\'s boss!')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to punch')
        .setRequired(false)
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');
    let components = [];

    await interaction.deferReply();
    try {
      const punchGif = await getPunchGif();
      if (!punchGif) {
        return interaction.editReply({ content: 'failed to punch!', flags: MessageFlags.Ephemeral });
      }

      let desc;
      if (targetUser && targetUser.id !== interaction.user.id) {
        const count = incrementCount(interaction.user.id, targetUser.id);
        desc = `-# **${interaction.user.username}** punches **${targetUser.username}!** ouch!\n` +
          `-# ***${interaction.user.username}** has punched **${targetUser.username}** ${count} ${count === 1 ? 'time' : 'times'}.*`;

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('punch_back')
            .setLabel('Punch Back! 👊')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('cry_back')
            .setLabel('Cry publically 😭')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('run_back')
            .setLabel('Run Away! 🏃')
            .setStyle(ButtonStyle.Secondary)
        );
        components.push(row);
      } else {
        desc = `-# **${interaction.user.username}** punches the air! training hard!`;
      }

      const embed = new EmbedBuilder()
        .setDescription(desc)
        .setImage(punchGif);

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
        let actionGif, responseDesc;

        if (i.customId === 'punch_back') {
          const punchResponse = await axios.get('https://nekos.best/api/v2/punch');
          actionGif = punchResponse.data.results[0].url;
          responseDesc = `-# **${targetUser.username}** punches **${interaction.user.username}** back! it's a brawl!`;
        } else if (i.customId === 'cry_back') {
          const cryResponse = await axios.get('https://nekos.best/api/v2/cry');
          actionGif = cryResponse.data.results[0].url;
          responseDesc = `-# **${targetUser.username}** cries after being punched by **${interaction.user.username}!**`;
        } else {
          const pokeResponse = await axios.get('https://nekos.best/api/v2/poke');
          actionGif = pokeResponse.data.results[0].url;
          responseDesc = `-# **${targetUser.username}** runs away from **${interaction.user.username}!**`;
        }

        const responseEmbed = new EmbedBuilder()
          .setDescription(responseDesc)
          .setImage(actionGif);

        components[0].components.forEach(btn => btn.setDisabled(true));
        await i.update({ components });
        await interaction.followUp({ embeds: [responseEmbed] });
        collector.stop();
      });

      collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
          components[0].components.forEach(btn => btn.setDisabled(true));
          try { await reply.edit({ components }); } catch (error) { console.error('failed to update message after collector ended:', error); }
        }
      });

    } catch (error) {
      console.error(`error executing punch command: ${error.message}`);
      return interaction.editReply({ content: 'failed to punch!', flags: MessageFlags.Ephemeral });
    }
  },
};