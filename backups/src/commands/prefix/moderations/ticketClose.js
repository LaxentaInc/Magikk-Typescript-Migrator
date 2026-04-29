const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'ticketclose',
  description: 'Close a ticket.',
  args: true,
  usage: '<ticket-id>',
  async execute(message, args) {
    const ticketIdentifier = args[0];
    const guild = message.guild;
    const user = message.author;

    try {
      let ticketChannel;
      if (ticketIdentifier) {
        try {
          ticketChannel = await guild.channels.fetch(ticketIdentifier);
        } catch (error) {
          return message.reply('Ticket not found.');
        }
      } else if (message.channel.name.startsWith('ticket')) {
        ticketChannel = message.channel;
      }

      if (!ticketChannel) {
        return message.reply('Ticket not found.');
      }
      const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);
      const ownerId = ticketChannel.name.split('-')[1];
      if (!isAdmin && user.id !== ownerId) {
        return message.reply('You do not have permission to close this ticket.');
      }
      const confirmEmbed = new EmbedBuilder()
        .setColor('#ff0000')
        .setDescription('Are you sure you want to close this ticket?');

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('confirm-close')
          .setLabel('Yes, close it')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel-close')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      await message.reply({
        embeds: [confirmEmbed],
        components: [confirmRow],
      });
      const filter = i => i.customId === 'confirm-close' || i.customId === 'cancel-close';
      const collector = message.channel.createMessageComponentCollector({ filter, time: 15 * 60 * 1000 });

      collector.on('collect', async (i) => {
        if (i.customId === 'confirm-close') {
          await ticketChannel.delete();
          // Removed reply function if channel is deleted
          // await i.reply({ content: 'Ticket has been closed.', ephemeral: true });
        } else if (i.customId === 'cancel-close') {
          await i.message.delete();
          await i.reply({ content: 'Ticket closure canceled.', ephemeral: true });
        }
        collector.stop();
      });

      collector.on('end', (collected, reason) => {
        if (reason === 'time') {
          message.channel.send('The ticket closure request has expired due to inactivity.');
        }
      });

    } catch (error) {
      console.error('Error handling ticket close command:', error);
      return message.reply('An error occurred while processing the ticket closure. Please try again later.');
    }
  },
};
