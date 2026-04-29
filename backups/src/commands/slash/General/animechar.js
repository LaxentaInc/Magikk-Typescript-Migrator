const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const WaifuFetcher = require('../../../utils/AnimeListScraper');
const NodeCache = require('node-cache');
const economy = require('../../../utils/economyUtil');
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
module.exports = {
    data: new SlashCommandBuilder()
        .setName('animechar')
        .setDescription('Guess the anime character for coins!')
        .setIntegrationTypes(0, 1)
        .setContexts(0, 1, 2),

    async execute(interaction) {
        await playGame(interaction);
    },
};

async function createGameEmbed(animeData, username, userAvatar, clientAvatar) {
    const startMessages = [
        `<a:zzapinkheartexclam_1327982490144:1342442561297711175> Alright ${username}, who dis? 👀`,
        `<a:zzapinkheartexclam_1327982490144:1342442561297711175> Bet you can't guess this one! 🎯`,
        `<a:zzapinkheartexclam_1327982490144:1342442561297711175> Time to flex that anime knowledge! 💪`,
        `<a:zzapinkheartexclam_1327982490144:1342442561297711175> Good luck, you'll need it!`,
        `<a:zzapinkheartexclam_1327982490144:1342442561297711175> Ready to test your weeb powers? ⚡`
    ];

    return new EmbedBuilder()
        .setTitle('<a:Q__1327982827844927552:1342443037371928627> Guess The Anime Character!')
        .setAuthor({
            name: `${username} is playing!`,
            iconURL: userAvatar
        })
        .setDescription(`**From:** ${animeData.AnimeName}\n\n${startMessages[Math.floor(Math.random() * startMessages.length)]}\n\n<a:ansparkles_1326464249609977897:1342443376842248282> **Prize:** 5k coins for correct answer!`)
        .setImage(animeData.CharacterImage)
        .setColor('#FF69B4')
        .setFooter({
            text: 'y got 1 min; no pressure',
            iconURL: clientAvatar
        })
        .setTimestamp();
}

async function createSelectMenu(animeData) {
    const otherChars = animeData.OtherCharacterList.slice(0, 3);
    const allOptions = [...otherChars, animeData.CharacterName];
    const shuffledOptions = allOptions.sort(() => Math.random() - 0.5);

    return new StringSelectMenuBuilder()
        .setCustomId('character_select')
        .setPlaceholder('Pick your guess!')
        .addOptions(
            shuffledOptions.map((char, index) => ({
                label: char.length > 100 ? char.substring(0, 97) + '...' : char,
                description: `Option ${['A', 'B', 'C', 'D'][index]}`,
                value: char
            }))
        );
}

async function fetchAnimeData() {
    try {
        return await Promise.race([
            WaifuFetcher.getCharacterData(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('API_TIMEOUT')), 8000)
            )
        ]);
    } catch (error) {
        throw new Error(error.message === 'API_TIMEOUT' ? 'API_TIMEOUT' : 'API_ERROR');
    }
}

