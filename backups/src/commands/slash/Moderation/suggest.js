const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Send a suggestion directly to the bot owner @me_straight via DM :3')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addStringOption(option => 
      option.setName('suggestion')
        .setDescription('Your suggestion')
        .setRequired(true)
    ),
  async execute(interaction) {
    const suggestion = interaction.options.getString('suggestion');
    const ownerId = '953527567808356404';
    
    try {
      // Fetch the owner user by ID.
      const ownerUser = await interaction.client.users.fetch(ownerId);
      if (!ownerUser) throw new Error('Owner not found.');

      // Create an embed with the suggestion.
      const embed = new EmbedBuilder()
        .setTitle('New Suggestion Received')
        .setDescription(suggestion)
        .setColor(0x00AE86)
        .setTimestamp()
        .setFooter({ text: `From: ${interaction.user.tag} (${interaction.user.id})` });

      // Send the embed directly to the owner's DM.
      await ownerUser.send({ embeds: [embed] });
      
      // Acknowledge the user that their suggestion was sent.
      await interaction.reply({ content: 'Your suggestion has been sent! Thank you pookie for giving your time : 3', ephemeral: true });
    } catch (error) {
      console.error('Error sending suggestion DM:', error);
      await interaction.reply({ content: 'Failed to send your suggestion. Please try again later.', ephemeral: true });
    }
  }
};