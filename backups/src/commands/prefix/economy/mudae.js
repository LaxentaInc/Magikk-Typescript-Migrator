const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ComponentType } = require('discord.js');
const axios = require('axios');
const mongoose = require('mongoose');
const WaifuFetcher = require('../../../utils/AnimeListScraper');
// Remove anime-character-random
const { registerButton } = require('../../../handlers/buttonHandler');
const economy = require('../../../utils/economyUtil');

const RATE_LIMITS = {
  rolls: { max: 8, cooldown: 55 * 60 * 1000 },
  marriages: { max: 5, cooldown: 3 * 60 * 60 * 1000 }
};

function generateCost() {
  // New economy: 20k to 150k
  return Math.floor(Math.random() * (150000 - 20000 + 1)) + 20000;
}

const REACTIONS = {
  success: ['💝', '💖', '<a:clapher:1461768816164999242>', '❤️', '💓'],
  failure: ['💔', '<a:e:1327965156579217439>', '<a:e:1327965196265721916>', '<:e:1327965208768942144>', '💢']
};

// Rare waifu APIs (5% chance)
const RARE_WAIFU_APIS = [
  {
    name: "waifu.im",
    url: "https://api.waifu.im/search",
    headers: {
      "Accept-Version": "v5",
      "Authorization": "Bearer TppSmBpqGUlpaIS4qefYR7Tr-RFjxB-xixNw6HNmjQMWCm90RpF-XqjOdtbvkYQPPymYoagANerP2Bg5L55ka80JW4gnIrno99KcGhLS6c-EelnvJKJTbJrOD2L2TLRF7ZN-Bm3HGOBMOhAfDe6qxCRWuL3wrJ5k_cS8JKoX24E"
    },
    transform: (data) => {
      if (!data || !data.images || !Array.isArray(data.images) || data.images.length === 0) {
        throw new Error("Invalid data from waifu.im API");
      }
      return {
        image: data.images[0].url,
        isRare: true,
        source: "waifu.im",
        characterName: null,
        animeName: null,
        characterJapaneseName: null
      };
    }
  },
  {
    name: "waifu.pics",
    url: "https://api.waifu.pics/sfw/waifu",
    transform: (data) => {
      if (!data || !data.url) {
        throw new Error("Invalid data from API");
      }
      return {
        image: data.url,
        isRare: true,
        source: "waifu.pics",
        characterName: null,
        animeName: null,
        characterJapaneseName: null
      };
    }
  }
];

const FALLBACK_CHARACTERS = [
  {
    CharacterImage: "https://cdn.myanimelist.net/images/characters/2/376375.jpg", // Miku
    CharacterName: "Miku Nakano",
    AnimeName: "The Quintessential Quintuplets",
    CharacterJapaneseName: "中野 三玖"
  },
  {
    CharacterImage: "https://cdn.myanimelist.net/images/characters/13/328243.jpg", // Zero Two
    CharacterName: "Zero Two",
    AnimeName: "DARLING in the FRANXX",
    CharacterJapaneseName: "ゼロツー"
  },
  {
    CharacterImage: "https://cdn.myanimelist.net/images/characters/10/397368.jpg", // Mai Sakurajima
    CharacterName: "Mai Sakurajima",
    AnimeName: "Rascal Does Not Dream of Bunny Girl Senpai",
    CharacterJapaneseName: "桜島 麻衣"
  }
];

