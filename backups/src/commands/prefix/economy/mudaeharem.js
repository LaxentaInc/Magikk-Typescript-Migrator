const { EmbedBuilder, ButtonBuilder, ActionRowBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { logger } = require('../../../utils/logger');
const { registerButton } = require('../../../handlers/buttonHandler');

// Updated Marriage schema to match the new structure
const marriageSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  username: { type: String },
  waifus: [
    {
      id: { type: String, required: true },
      url: { type: String, required: true },
      marriedAt: { type: Date, default: Date.now },
      cost: { type: Number, required: true },
      source: { type: String, default: 'unknown' },
      // Character data (null for rare waifus from image APIs)
      characterName: { type: String, default: null },
      animeName: { type: String, default: null },
      characterJapaneseName: { type: String, default: null },
      isRare: { type: Boolean, default: false }
    },
  ],
  totalSpent: { type: Number, default: 0 }
});
const Marriage = mongoose.models.Marriage || mongoose.model('Marriage', marriageSchema);

// Utility: Safely defer interaction
async function deferSafe(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => {
      console.warn('Interaction already deferred or expired.');
    });
  }
}

// Utility: Safely edit an interaction reply
async function editSafe(interaction, options) {
  try {
    await interaction.editReply(options);
  } catch (error) {
    logger.warn('Failed to edit interaction reply. Interaction may have expired or already been handled.');
  }
}