async function handleGameResult(interaction, selectedAnswer, animeData, message) {
    const correctAnswer = animeData.CharacterName;
    const isCorrect = selectedAnswer === correctAnswer;

    let resultEmbed;

    if (isCorrect) {
        const newBalance = await economy.updateBalance(interaction.user.id, 5000);

        const winMessages = [
            `YOOO YOU GOT IT!`,
            `Sheesh, you actually knew that?`,
            `W GAMER MOMENT! 🏆`,
            `Built different fr fr`,
            `Touch grass? Nah, touch moniiiiiiiiii!`
        ];

        resultEmbed = new EmbedBuilder()
            .setTitle('Nice! +5,000 COINS!')
            .setDescription(`${winMessages[Math.floor(Math.random() * winMessages.length)]}\n\nThe answer was **${correctAnswer}** and you nailed it!\n\n💰 **New Balance:** ${newBalance.toLocaleString()} coins`)
            .setThumbnail(animeData.CharacterImage)
            .setColor('#00FF00')
            .addFields([
                { name: '📝 Character', value: correctAnswer, inline: true },
                { name: '📺 Anime', value: animeData.AnimeName, inline: true },
                { name: '🇯🇵 JP Name', value: animeData.CharacterJapaneseName || 'Unknown', inline: true }
            ])
            .setFooter({ text: 'Keep grinding for more coins!' })
            .setTimestamp();
    } else {
        const loseMessages = [
            `Bruh... really?`,
            `That ain't it chief 😔`,
            `Mission failed, we'll get em next time`,
            `Oof`,
            `*sad anime noises* 😢`
        ];

        resultEmbed = new EmbedBuilder()
            .setTitle('WRONG! No moni for you!')
            .setDescription(`${loseMessages[Math.floor(Math.random() * loseMessages.length)]}\n\nYou picked **${selectedAnswer}** but it was actually **${correctAnswer}**\n\nBetter luck next time!`)
            .setThumbnail(animeData.CharacterImage)
            .setColor('#FF0000')
            .addFields([
                { name: '📝 Character', value: correctAnswer, inline: true },
                { name: '📺 Anime', value: animeData.AnimeName, inline: true },
                { name: '🇯🇵 JP Name', value: animeData.CharacterJapaneseName || 'Unknown', inline: true }
            ])
            .setFooter({ text: 'Try again to earn monii!' })
            .setTimestamp();
    }

    const nextButton = new ButtonBuilder()
        .setCustomId('next_game')
        .setLabel('Next Character')
        .setEmoji('<a:ansparkles_1326464249609977897:1342443376842248282>')
        .setStyle(ButtonStyle.Primary);

    const buttonRow = new ActionRowBuilder().addComponents(nextButton);

    return { embed: resultEmbed, components: [buttonRow] };
}

async function handleTimeout(interaction, animeData, username) {
    const timeoutMessages = [
        `Bro fell asleep 😴`,
        `Hello? Earth to ${username}? 🌍`,
        `AFK moment detected 🤖`,
        `*crickets chirping* 🦗`,
        `Guess the timer was the real enemy 🕐`
    ];

    const timeoutEmbed = new EmbedBuilder()
        .setTitle('⏰ TIME\'S UP! You snooze, you lose!')
        .setDescription(`${timeoutMessages[Math.floor(Math.random() * timeoutMessages.length)]}\n\nThe answer was **${animeData.CharacterName}**\n\nNo coins for being AFK!`)
        .setThumbnail(animeData.CharacterImage)
        .setColor('#FFA500')
        .addFields([
            { name: '📝 Character', value: animeData.CharacterName, inline: true },
            { name: '📺 Anime', value: animeData.AnimeName, inline: true },
            { name: '🇯🇵 JP Name', value: animeData.CharacterJapaneseName || 'Unknown', inline: true }
        ])
        .setFooter({ text: 'React faster next time!' })
        .setTimestamp();

    try {
        await interaction.editReply({
            embeds: [timeoutEmbed],
            components: []
        });
    } catch (error) {
        console.error('timeout update failed:', error.message);
    }
}

async function startNewRound(btnInteraction, originalInteraction, message) {
    try {
        // CRITICAL: Defer immediately to acknowledge the click and prevent multi-click
        await btnInteraction.deferUpdate();

        const animeData = await fetchAnimeData();

        const embed = await createGameEmbed(
            animeData,
            originalInteraction.user.username,
            originalInteraction.user.displayAvatarURL(),
            originalInteraction.client.user.displayAvatarURL()
        );

        const selectMenu = await createSelectMenu(animeData);
        const row = new ActionRowBuilder().addComponents(selectMenu);

        // Use editReply on the original interaction (works in DMs)
        await originalInteraction.editReply({ embeds: [embed], components: [row] });

        return await runGameCollectors(originalInteraction, message, animeData);

    } catch (error) {
        console.error('New round error:', error);

        const errorEmbed = new EmbedBuilder()
            .setTitle('💥 Something went wrong!')
            .setDescription(error.message === 'API_TIMEOUT'
                ? 'The anime API is taking too long to respond. Try again in a bit!'
                : 'The anime API is having issues right now. Try again in a bit!'
            )
            .setColor('#FF0000')
            .setFooter({ text: `Error Code: ${error.message}` });

        try {
            await originalInteraction.editReply({ embeds: [errorEmbed], components: [] });
        } catch (editError) {
            console.error('Failed to show error:', editError.message);
        }
    }
}

