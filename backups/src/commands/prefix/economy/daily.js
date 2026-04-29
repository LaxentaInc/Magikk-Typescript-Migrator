const { EmbedBuilder } = require('discord.js');
const economy = require('../../../utils/economyUtil');

module.exports = {
    name: 'daily',
    description: 'Claim your daily reward!',
    async execute(message) {
        const userId = message.author.id;
        const reward = 10000;

        const result = await economy.claimDaily(userId, reward);

        if (!result.success) {
            // Calculate remaining HH:MM:SS
            const seconds = Math.floor(result.timeLeft / 1000);
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;

            return message.reply(`You've already claimed your daily reward today! Come back in **${h}h ${m}m ${s}s**.`);
        }

        const embed = new EmbedBuilder()
            .setTitle('Daily allowance taken!')
            .setDescription(`You received **${economy.formatCurrency(reward)}**!\nNew Balance: **${economy.formatCurrency(result.balance)}**`);

        message.channel.send({ embeds: [embed] });
    }
};
