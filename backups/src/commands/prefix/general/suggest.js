const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'suggest',
    description: 'Send a suggestion directly to the bot owner.',
    aliases: ['suggestion', 'feedback'],
    usage: '!suggest <your suggestion>',
    async execute(message, args) {
        if (!args.length) {
            return message.reply('Please provide a suggestion! Example: `!suggest add a music queue feature`');
        }

        const suggestion = args.join(' ');
        const ownerId = '953527567808356404';

        try {
            const ownerUser = await message.client.users.fetch(ownerId);
            if (!ownerUser) throw new Error('owner not found.');

            const embed = new EmbedBuilder()
                .setTitle('New Suggestion Received')
                .setDescription(suggestion)
                .setColor(0x00AE86)
                .setTimestamp()
                .setFooter({ text: `From: ${message.author.tag} (${message.author.id}) | Guild: ${message.guild?.name || 'DM'}` });

            await ownerUser.send({ embeds: [embed] });
            await message.reply('Your suggestion has been sent! Thank you pookie for giving your time :3');
        } catch (error) {
            console.error('suggestion dm error:', error);
            await message.reply('Failed to send your suggestion. Please try again later.');
        }
    },
};
