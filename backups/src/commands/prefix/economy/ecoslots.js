const { EmbedBuilder } = require('discord.js');
const economy = require('../../../utils/economyUtil');
const MAX_BET = 25000;
const ROLLING_EMOJI = "<a:ef:1335267236906143807>";

const symbols = [
  { emoji: '🍆', multiplier: 1, weight: 6 },
  { emoji: '<:primogem:1461662522804273259>', multiplier: 2.8, weight: 5 },
  { emoji: '<:Acquaint_Fate:1461662502596120700>', multiplier: 5.2, weight: 4 },
  { emoji: '<:intertwined_fate:1461662487849074862>', multiplier: 6.5, weight: 3 },
  { emoji: '<:fate:1461662542198734985>', multiplier: 8, weight: 2 }
];

function pickSymbol() {
  const totalWeight = symbols.reduce((sum, sym) => sum + sym.weight, 0);
  let rand = Math.random() * totalWeight;
  
  for (const sym of symbols) {
    if (rand < sym.weight) return sym;
    rand -= sym.weight;
  }
  return symbols[0];
}

function parseBetArg(betArg) {
  if (!betArg) return NaN;
  const cleaned = betArg.replace(/[^\d]/g, '');
  return parseInt(cleaned, 10);
}

async function animateRoll(message, finalSymbols, delay = 1200) {
  const rollMsg = await message.channel.send(
    `<a:work:1461661204203438092> Rolling...\n\n${ROLLING_EMOJI} | ${ROLLING_EMOJI} | ${ROLLING_EMOJI}`
  );
  await new Promise(resolve => setTimeout(resolve, delay));
  const finalDisplay = finalSymbols.map(sym => sym.emoji).join(' | ');
  await rollMsg.edit(`<a:work:1461661204203438092> Rolling...\n\n${finalDisplay}`);
  return rollMsg;
}

module.exports = {
  name: 'slots',
  cooldown: 5,
  aliases: ['stonk', 'stonks'],
  description: 'Play the slots machine! Usage: `!slots <bet | max | all>`',
  async execute(message, args) {
    const userId = message.author.id;
    let balance = await economy.getBalance(userId);

    if (!args[0]) {
      return message.reply(`Please provide a bet amount?? Your balance: ${economy.formatCurrency(balance)}`);
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
      return message.reply(`Insufficient funds! Your balance: ${economy.formatCurrency(balance)}`);
    }

    if (bet > MAX_BET) {
      return message.reply(`Max bet is ${economy.formatCurrency(MAX_BET)}`);
    }

    await economy.updateBalance(userId, -bet);

    const reels = [pickSymbol(), pickSymbol(), pickSymbol()];
    const rollMsg = await animateRoll(message, reels, 1200);

    let winType = null, winMultiplier = 0;
    if (reels[0].emoji === reels[1].emoji && reels[1].emoji === reels[2].emoji) {
      winType = 'full';
      winMultiplier = reels[0].multiplier * 1.2;
    } else if (reels[0].emoji === reels[1].emoji || reels[1].emoji === reels[2].emoji) {
      winType = 'consolation';
      winMultiplier = (reels[0].emoji === reels[1].emoji ? reels[0] : reels[1]).multiplier * 0.7;
    }

    if (Math.random() < 0.05 && winMultiplier > 0) {
      winMultiplier *= 1.5;
    }

    let winnings = winMultiplier > 0 ? Math.floor(bet * winMultiplier) : 0;
    if (winnings > 0) {
      await economy.updateBalance(userId, bet + winnings);
    }
    balance = await economy.getBalance(userId);
    const net = winnings - bet;

    let outcomeText;
    if (winType === 'full') {
      outcomeText = '<:y_win:1461659408420306955> You win! Three in a row!';
    } else if (winType === 'consolation') {
      outcomeText = '<:consolation:1461662922496544820> Two of a kind! Consolation!';
    } else {
      outcomeText = '<:consolation:1461662922496544820> You lose! No Luck This Time!';
    }

const embed = new EmbedBuilder()
  .setDescription(
    `**${outcomeText}**\n\n` +
    `${reels.map(r => r.emoji).join(' | ')}\n` +
    `**Bet:** ${economy.formatCurrency(bet)}\n` +
    `**Winnings:** ${economy.formatCurrency(winnings)}\n\n` +
    `**New Balance:** ${economy.formatCurrency(balance)}`
  );

    await rollMsg.edit({ content: null, embeds: [embed] });
  },
};