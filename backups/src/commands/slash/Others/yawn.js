const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('yawn')
        .setDescription('*yawns* so sleepy...')
        .setIntegrationTypes(0, 1).setContexts(0, 1, 2),
    async execute(interaction) {
        await interaction.deferReply();
        try {
            const response = await axios.get('https://nekos.best/api/v2/yawn', { timeout: 5000 });
            const gif = response.data.results[0].url;
            if (!gif) return interaction.editReply({ content: 'too tired to yawn...' });
            const embed = new EmbedBuilder()
                .setDescription(`-# **${interaction.user.username}** yawns... so sleepy...`)
                .setImage(gif);
            await interaction.editReply({ embeds: [embed] });
        } catch (e) { console.error(`error: ${e.message}`); await interaction.editReply({ content: 'failed to yawn!' }); }
    }
};
