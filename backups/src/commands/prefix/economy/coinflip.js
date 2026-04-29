const { EmbedBuilder } = require('discord.js');
const economy = require('../../../utils/economyUtil');
const MAX_BET = 50000;

function parseBetArg(betArg) {
  if (!betArg) return NaN;
  const cleaned = betArg.replace(/[^\d]/g, '');
  return parseInt(cleaned, 10);
}

module.exports = {
  name: 'cf',
  aliases: ['coinflip'],
  description: 'Flip a coin and double your money if you win (Max bet: 5k)',
  async execute(message, args) {
    const userId = message.author.id;
    let balance = await economy.getBalance(userId);

    if (!args[0]) {
      return message.reply(`Provide a bet amount and side (h/t). Balance: ${economy.formatCurrency(balance)}`);
    }

    // Parse the choice (h or t)
    const choice = args[1]?.toLowerCase();
    if (!choice || (choice !== 'h' && choice !== 't')) {
      return message.reply("Choose a side: `h` (heads) or `t` (tails). Example: `!cf 100 h`");
    }

    const betArg = args[0].toLowerCase();
    let bet;

    if (betArg === "max" || betArg === "all") {
      bet = Math.min(balance, MAX_BET);
    } else {
      bet = parseBetArg(betArg);
    }

    if (isNaN(bet) || bet <= 0) {
      return message.reply("Invalid bet amount.");
    }

    if (bet > balance) {
      return message.reply(`Insufficient funds! You only have ${economy.formatCurrency(balance)}.`);
    }

    if (bet > MAX_BET) {
      return message.reply(`Max bet is ${economy.formatCurrency(MAX_BET)}.`);
    }

    await economy.updateBalance(userId, -bet);

    // Random coin flip result
    const result = Math.random() < 0.5 ? 'h' : 't';
    const isWin = choice === result;
    let winnings = isWin ? bet * 2 : 0;

    if (isWin) {
      await economy.updateBalance(userId, winnings);
    }

    balance = await economy.getBalance(userId);
    const net = winnings - bet;

    const resultText = result === 'h' ? 'Heads' : 'Tails';
    const choiceText = choice === 'h' ? 'Heads' : 'Tails';

    const embed = new EmbedBuilder()
      .setDescription(
        `<a:coinflip_main:1461659736536514797> **Coinflip Result**\n\n` +
        `**Your Choice:** ${choiceText}\n` +
        `**Result:** ${resultText}\n` +
        `**Bet:** ${economy.formatCurrency(bet)}\n` +
        `**Outcome:** ${isWin ? '<:y_win:1461659408420306955> You Win!' : 'You Lose!'}\n` +
        `**Winnings:** ${economy.formatCurrency(winnings)}\n` +
        `**Net:** ${net >= 0 ? '+' : ''}${economy.formatCurrency(net)}\n\n` +
        `**New Balance:** ${economy.formatCurrency(balance)}`
      )
      .setFooter({ text: 'Usage: !cf <amount> <h/t> • h = heads, t = tails' });

    message.channel.send({ embeds: [embed] });
  }
};