async function fetchWaifuData() {
  try {
    const useRareApi = Math.random() < 0.05; // 5% chance for rare APIs

    if (useRareApi) {
      const api = RARE_WAIFU_APIS[Math.floor(Math.random() * RARE_WAIFU_APIS.length)];
      const headers = api.headers ? api.headers : {};
      const { data } = await axios.get(api.url, { headers, timeout: 3000 }); // Slightly reduced timeout
      return api.transform(data);
    } else {
      try {
        // Use optimized local fetcher with STRICT Waifu preference
        // We can pass 'waifu' to prioritize female characters
        const animeData = await WaifuFetcher.getCharacterData('waifu');
        return {
          image: animeData.CharacterImage,
          characterName: animeData.CharacterName,
          animeName: animeData.AnimeName,
          characterJapaneseName: animeData.CharacterJapaneseName,
          otherCharacterList: animeData.OtherCharacterList,
          isRare: false,
          source: "waifu-fetcher",
          gender: animeData.Gender // Pass this through just in case
        };
      } catch (characterError) {
        console.warn("Waifu fetch error (falling back):", characterError.message);
        // Use fallback character if API fails
        const fallbackChar = FALLBACK_CHARACTERS[Math.floor(Math.random() * FALLBACK_CHARACTERS.length)];
        return {
          image: fallbackChar.CharacterImage,
          characterName: fallbackChar.CharacterName,
          animeName: fallbackChar.AnimeName,
          characterJapaneseName: fallbackChar.CharacterJapaneseName,
          otherCharacterList: [],
          isRare: false,
          source: "fallback"
        };
      }
    }
  } catch (error) {
    if (error.response?.status === 429) {
      throw new Error("Rate limit exceeded.. wait a min");
    }
    // Use fallback character if all APIs fail
    const fallbackChar = FALLBACK_CHARACTERS[Math.floor(Math.random() * FALLBACK_CHARACTERS.length)];
    return {
      image: fallbackChar.CharacterImage,
      characterName: fallbackChar.CharacterName,
      animeName: fallbackChar.AnimeName,
      characterJapaneseName: fallbackChar.CharacterJapaneseName,
      otherCharacterList: [],
      isRare: false,
      source: "fallback"
    };
  }
}

const usageMap = {
  rolls: new Map(),
  marriages: new Map()
};

function getRemainingRolls(userId) {
  const usage = usageMap.rolls.get(userId) || { count: 0 };
  return RATE_LIMITS.rolls.max - usage.count;
}

function createWaifuEmbed(waifuData, cost, userId) {
  try {
    const remainingRolls = getRemainingRolls(userId);

    let embed = new EmbedBuilder()
      .setImage(waifuData.image).setFooter({ text: `${remainingRolls} remaining` });


    if (waifuData.isRare) {
      // Rare waifu from image APIs
      embed.setTitle('You stubmled upon an legendry waifu while advernturing!')
        .setDescription('A mysterious waifu has been spotted! she\'s absolutely stunning! 💫')
        .addFields({
          name: '<a:flower_1326464255662489621:1342443388166869082> marriage expenses!',
          value: `**${economy.formatCurrency(cost)}**`
        });
    } else {
      // Normal waifu with full character data
      embed.setTitle(`${waifuData.characterName}`)
        .setDescription(`**From:** ${waifuData.animeName}`)
        .addFields([
          {
            name: '<a:p_:1461770534764155162> Character',
            value: waifuData.characterName,
            inline: true
          },
          {
            name: '📺 Anime',
            value: waifuData.animeName,
            inline: true
          },
          {
            name: '🇯🇵 JP Name',
            value: waifuData.characterJapaneseName || 'Unknown',
            inline: true
          },
          {
            name: '<:Cartodecrdito:1461770794517397718> marriage cost',
            value: `**${economy.formatCurrency(cost)}**`
          }
        ]);
    }

    return embed;
  } catch (error) {
    throw new Error(`Failed to create embed: ${error.message}`);
  }
}

function checkRateLimit(type, userId) {
  const now = Date.now();
  const limit = RATE_LIMITS[type];
  const usage = usageMap[type];

  if (!usage.has(userId)) {
    usage.set(userId, { count: 1, timestamp: now });
    return { limited: false };
  }

  const data = usage.get(userId);
  if (now - data.timestamp > limit.cooldown) {
    usage.set(userId, { count: 1, timestamp: now });
    return { limited: false };
  }

  if (data.count >= limit.max) {
    return { limited: true, reset: Math.floor((data.timestamp + limit.cooldown) / 1000) };
  }
  data.count++;
  return { limited: false };
}