async function runGameCollectors(interaction, message, animeData) {
    const filter = (i) => i.user.id === interaction.user.id && i.customId === 'character_select';

    const collector = message.createMessageComponentCollector({
        filter,
        componentType: ComponentType.StringSelect,
        max: 1,
        time: 60000
    });

    let gameEnded = false;

    collector.on('collect', async (i) => {
        if (gameEnded) return;
        gameEnded = true;

        try {
            const selectedAnswer = i.values[0];
            const result = await handleGameResult(i, selectedAnswer, animeData, message);

            // Update using interaction (works in DMs)
            await i.update({
                embeds: [result.embed],
                components: result.components
            });

            // Handle next game button
            const buttonFilter = (btnI) => btnI.customId === 'next_game' && btnI.user.id === interaction.user.id;
            const buttonCollector = message.createMessageComponentCollector({
                filter: buttonFilter,
                componentType: ComponentType.Button,
                time: 300000, // 5 minutes
                max: 1
            });

            buttonCollector.on('collect', async (btnI) => {
                await startNewRound(btnI, interaction, message);
            });

            buttonCollector.on('end', async (collected) => {
                if (collected.size === 0) {
                    try {
                        const currentComponents = message.components;
                        if (currentComponents.length > 0) {
                            const disabledComponents = currentComponents.map(row => {
                                const newRow = new ActionRowBuilder();
                                row.components.forEach(component => {
                                    if (component.type === ComponentType.Button) {
                                        newRow.addComponents(
                                            ButtonBuilder.from(component).setDisabled(true)
                                        );
                                    }
                                });
                                return newRow;
                            });

                            const fetchedReply = await interaction.fetchReply();
                            await interaction.editReply({
                                embeds: fetchedReply.embeds,
                                components: disabledComponents
                            });
                        }
                    } catch (error) {
                        console.log('Button cleanup failed:', error.message);
                    }
                }
            });

        } catch (error) {
            console.error('Collection handling error:', error);
        }
    });

    collector.on('end', async (collected) => {
        if (collected.size === 0 && !gameEnded) {
            gameEnded = true;
            await handleTimeout(interaction, animeData, interaction.user.username);
        }
    });

    // Cleanup listener
    setTimeout(() => {
        if (!collector.ended) {
            collector.stop();
        }
    }, 65000);
}

async function playGame(interaction) {
    try {
        await interaction.deferReply();

        const animeData = await fetchAnimeData();

        const embed = await createGameEmbed(
            animeData,
            interaction.user.username,
            interaction.user.displayAvatarURL(),
            interaction.client.user.displayAvatarURL()
        );

        const selectMenu = await createSelectMenu(animeData);
        const row = new ActionRowBuilder().addComponents(selectMenu);

        const message = await interaction.editReply({ embeds: [embed], components: [row] });

        await runGameCollectors(interaction, message, animeData);

    } catch (error) {
        console.error('Anime char command error:', error);

        const errorEmbed = new EmbedBuilder()
            .setTitle('💥 Something went wrong!')
            .setDescription(error.message === 'API_TIMEOUT'
                ? 'The anime API is taking too long to respond. Try again in a bit!'
                : 'The anime API is having issues right now. Try again in a bit!'
            )
            .setColor('#FF0000')
            .setFooter({ text: `Error Code: ${error.message}` });

        try {
            if (interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed], components: [] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        } catch (err) {
            console.error('Error sending error message:', err);
        }
    }
}