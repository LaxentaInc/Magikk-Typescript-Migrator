const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const mongoose = require('mongoose');
const economy = require('../../../utils/economyUtil');

// Reuse the schema from mudae.js/mudaeharem.js
const MarriageSchema = new mongoose.Schema({
    userId: String,
    username: String,
    waifus: [{
        id: String,
        url: String,
        marriedAt: { type: Date, default: Date.now },
        cost: Number,
        source: String,
        characterName: { type: String, default: null },
        animeName: { type: String, default: null },
        characterJapaneseName: { type: String, default: null },
        isRare: { type: Boolean, default: false }
    }],
    totalSpent: { type: Number, default: 0 }
});

const Marriage = mongoose.models.Marriage || mongoose.model('Marriage', MarriageSchema);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('harem')
        .setDescription('View your collection of married waifus')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('View another user\'s harem')
                .setRequired(false)
        )
        .setIntegrationTypes(0, 1)
        .setContexts(0, 1, 2),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const isSelf = targetUser.id === interaction.user.id;

        try {
            const harem = await Marriage.findOne({ userId: targetUser.id });

            // 1. Handle Empty/New User Case
            if (!harem || !harem.waifus || harem.waifus.length === 0) {
                const emptyEmbed = new EmbedBuilder()
                    .setTitle(`${targetUser.username}'s Harem`)
                    .setDescription(isSelf
                        ? "😭 **Your heart is empty... and so is this list.**\n\nDon't be lonely! Start your harem journey now:\n👉 **Run** \`/mudae help\` **or** \`!w\` **to find your first soulmate!**"
                        : `👻 **${targetUser.username} has no maidens.**\n\nThey haven't married anyone yet. Maybe tell them to play? using /mudae help and !w etc`
                    )
                    .setThumbnail(targetUser.displayAvatarURL());

                return interaction.editReply({ embeds: [emptyEmbed] });
            }

            // 2. Pagination Logic (Showcase Mode - 1 per page)
            const waifus = harem.waifus; // Prefix command uses array order (push adds to end, so index 0 is first married?)
            // Prefix command uses `waifus[page]`. 
            // If user wants newest first, we might need to reverse? 
            // The prefix code just does `const waifu = waifus[page]`. 
            // Let's stick to default order for "same as prefix".

            const totalWaifus = waifus.length;
            const totalSpent = harem.totalSpent || 0;
            let currentPage = 0;

            const generateEmbed = (page) => {
                const waifu = waifus[page];
                const costText = (typeof waifu.cost === 'number') ? waifu.cost.toLocaleString() : "N/A";

                const embed = new EmbedBuilder()
                    .setTitle(`${targetUser.username}'s Harem <a:marryyy:1461768553513615515>`)
                    .setDescription(`Displaying waifu ${page + 1} of ${totalWaifus}\n<:consolation:1461662922496544820> **Spent in marriages:** ⏣ ${totalSpent.toLocaleString()}`)
                    .setImage(waifu.url)
                    .setFooter({ text: `Page ${page + 1} / ${totalWaifus} • Married ${new Date(waifu.marriedAt).toLocaleDateString()}` });

                // Check if this is a rare waifu or has character data
                if (waifu.isRare || (!waifu.characterName && !waifu.animeName)) {
                    // Rare/mysterious waifu
                    embed
                        // .setColor('#FFD700') // Gold for rare
                        .addFields([
                            {
                                name: '<a:meninadancando:1461769664819364001> Rare Waifu!',
                                value: 'This is a legendary waifu they found while adventuring! Isn\'t She\'s absolutely stunning!',
                                inline: false
                            },
                            { name: '<:menheradoublethu:1461769918096867422> Marriage Cost', value: `⏣ ${costText}`, inline: true },
                            {
                                name: '<a:marryyy:1461768553513615515> Married At',
                                value: `<t:${Math.floor(new Date(waifu.marriedAt).getTime() / 1000)}:F>`,
                                inline: false
                            }
                        ]);
                } else {
                    // Normal waifu
                    embed
                        // .setColor('#FF69B4') // Pink for normal (Prefix commented out color?)
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
                            {
                                name: '<a:marryyy:1461768553513615515> Married At',
                                value: `<t:${Math.floor(new Date(waifu.marriedAt).getTime() / 1000)}:F>`,
                                inline: false
                            }
                        ]);
                }
                return embed;
            };

            const generateStatsEmbed = () => {
                const rareWaifus = waifus.filter(w => w.isRare || (!w.characterName && !w.animeName)).length;
                const normalWaifus = totalWaifus - rareWaifus;
                const averageCost = totalWaifus > 0 ? Math.round(totalSpent / totalWaifus) : 0;

                const uniqueAnimes = new Set();
                waifus.forEach(w => {
                    if (w.animeName) uniqueAnimes.add(w.animeName);
                });

                const mostExpensive = waifus.reduce((prev, current) =>
                    (prev.cost > current.cost) ? prev : current, waifus[0]);

                return new EmbedBuilder()
                    .setTitle(`${targetUser.username}'s Harem Statistics 📊`)
                    .setThumbnail(targetUser.displayAvatarURL())
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
            };

            const generateComponents = (page, isStats = false) => {
                const row = new ActionRowBuilder();

                if (isStats) {
                    const backBtn = new ButtonBuilder()
                        .setCustomId('back_to_harem')
                        .setLabel('Back to Harem')
                        .setEmoji('<a:marker_1326464173361856524:1342443432240746577>')
                        .setStyle(ButtonStyle.Secondary);
                    row.addComponents(backBtn);
                } else {
                    const prevBtn = new ButtonBuilder()
                        .setCustomId('prev_page')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(page === 0);

                    const statsBtn = new ButtonBuilder()
                        .setCustomId('view_stats')
                        .setLabel('Stats')
                        .setEmoji('<a:st:1461771374799622183>')
                        .setStyle(ButtonStyle.Secondary);

                    const nextBtn = new ButtonBuilder()
                        .setCustomId('next_page')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(page === totalWaifus - 1);

                    row.addComponents(prevBtn, statsBtn, nextBtn);
                }
                return [row];
            };

            // Initial Send
            const message = await interaction.editReply({
                embeds: [generateEmbed(currentPage)],
                components: generateComponents(currentPage)
            });

            // Collector
            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000 * 5 // 5 minutes
            });

            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ content: "This is not your harem view!", ephemeral: true });
                }

                if (i.customId === 'prev_page') {
                    currentPage = Math.max(0, currentPage - 1);
                    await i.update({ embeds: [generateEmbed(currentPage)], components: generateComponents(currentPage) });
                } else if (i.customId === 'next_page') {
                    currentPage = Math.min(totalWaifus - 1, currentPage + 1);
                    await i.update({ embeds: [generateEmbed(currentPage)], components: generateComponents(currentPage) });
                } else if (i.customId === 'view_stats') {
                    await i.update({ embeds: [generateStatsEmbed()], components: generateComponents(currentPage, true) });
                } else if (i.customId === 'back_to_harem') {
                    await i.update({ embeds: [generateEmbed(currentPage)], components: generateComponents(currentPage) });
                }
            });

            collector.on('end', () => {
                interaction.editReply({ components: [] }).catch(() => { });
            });

        } catch (error) {
            console.error("Harem Slash Command Error:", error);
            await interaction.editReply({ content: "An error occurred while fetching the harem." });
        }
    }
};
