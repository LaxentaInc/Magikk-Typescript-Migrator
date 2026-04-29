const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'avatar',
    description: 'Displays the avatar of the mentioned user or the command user.',
    usage: '!avatar [@user]',
    async execute(message, args) {
        try {
            let user;
            if (args.length) {
                const userMention = args[0];
                user = message.mentions.users.first() || await message.client.users.fetch(userMention.replace(/[<@!>]/g, ''));
            } else {
                user = message.author;
            }

            if (!user) return message.reply('User not found. Please mention a valid user.');

            const avatarUrl = user.displayAvatarURL({ format: 'png', size: 1024, dynamic: true });
            const botAvatarUrl = message.client.user.displayAvatarURL({ format: 'png', size: 1024, dynamic: true });

            const embed = new EmbedBuilder()
                .setAuthor({
                    name: `${user.tag}`,
                    iconURL: avatarUrl,
                })
                .setDescription(`[Avatar URL for ${user.tag}](${avatarUrl})`)
                .setImage(avatarUrl)
                .setFooter({
                    text: `${message.client.user.username}`,
                    iconURL: botAvatarUrl,
                })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error displaying avatar:', error);
            message.reply('There was an error trying to fetch the avatar. Please try again later.');
        }
    },
};
