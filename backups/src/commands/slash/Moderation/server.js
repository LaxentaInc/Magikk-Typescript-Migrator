const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('server')
        .setDescription('Displays server information.'),
    async execute(interaction) {
        try {
            const guild = interaction.guild;
            const serverName = guild.name;
            const memberCount = guild.memberCount;
            const serverID = guild.id;
            const serverBoostLevel = guild.premiumTier;
            const serverLogoURL = guild.iconURL({ format: "png", dynamic: true, size: 1024 });

            const embed = new EmbedBuilder()
                .setTitle("Server Info <a:server:1310498065328898108>")
                .setColor("#7289DA")
                .addFields(
                    { name: "<a:srv:1310498083980709951> **Server:**", value: serverName, inline: true },
                    { name: "<a:id:1310498098107387974> **Guild ID:**", value: serverID, inline: true },
                    { name: "<a:boost:1310498077538258966> **Members:**", value: memberCount.toString(), inline: true },
                    { name: "<a:boost:1326464202822520853> **Boost Level:**", value: serverBoostLevel.toString(), inline: false }
                )
                .setImage(serverLogoURL)
                .setTimestamp()
                .setFooter({ text: serverName, iconURL: serverLogoURL });

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('An error occurred while executing the server command:', error);
            await interaction.reply({ content: 'Sorry, I could not fetch the server information.', ephemeral: true });
        }
    },
};