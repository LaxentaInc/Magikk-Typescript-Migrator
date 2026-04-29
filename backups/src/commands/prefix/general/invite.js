const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    name: 'invite',
    description: 'Invite the bot or join the server using buttons.',
    async execute(message) {
        try {
            // Define buttons for inviting the bot and joining the server
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Invite the Bot')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://discord.com/oauth2/authorize?client_id=1107155830274523136&permissions=1118435113046&scope=bot%20applications.commands'),
                    new ButtonBuilder()
                        .setLabel('Join our devs')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://discord.gg/9emnU25HaY')
                );

            // Send the message with buttons
            await message.channel.send({
                content: 'Click the buttons below to invite the bot or join the server!',
                components: [row],
            });
        } catch (error) {
            console.error('Error sending invite buttons:', error);
            await message.channel.send('An error occurred while generating the invite buttons. Please try again later.');
        }
    },
};