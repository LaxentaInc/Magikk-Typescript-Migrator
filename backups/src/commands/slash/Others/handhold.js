const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


const getHandholdGif = async () => {
  try { const r = await axios.get('https://nekos.best/api/v2/handhold', { timeout: 5000 }); return r.data.results[0].url; } catch { return null; }
};


// ========== counter ==========
const HANDHOLD_STATS_PATH = path.join(__dirname, '../../../data/handhold_stats.json');
const loadStats = () => { try { if (!fs.existsSync(HANDHOLD_STATS_PATH)) { fs.writeFileSync(HANDHOLD_STATS_PATH, '{}', 'utf8'); return {}; } return JSON.parse(fs.readFileSync(HANDHOLD_STATS_PATH, 'utf8')); } catch { return {}; } };
const saveStats = (s) => { try { fs.writeFileSync(HANDHOLD_STATS_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { console.error('failed to save handhold stats:', e); } };
const incrementCount = (id1, id2) => { const s = loadStats(); const k = [id1, id2].sort().join(':'); s[k] = (s[k] || 0) + 1; saveStats(s); return s[k]; };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('handhold')
    .setDescription('Hold hands with someone! How lewd~')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user you want to hold hands with')
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

    if (targetUser.id === interaction.user.id) {
      return interaction.reply({
        content: "you can't hold hands with yourself! that's just clapping...",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: isEphemeral });
    try {
      const handholdGif = await getHandholdGif();
      if (!handholdGif) return interaction.editReply({ content: 'later!' });

      const count = incrementCount(interaction.user.id, targetUser.id);

      const embed = new EmbedBuilder()
        .setDescription(
          `-# **${interaction.user.username}** holds hands with **${targetUser.username}!** how lewd~\n` +
          `-# ***${interaction.user.username}** has held hands with **${targetUser.username}** ${count} ${count === 1 ? 'time' : 'times'}.*`
        )
        .setImage(handholdGif);

      const buttons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('pat')
            .setLabel('Pat Them')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('baka')
            .setLabel('B-Baka!')
            .setStyle(ButtonStyle.Danger)
        );

      const reply = await interaction.editReply({
        embeds: [embed],
        components: [buttons],
        fetchReply: true
      });

      const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === targetUser.id,
        time: 60000
      });

      collector.on('collect', async i => {
        try {
          if (i.customId === 'pat') {
            const patResponse = await axios.get('https://nekos.best/api/v2/pat');
            const patGif = patResponse.data.results[0].url;

            const patEmbed = new EmbedBuilder()
              .setDescription(`-# **${targetUser.username}** pats **${interaction.user.username}!** aww, so sweet~`)
              .setImage(patGif);

            await i.update({ embeds: [patEmbed], components: [] });
            collector.stop();

          } else if (i.customId === 'baka') {
            const bakaResponse = await axios.get('https://nekos.best/api/v2/baka');
            const bakaGif = bakaResponse.data.results[0].url;

            const bakaEmbed = new EmbedBuilder()
              .setDescription(`-# **${targetUser.username}** calls **${interaction.user.username}** a baka for being so lewd!`)
              .setImage(bakaGif);

            await i.update({ embeds: [bakaEmbed], components: [] });
            collector.stop();
          }
        } catch (error) {
          console.error('button interaction error:', error);
          await i.reply({ content: 'something went wrong!', ephemeral: true });
        }
      });

      collector.on('end', async (collected, reason) => {
        if (reason === 'time') {
          try { await reply.edit({ components: [] }); } catch (error) { if (error.code !== 50001) console.error('failed to remove buttons:', error); }
        }
      });

    } catch (error) {
      console.error(`error fetching handhold gif: ${error.message}`);
      return interaction.editReply({ content: 'later!' });
    }
  }
};