module.exports = {
  name: 'harem',
  aliases: ['hm', 'hmudae', 'mh'],
  description: "View your harem (the waifus you've married) with pagination.",
  async execute(message, args, client) {
    const userId = message.author.id;

    // Fetch the user's marriage document.
    const marriageData = await Marriage.findOne({ userId });
    if (!marriageData || !marriageData.waifus.length) {
      return message.channel.send("You haven't married any waifus yet! Use `!w` to find some waifus! 💖");
    }

    const waifus = marriageData.waifus;
    const totalSpent = marriageData.totalSpent || 0;
    let currentPage = 0;

    // Generate an embed for the current waifu page.
    function generateEmbed(page) {
      const waifu = waifus[page];
      const costText = (typeof waifu.cost === 'number') ? waifu.cost.toLocaleString() : "N/A";

      let embed = new EmbedBuilder()
        .setTitle(`${message.author.username}'s Harem <a:marryyy:1461768553513615515>`)
        .setDescription(`Displaying waifu ${page + 1} of ${waifus.length}\n<:consolation:1461662922496544820> **Spent in marriages:** ⏣ ${totalSpent.toLocaleString()}`)
        .setImage(waifu.url)
        .setFooter({ text: `Page ${page + 1} / ${waifus.length} • Married ${new Date(waifu.marriedAt).toLocaleDateString()}` });

      // Check if this is a rare waifu or has character data
      if (waifu.isRare || (!waifu.characterName && !waifu.animeName)) {
        // Rare/mysterious waifu
        embed
          .setColor('#FFD700') // Gold for rare
          .addFields([
            { 
              name: '<a:meninadancando:1461769664819364001> Rare Waifu!', 
              value: 'Isn\'t She\'s absolutely stunning!', 
              inline: false 
            },
            { name: '<:menheradoublethu:1461769918096867422> Marriage Cost', value: `⏣ ${costText}`, inline: true },
            // { name: '📍 Source', value: waifu.source || 'Unknown', inline: true },
            { 
              name: '<a:marryyy:1461768553513615515> Married At', 
              value: `<t:${Math.floor(new Date(waifu.marriedAt).getTime() / 1000)}:F>`, 
              inline: false 
            }
          ]);
      } else {
        // Normal waifu with character data
        embed
          // .setColor('#FF69B4') // Pink for normal
          .setTitle(`${waifu.characterName || 'Unknown Waifu'} 💕`)
          .addFields([
            { 
              name: '<a:p_:1461770534764155162> Character', 
              value: waifu.characterName || 'Unknown Uni', 
              inline: true 
            },
            { 
              name: 'Anime', 
              value: waifu.animeName || 'Unknown', 
              inline: true 
            },
            { 
              name: '🇯🇵 Japanese Name', 
              value: waifu.characterJapaneseName || 'Unknown', 
              inline: true 
            },
            { name: '<:Cartodecrdito:1461770794517397718> Marriage Cost', value: `⏣ ${costText}`, inline: true },
            // { name: '📍 Source', value: waifu.source || 'anime-character-random', inline: true },
            // { name: 'Id of Waifu', value: waifu.id, inline: true },
            { 
              name: '<a:marryyy:1461768553513615515> Married At', 
              value: `<t:${Math.floor(new Date(waifu.marriedAt).getTime() / 1000)}:F>`, 
              inline: false 
            }
          ]);
      }

      return embed;
    }

    // Generate the action row with Previous, Next, and Stats buttons.
    function generateActionRow(page) {
      const prevDisabled = page === 0;
      const nextDisabled = page === waifus.length - 1;

      // Custom IDs unique for this message instance.
      const prevCustomId = `harem_prev_${message.id}`;
      const nextCustomId = `harem_next_${message.id}`;
      const statsCustomId = `harem_stats_${message.id}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(prevCustomId)
          .setLabel('Previous')
          // .setEmoji('◀️')
          .setStyle('Primary')
          .setDisabled(prevDisabled),
        new ButtonBuilder()
          .setCustomId(statsCustomId)
          .setLabel('Stats')
          .setEmoji('<a:st:1461771374799622183>')
          .setStyle('Secondary'),
        new ButtonBuilder()
          .setCustomId(nextCustomId)
          .setLabel('Next')
          // .setEmoji('▶️')
          .setStyle('Primary')
          .setDisabled(nextDisabled)
      );

      return { row, prevCustomId, nextCustomId, statsCustomId };
    }

    // Generate harem stats embed
    function generateStatsEmbed() {
      const totalWaifus = waifus.length;
      const rareWaifus = waifus.filter(w => w.isRare || (!w.characterName && !w.animeName)).length;
      const normalWaifus = totalWaifus - rareWaifus;
      const averageCost = totalWaifus > 0 ? Math.round(totalSpent / totalWaifus) : 0;
      
      // Get unique animes
      const uniqueAnimes = new Set();
      waifus.forEach(w => {
        if (w.animeName) uniqueAnimes.add(w.animeName);
      });

      // Most expensive waifu
      const mostExpensive = waifus.reduce((prev, current) => 
        (prev.cost > current.cost) ? prev : current, waifus[0]);

      const embed = new EmbedBuilder()
        .setTitle(`${message.author.username}'s Harem Statistics 📊`)
        // .setColor('#9932CC')
        .setThumbnail(message.author.displayAvatarURL())
        .addFields([
          { name: '<a:marryyy:1461768553513615515> Total Waifus', value: totalWaifus.toString(), inline: true },
          { name: 'Rare Waifus', value: rareWaifus.toString(), inline: true },
          { name: 'Normal Waifus', value: normalWaifus.toString(), inline: true },
          { name: '<:Cartodecrdito:1461770794517397718> Total Spent', value: `⏣ ${totalSpent.toLocaleString()}`, inline: true },
          { name: '<a:st:1461771374799622183> Average Cost', value: `⏣ ${averageCost.toLocaleString()}`, inline: true },
          { name: '📺 Unique Animes', value: uniqueAnimes.size.toString(), inline: true },
          { 
            name: '<a:p_:1461770534764155162> Most Expensive marriage!', 
            value: mostExpensive.characterName 
              ? `${mostExpensive.characterName} (⏣ ${mostExpensive.cost.toLocaleString()})`
              : `Rare Waifu (⏣ ${mostExpensive.cost.toLocaleString()})`, 
            inline: false 
          }
        ])
        .setFooter({ text: 'Use !w to add more waifus to your harem?! or do /mudae help' })
        .setTimestamp();

      return embed;
    }

    // Send the initial embed and buttons.
    const { row, prevCustomId, nextCustomId, statsCustomId } = generateActionRow(currentPage);
    const initialEmbed = generateEmbed(currentPage);
    const sentMessage = await message.channel.send({ embeds: [initialEmbed], components: [row] });

    // Register the Previous button handler.
    registerButton(prevCustomId, [userId], async (interaction) => {
      await deferSafe(interaction);

      if (currentPage > 0) currentPage--;
      const newEmbed = generateEmbed(currentPage);
      const { row: newRow } = generateActionRow(currentPage);
      try {
        await editSafe(interaction, { embeds: [newEmbed], components: [newRow] });
      } catch (error) {
        logger.error('Failed to update harem pagination (prev):', error);
      }
    });

    // Register the Next button handler.
    registerButton(nextCustomId, [userId], async (interaction) => {
      await deferSafe(interaction);

      if (currentPage < waifus.length - 1) currentPage++;
      const newEmbed = generateEmbed(currentPage);
      const { row: newRow } = generateActionRow(currentPage);
      try {
        await editSafe(interaction, { embeds: [newEmbed], components: [newRow] });
      } catch (error) {
        logger.error('Failed to update harem pagination (next):', error);
      }
    });

    // Register the Stats button handler.
    registerButton(statsCustomId, [userId], async (interaction) => {
      await deferSafe(interaction);

      const statsEmbed = generateStatsEmbed();
      
      // Back button to return to harem view
      const backButton = new ButtonBuilder()
        .setCustomId(`harem_back_${message.id}`)
        .setLabel('Back to Harem')
        .setEmoji('<a:marker_1326464173361856524:1342443432240746577>')
        .setStyle('Secondary');
      const backRow = new ActionRowBuilder().addComponents(backButton);

      try {
        await editSafe(interaction, { embeds: [statsEmbed], components: [backRow] });
      } catch (error) {
        logger.error('Failed to show harem stats:', error);
      }

      // Register back button
      registerButton(`harem_back_${message.id}`, [userId], async (backInteraction) => {
        await deferSafe(backInteraction);
        
        const newEmbed = generateEmbed(currentPage);
        const { row: newRow } = generateActionRow(currentPage);
        try {
          await editSafe(backInteraction, { embeds: [newEmbed], components: [newRow] });
        } catch (error) {
          logger.error('Failed to return to harem view:', error);
        }
      });
    });
  },
};