const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kitsune')
        .setDescription('Get a random kitsune image!')
        .setIntegrationTypes(0, 1).setContexts(0, 1, 2),
    async execute(interaction) {
        await interaction.deferReply();
        try {
            const response = await axios.get('https://nekos.best/api/v2/kitsune', { timeout: 5000 });
            const imageUrl = response.data.results[0].url;
            if (!imageUrl) return interaction.editReply({ content: 'couldn\'t fetch a kitsune image!' });
            const embed = new EmbedBuilder().setImage(imageUrl);
            await interaction.editReply({ embeds: [embed] });
        } catch (e) { console.error(`error: ${e.message}`); await interaction.editReply({ content: 'failed to summon a kitsune!' }); }
    }
};
