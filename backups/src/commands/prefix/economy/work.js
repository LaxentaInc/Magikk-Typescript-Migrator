const { EmbedBuilder } = require('discord.js');
const economy = require('../../../utils/economyUtil');

const JOBS = [
    "Barista", "Discord Mod", "Professional Simp", "Code Monkey",
    "Pizza Delivery Driver", "Youtuber", "Streamer", "Dog Walker"
];

module.exports = {
    name: 'work',
    description: 'Work a shift to earn some extra cash!',
    async execute(message) {
        const userId = message.author.id;
        // Reward range: 45000 - 60000
        const result = await economy.performWork(userId, 45000, 60000);

        if (!result.success) {
            const minutes = Math.ceil(result.timeLeft / 1000 / 60);
            return message.reply(`<a:work:1461661204203438092> You're too tired to work! Chill for **${minutes} minutes**.`);
        }

        const job = JOBS[Math.floor(Math.random() * JOBS.length)];

        const embed = new EmbedBuilder()
            .setDescription(`<a:work:1461661204203438092> You worked as a **${job}** and earned **${economy.formatCurrency(result.earned)}**!\nBalance: **${economy.formatCurrency(result.balance)}**`);

        message.channel.send({ embeds: [embed] });
    }
};
