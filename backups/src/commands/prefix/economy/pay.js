const { EmbedBuilder } = require('discord.js');
const economy = require('../../../utils/economyUtil');

module.exports = {
    name: 'pay',
    aliases: ['give', 'transfer'],
    description: 'Transfer money to another user. Usage: `!pay @user <amount>`',
    async execute(message, args) {
        if (!args[0] || !args[1]) {
            return message.reply("Usage: `!pay @user <amount>`");
        }

        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            return message.reply("Please mention a valid user to pay.");
        }

        if (targetUser.id === message.author.id) {
            return message.reply("You cannot pay yourself!");
        }

        // Parse amount (handle 'k', 'm' suffixes later if wanted, but for now simple parsing)
        const amountArg = args[1].toLowerCase().replace(/[^\d]/g, '');
        const amount = parseInt(amountArg, 10);

        if (isNaN(amount) || amount <= 0) {
            return message.reply("Please provide a valid positive amount.");
        }

        try {
            const result = await economy.transfer(message.author.id, targetUser.id, amount);

            const embed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('Transaction Successful 💸')
                .setDescription(`Successfully sent **${economy.formatCurrency(amount)}** to **${targetUser.username}**!`)
                .addFields(
                    { name: 'Your Balance', value: economy.formatCurrency(result.senderBalance), inline: true },
                    { name: 'Their Balance', value: economy.formatCurrency(result.receiverBalance), inline: true }
                );

            message.channel.send({ embeds: [embed] });
        } catch (error) {
            return message.reply(`Transaction failed: ${error.message}`);
        }
    }
};
