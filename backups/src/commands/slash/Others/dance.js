const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dance')
        .setDescription('Dance!')
        .setIntegrationTypes(0, 1).setContexts(0, 1, 2)
        .addUserOption(option => option.setName('target').setDescription('The user to dance with').setRequired(false)),
    async execute(interaction) {
        const target = interaction.options.getUser('target');
        await interaction.deferReply();
        try {
            const response = await axios.get('https://nekos.best/api/v2/dance', { timeout: 5000 });
            const gif = response.data.results[0].url;
            if (!gif) return interaction.editReply({ content: 'couldn\'t dance. try again!' });
            let desc;
            if (target && target.id !== interaction.user.id) {
                desc = `-# **${interaction.user.username}** dances with **${target.username}!**`;
            } else { desc = `-# **${interaction.user.username}** is dancing!`; }
            const embed = new EmbedBuilder().setDescription(desc).setImage(gif);
            await interaction.editReply({ embeds: [embed] });
        } catch (e) { console.error(`error: ${e.message}`); await interaction.editReply({ content: 'failed to dance!' }); }
    }
};
