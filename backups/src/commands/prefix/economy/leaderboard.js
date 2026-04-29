const { EmbedBuilder } = require('discord.js');
const economy = require('../../../utils/economyUtil');

module.exports = {
    name: 'leaderboard',
    aliases: ['lb', 'top', 'rich'],
    description: 'Displays the richest users in the economy.',
    async execute(message) {
        const topUsers = await economy.getLeaderboard(10);

        if (!topUsers || topUsers.length === 0) {
            return message.reply("The economy is empty! Start earning with `!daily`.");
        }

        const description = topUsers
            .map((user, index) => {
                const medal = index === 0 ? '<a:1st:1461766946176630794>' : index === 1 ? '<:2nd:1461767222946037780>' : index === 2 ? '<:3rd:1461767243716362280>' : `#${index + 1}`;
                // We might not have username in DB if we didn't save it, so use <@id>
                return `${medal} <@${user.userId}> — **${economy.formatCurrency(user.balance)}**`;
            })
            .join('\n');

        const embed = new EmbedBuilder()
            .setColor('#F1C40F')
            .setTitle('<:leaderboard:1461766511629963284> Richest Users')
            .setDescription(description)
            .setFooter({ text: 'Compete for the top spot bbg!' });

        message.channel.send({ embeds: [embed] });
    }
};
