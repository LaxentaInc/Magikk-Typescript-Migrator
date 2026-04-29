const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Provides information ig xd')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2),
  async execute(interaction) {
    const client = interaction.client;
    const uptime = formatUptime(client.uptime);
    
    let embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('App Information')
      .setThumbnail(client.user.avatarURL())
      .addFields(
        { name: 'Bot Name', value: client.user.username, inline: true },
        { name: 'Bot ID', value: client.user.id, inline: true },
        { name: 'Created At', value: client.user.createdAt.toDateString(), inline: true },
        { name: 'Uptime', value: uptime, inline: true },
        { name: 'Support Server', value: '[Support server UwU :)](https://discord.gg/9emnU25HaY)', inline: true },
        { name: 'Developer', value: '@me_straight', inline: true },
        { name: 'Website', value: 'https://www.laxenta.tech/', inline: true },
        { name: 'GitHub', value: 'https://github.com/shelleyloosespatience', inline: true }
      )
      .setFooter({ text: 'Bot made with love using Discord.js', iconURL: client.user.avatarURL() });
      
    // If executed in a guild, add extra fields
    if (interaction.guild) {
      const userCount = client.guilds.cache.reduce((total, guild) => total + guild.memberCount, 0);
      embed.addFields(
        { name: 'Server Count', value: client.guilds.cache.size.toString(), inline: true },
        { name: 'User Count', value: userCount.toString(), inline: true }
      );
    } else {
      // In DMs, you might want to adjust or remove guild-specific info
      embed.addFields({ name: 'Note', value: 'Guild information is not available in DMs', inline: false });
    }

    await interaction.reply({ embeds: [embed] });
  },
};

function formatUptime(ms) {
  let seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}