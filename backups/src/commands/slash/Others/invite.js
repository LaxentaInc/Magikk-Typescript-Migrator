const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2) //
    .setDescription('Invite the bot or join the dev server.'),
  async execute(interaction) {
    try {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Get Started with Aero!')
        .setDescription(
          `Hello there! <a:eh:1332327251253133383> To get started, inv the cool app - /help and !help and /setprefix\n\n` +
          `Ready to elevate your server? Invite me now and join our awesome dev community. Here are just a few reasons why you'll love me:\n\n` +
          `<a:Mariposas_Kawaii:1333353760545833073> **Mudae, AI, NSFW & Utility Commands:** Tons of commands that make your server lively.\n` +
          `<a:VinylRecord:1342442561297711175> **Music & Entertainment:** Listen to music for FREE, without paying nun.\n` +
          `<a:warn:1333359136037011568> **All you could ever need on discord, /createserver, /ticket, /ai, /moderation :**Every moderation and antiraid feature, /suggest to file a complain or request a feature.\n\n` +
          `<a:eh:1342442860754108426>  Click below to invite meh or join our devs uwu!`
        )
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Invite the App')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.com/oauth2/authorize?client_id=1107155830274523136&permissions=1118435113046&scope=bot%20applications.commands'),
        new ButtonBuilder()
          .setLabel('Join our dev')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.gg/9emnU25HaY')
      );

      await interaction.reply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      console.error('Error sending invite buttons:', error);
      await interaction.reply({
        content: 'An error occurred while generating the invite buttons. Please try again later.',
        ephemeral: true
      });
    }
  },
};