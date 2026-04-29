const { SlashCommandBuilder } = require('@discordjs/builders');
const economy = require('../../../utils/economyUtil');

const OWNER_ID = '1246380709124378674'; // Your owner ID

module.exports = {
  name: 'eco',
  description: 'Owner-only command to add or withdraw money from a user.',
  async execute(message, args) {
    // Check if the user is the owner
    if (message.author.id !== OWNER_ID) {
      return message.channel.send("You don't have permission to use this command.");
    }

    // Ensure correct usage
    if (args.length < 3) {
      return message.channel.send("Usage: `money <add|withdraw> <user> <amount>`");
    }

    const action = args[0].toLowerCase();
    if (!['add', 'withdraw'].includes(action)) {
      return message.channel.send("Invalid subcommand! Use `add` or `withdraw`.");
    }

    // Fetch user
    const targetUser = message.mentions.users.first() || await message.client.users.fetch(args[1]).catch(() => null);
    if (!targetUser) {
      return message.channel.send("Please mention a valid user or provide their user ID.");
    }

    // Parse amount
    const amount = parseInt(args[2]);
    if (isNaN(amount) || amount <= 0) {
      return message.channel.send("Please provide a valid positive number for the amount.");
    }

    // Process the action
    let newBalance;
    if (action === 'add') {
      newBalance = await economy.updateBalance(targetUser.id, amount);
      message.channel.send(`✅ **Added ⏣${amount.toLocaleString()}** coins to ${targetUser.username}.\n💰 New Balance: **${newBalance.toLocaleString()}**`);
    } else if (action === 'withdraw') {
      const currentBalance = await economy.getBalance(targetUser.id);
      if (amount > currentBalance) {
        return message.channel.send(`❌ ${targetUser.username} does not have enough funds to withdraw ⏣**${amount.toLocaleString()}**.`);
      }
      newBalance = await economy.updateBalance(targetUser.id, -amount);
      message.channel.send(`✅ **Withdrew ⏣${amount.toLocaleString()}** coins from ${targetUser.username}.\n💰 New Balance: ⏣**${newBalance.toLocaleString()}**`);
    }
  },
};