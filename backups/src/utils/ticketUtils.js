const ticketManager = require('./ticketManager');

async function handleCreateTicket(interaction, reason = 'No reason provided') {
  try {
    const ticketChannel = await ticketManager.createTicket(
      interaction.guild,
      interaction.user,
      reason
    );

    await interaction.reply({
      content: `Ticket created successfully in ${ticketChannel.toString()}.`,
      ephemeral: true
    });
  } catch (error) {
    console.error('Error creating ticket via button:', error);
    await interaction.reply({
      content: 'Failed to create ticket ;c.',
      ephemeral: true
    });
  }
}

module.exports = { handleCreateTicket };