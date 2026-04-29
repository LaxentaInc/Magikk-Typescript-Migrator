const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


const getWaveGif = async () => {
    try { const r = await axios.get('https://nekos.best/api/v2/wave', { timeout: 5000 }); return r.data.results[0].url; } catch { return null; }
};


// ========== counter ==========
const WAVE_STATS_PATH = path.join(__dirname, '../../../data/bye_stats.json');
const loadStats = () => { try { if (!fs.existsSync(WAVE_STATS_PATH)) { fs.writeFileSync(WAVE_STATS_PATH, '{}', 'utf8'); return {}; } return JSON.parse(fs.readFileSync(WAVE_STATS_PATH, 'utf8')); } catch { return {}; } };
const saveStats = (s) => { try { fs.writeFileSync(WAVE_STATS_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { console.error('failed to save bye stats:', e); } };
const incrementCount = (id1, id2) => { const s = loadStats(); const k = [id1, id2].sort().join(':'); s[k] = (s[k] || 0) + 1; saveStats(s); return s[k]; };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bye')
        .setDescription('Say goodbye!')
        .setIntegrationTypes(0, 1)
        .setContexts(0, 1, 2)
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to say bye to (optional)')
                .setRequired(false)
        ),
    async execute(interaction) {
        const targetUser = interaction.options.getUser('target');
        let components = [];

        if (targetUser && targetUser.id !== interaction.user.id) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('bye_back')
                    .setLabel('Bye Back')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('five_back')
                    .setLabel('High Five')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('smile_back')
                    .setLabel('Smile')
                    .setStyle(ButtonStyle.Secondary)
            );
            components.push(row);
        }

        await interaction.deferReply();
        try {
            const waveGif = await getWaveGif();
            if (!waveGif) return interaction.editReply({ content: 'failed to wave!', flags: MessageFlags.Ephemeral });

            let desc;
            if (targetUser && targetUser.id !== interaction.user.id) {
                const count = incrementCount(interaction.user.id, targetUser.id);
                desc = `-# **${interaction.user.username}** says bye to **${targetUser.username}!**\n` +
                    `-# ***${interaction.user.username}** has said bye to **${targetUser.username}** ${count} ${count === 1 ? 'time' : 'times'}.*`;
            } else {
                desc = `-# **${interaction.user.username}** waves goodbye!`;
            }

            const embed = new EmbedBuilder()
                .setDescription(desc)
                .setImage(waveGif);

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
                    bye_back: 'wave',
                    five_back: 'highfive',
                    smile_back: 'smile'
                };

                const action = actions[i.customId];

                const responseGif = await axios.get(`https://nekos.best/api/v2/${action}`);
                const actionGifUrl = responseGif.data.results[0].url;

                const labels = { bye_back: 'wave', five_back: 'high five', smile_back: 'smile' };

                const responseEmbed = new EmbedBuilder()
                    .setDescription(`-# **${targetUser.username}** chose to **${labels[i.customId]}** back at **${interaction.user.username}!**`)
                    .setImage(actionGifUrl);

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
            console.error(`error executing bye command: ${error.message}`);
            return interaction.editReply({ content: 'failed to wave!', flags: MessageFlags.Ephemeral });
        }
    },
};