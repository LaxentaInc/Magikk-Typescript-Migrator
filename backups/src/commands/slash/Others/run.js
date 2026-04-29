const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


const getRunGif = async () => {
  try { const r = await axios.get('https://nekos.best/api/v2/run', { timeout: 5000 }); return r.data.results[0].url; } catch { return null; }
};


// ========== counter ==========
const RUN_STATS_PATH = path.join(__dirname, '../../../data/run_stats.json');
const loadStats = () => { try { if (!fs.existsSync(RUN_STATS_PATH)) { fs.writeFileSync(RUN_STATS_PATH, '{}', 'utf8'); return {}; } return JSON.parse(fs.readFileSync(RUN_STATS_PATH, 'utf8')); } catch { return {}; } };
const saveStats = (s) => { try { fs.writeFileSync(RUN_STATS_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { console.error('failed to save run stats:', e); } };
const incrementCount = (id1, id2) => { const s = loadStats(); const k = [id1, id2].sort().join(':'); s[k] = (s[k] || 0) + 1; saveStats(s); return s[k]; };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('run')
    .setDescription('Run away from someone!')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user you want to run from')
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
        content: "you can't run from yourself! that's just called exercise...",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: isEphemeral });
    try {
      const runGif = await getRunGif();
      if (!runGif) return interaction.editReply({ content: 'failed to run. try again later!' });

      const count = incrementCount(interaction.user.id, targetUser.id);

      const embed = new EmbedBuilder()
        .setDescription(
          `-# **${interaction.user.username}** is running away from **${targetUser.username}!**\n` +
          `-# ***${interaction.user.username}** has run from **${targetUser.username}** ${count} ${count === 1 ? 'time' : 'times'}.*`
        )
        .setImage(runGif);

      const buttons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('catch')
            .setLabel('Catch em!')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('bonk')
            .setLabel('Bonk!')
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
          if (i.customId === 'catch') {
            const catchResponse = await axios.get('https://nekos.best/api/v2/smug');
            const smugGif = catchResponse.data.results[0].url;

            const catchEmbed = new EmbedBuilder()
              .setDescription(`-# **${targetUser.username}** caught **${interaction.user.username}!** not so fast!`)
              .setImage(smugGif);

            await i.update({ embeds: [catchEmbed], components: [] });
            collector.stop();

          } else if (i.customId === 'bonk') {
            const bonkResponse = await axios.get('https://nekos.best/api/v2/pat');
            const patGif = bonkResponse.data.results[0].url;

            const bonkEmbed = new EmbedBuilder()
              .setDescription(`-# **${targetUser.username}** bonked **${interaction.user.username}!** that's what you get!`)
              .setImage(patGif);

            await i.update({ embeds: [bonkEmbed], components: [] });
            collector.stop();
          }
        } catch (error) {
          console.error('button interaction error:', error);
          await i.reply({ content: 'something went wrong!', ephemeral: true });
        }
      });

      collector.on('end', async (collected, reason) => {
        if (reason === 'time') {
          try { await reply.edit({ components: [] }); } catch (error) { console.error('failed to remove buttons:', error); }
        }
      });

    } catch (error) {
      console.error(`error fetching run gif: ${error.message}`);
      return interaction.editReply({ content: 'failed to run. try again later!' });
    }
  }
};