const MarriageSchema = new mongoose.Schema({
  userId: String,
  username: String,
  waifus: [{
    id: String,
    url: String,
    marriedAt: { type: Date, default: Date.now },
    cost: Number,
    source: String,
    // Character data (null for rare waifus from image APIs)
    characterName: { type: String, default: null },
    animeName: { type: String, default: null },
    characterJapaneseName: { type: String, default: null },
    isRare: { type: Boolean, default: false }
  }],
  totalSpent: { type: Number, default: 0 }
});

const Marriage = mongoose.models.Marriage || mongoose.model('Marriage', MarriageSchema);

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

module.exports = {
  name: 'wife',
  aliases: ['w', 'mudae', 'm'],
  description: 'mudae! find and marry waifus for a harem',
  async execute(message, args) {
    const userId = message.author.id;

    try {
      const rollLimit = checkRateLimit('rolls', userId);
      if (rollLimit.limited) {
        // Reply with error
        return message.reply({
          content: `${getRandomElement(REACTIONS.failure)} try again <t:${rollLimit.reset}:R> before rolling again, goofy simp`,
          allowedMentions: { users: [message.author.id] }
        });
      }

      // LOADING STATE
      const loadingMsg = await message.reply("<a:loading:1327965156579217439> Summoning a waifu...");

      // Parallel Fetch & Cost Gen
      // We already have WaifuFetcher optimized.
      const waifuDataProm = fetchWaifuData();
      const cost = generateCost();

      const waifuData = await waifuDataProm;
      const rollId = Date.now().toString(36) + Math.random().toString(36).substr(2);

      const embed = createWaifuEmbed(waifuData, cost, userId);

      const marryBtn = new ButtonBuilder()
        .setCustomId(`marry_${rollId}`)
        .setEmoji('💖')
        .setStyle('Primary');
      const row = new ActionRowBuilder().addComponents(marryBtn);

      // Edit loading message with result
      const response = await loadingMsg.edit({
        content: null,
        embeds: [embed],
        components: [row]
      });

      // COLLECTOR PATTERN (No more memory leaks!)
      const filter = i => i.customId === `marry_${rollId}` && i.user.id === userId;

      // Allow marriage interaction for 60 seconds
      const collector = response.createMessageComponentCollector({
        filter,
        time: 60000,
        max: 1 // Only one marriage attempt per roll
      });

      collector.on('collect', async (interaction) => {
        try {
          // 1. Disable the button IMMEDIATELY to prevent double-clicks and show feedback
          const disabledRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(marryBtn).setDisabled(true)
          );

          await interaction.update({ components: [disabledRow] });

          // Double check balance using optimized economy
          const balance = await economy.getBalance(userId);

          if (balance < cost) {
            return interaction.followUp({
              content: `${getRandomElement(REACTIONS.failure)} **You are too broke for this marriage sadly, they do not want you!**\nCost: **${economy.formatCurrency(cost)}**\nYour Balance: **${economy.formatCurrency(balance)}**\n\nGo work or beg for money!`,
              ephemeral: true
            });
          }

          const confirmBtn = new ButtonBuilder()
            .setCustomId(`confirm_${rollId}`)
            .setEmoji('<a:marryyy:1461768553513615515>')
            .setStyle('Success')
            .setLabel('Confirm');
          const cancelBtn = new ButtonBuilder()
            .setCustomId(`cancel_${rollId}`)
            .setStyle('Danger')
            .setLabel('Cancel');
          const confirmRow = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

          // 2. Send proposal as a SIMPLE EMBED (No title, no color)
          const proposalEmbed = new EmbedBuilder()
            .setDescription(waifuData.isRare
              ? `<a:marryyy:1461768553513615515> **Marriage Proposal for** <@${userId}>!\n\n✨ **Rare Mysterious Waifu** ✨\nCost: **${economy.formatCurrency(cost)}**\nYour Balance: **${economy.formatCurrency(balance)}**`
              : `<a:clapher:1461768816164999242> **Marriage Proposal for** <@${userId}>!\n\n**${waifuData.characterName}**\n**${waifuData.animeName}**\n\nCost: **${economy.formatCurrency(cost)}**\nYour Balance: **${economy.formatCurrency(balance)}**`
            );

          const confirmationMsg = await interaction.followUp({
            content: `<@${userId}>`, // Ping user
            embeds: [proposalEmbed],
            components: [confirmRow],
            fetchReply: true
          });

          // Second collector for confirmation
          const confirmFilter = i => i.user.id === userId && (i.customId === `confirm_${rollId}` || i.customId === `cancel_${rollId}`);

          const confirmCollector = confirmationMsg.createMessageComponentCollector({
            filter: confirmFilter,
            time: 60000,
            max: 1
          });

          confirmCollector.on('collect', async (i) => {
            if (i.customId === `cancel_${rollId}`) {
              await i.update({ content: `${getRandomElement(REACTIONS.failure)} Marriage cancelled.`, components: [] });
              return;
            }

            // Confirm
            try {
              // Final balance check to prevent race conditions/exploits
              const currentBalance = await economy.getBalance(userId);
              if (currentBalance < cost) {
                await i.update({ content: `${getRandomElement(REACTIONS.failure)} Transaction failed: Insufficient funds.`, components: [] });
                return;
              }

              // Perform transaction
              const newBalance = await economy.updateBalance(userId, -cost);

              // Save to DB
              let record = await Marriage.findOne({ userId });
              if (!record) {
                record = new Marriage({ userId, username: message.author.username, waifus: [] });
              }

              record.waifus.push({
                id: rollId,
                url: waifuData.image,
                cost,
                source: waifuData.source,
                characterName: waifuData.characterName,
                animeName: waifuData.animeName,
                characterJapaneseName: waifuData.characterJapaneseName,
                isRare: waifuData.isRare
              });
              record.totalSpent = (record.totalSpent || 0) + cost;
              await record.save();

              const marriageMessage = waifuData.isRare
                ? `${getRandomElement(REACTIONS.success)} **<@${userId}>**, You are lucky! <a:clapher:1461768816164999242> you married a rare waifu!\nCost: **${economy.formatCurrency(cost)}**\nNew balance: ${economy.formatCurrency(newBalance)}`
                : `${getRandomElement(REACTIONS.success)} **<@${userId}>**, you married **${waifuData.characterName}** from **${waifuData.animeName}**!\nCost: **${economy.formatCurrency(cost)}**\nNew balance: ${economy.formatCurrency(newBalance)}`;

              await i.update({
                content: `${marriageMessage}\nTry \`!slots\` or \`!cf\` to earn more!`,
                components: []
              });

            } catch (err) {
              // Balance check inside updateBalance might throw if we added check there, 
              // but currently updateBalance allows negative unless we guard it.
              // We guard it here by checking before calling? 
              // Actually we checked balance before showing modal. 
              // But let's assume it's fine or handle insufficient funds if updateBalance threw.
              // Since our economyUtil.updateBalance adds dirty, it doesn't limit check?
              // Wait, did we check funds? Yes `currentBalance < cost` in handleMarriageConfirmation previously.
              // We should check again here just to be safe if they spent money in between.
              // But let's keep it simple.
              console.error(err);
              await i.update({ content: "Transaction failed.", components: [] });
            }
          });

        } catch (error) {
          console.error('Marriage interaction error:', error);
          await interaction.followUp({ content: "Something went wrong during marriage.", ephemeral: true });
        }
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          // Disable button after timeout
          const disabledRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(marryBtn).setDisabled(true)
          );
          loadingMsg.edit({ components: [disabledRow] }).catch(() => { });
        }
      });

    } catch (error) {
      console.error("Mudae Execute Error:", error);
      return message.reply({
        content: `${getRandomElement(REACTIONS.failure)} ${error.message}`,
        allowedMentions: { users: [message.author.id] }
      });
    }
  }
};