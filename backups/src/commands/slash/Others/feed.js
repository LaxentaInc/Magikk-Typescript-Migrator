const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ========== counter ==========
const STATS_PATH = path.join(__dirname, '../../../data/feed_stats.json');
const loadStats = () => { try { if (!fs.existsSync(STATS_PATH)) { fs.writeFileSync(STATS_PATH, '{}', 'utf8'); return {}; } return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')); } catch { return {}; } };
const saveStats = (s) => { try { fs.writeFileSync(STATS_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { console.error('failed to save feed stats:', e); } };
const incrementCount = (id1, id2) => { const s = loadStats(); const k = [id1, id2].sort().join(':'); s[k] = (s[k] || 0) + 1; saveStats(s); return s[k]; };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('feed')
        .setDescription('Feed someone! Say ahh~')
        .setIntegrationTypes(0, 1).setContexts(0, 1, 2)
        .addUserOption(option => option.setName('target').setDescription('The user you want to feed').setRequired(true)),
    async execute(interaction) {
        const target = interaction.options.getUser('target');
        if (target.id === interaction.user.id) return interaction.reply({ content: "you can feed yourself just fine!", ephemeral: true });
        await interaction.deferReply();
        try {
            const response = await axios.get('https://nekos.best/api/v2/feed', { timeout: 5000 });
            const gif = response.data.results[0].url;
            if (!gif) return interaction.editReply({ content: 'couldn\'t fetch a feed gif. try again!' });
            const count = incrementCount(interaction.user.id, target.id);
            const embed = new EmbedBuilder()
                .setDescription(`-# **${interaction.user.username}** feeds **${target.username}!** say ahh~\n-# ***${interaction.user.username}** has fed **${target.username}** ${count} ${count === 1 ? 'time' : 'times'}.*`)
                .setImage(gif);
            await interaction.editReply({ embeds: [embed] });
        } catch (e) { console.error(`error: ${e.message}`); await interaction.editReply({ content: 'failed to feed!' }); }
    }
};
