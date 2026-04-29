const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { createPlayer, getPlayer } = require('./manager');
const {
    createControlButtons,
    createSearchEmbed,
    createTrackAddedEmbed,
    createQueueEmbed,
    EMBED_COLORS
} = require('./embeds');
const { EmbedBuilder } = require('discord.js');

// Store active collectors
const activeCollectors = new Map();
const searchCollectors = new Map();

function cleanupCollector(guildId) {
    if (activeCollectors.has(guildId)) {
        try {
            activeCollectors.get(guildId).stop();
        } catch (error) { }
        activeCollectors.delete(guildId);
    }
}

function cleanupSearchCollector(userId) {
    if (searchCollectors.has(userId)) {
        try {
            searchCollectors.get(userId).stop();
        } catch (error) { }
        searchCollectors.delete(userId);
    }
}

/**
 * Play a track - adds to queue and starts if not playing
 * FIXED: Passes the track with encoded property correctly
 */
async function playTrack(player, track) {
    console.log(`\n▶️ PLAY TRACK requested: ${track.title}`);
    console.log(`   Current track: ${player.queue.current?.title || player.queue.current?.info?.title || 'None'}`);
    console.log(`   Queue length: ${player.queue.tracks.length}`);

    try {
        // Add track to queue - lavalink-client needs the encoded property
        player.queue.add(track);

        console.log(`   Queue after add: ${player.queue.tracks.length}`);

        // If nothing is currently playing, start immediately
        if (!player.playing && !player.paused) {
            console.log(`   ✅ No track playing, starting immediately`);
            await player.play();
            return true;
        } else {
            console.log(`   📋 Track added to queue`);
            return false;
        }
    } catch (error) {
        console.error('❌ Failed to play track:', error.message);
        throw error;
    }
}

/**
 * Skip to next track
 */
async function skipTrack(player, interaction) {
    console.log(`\n⏭️ SKIP requested for guild ${player.guildId}`);

    try {
        const hasNextTrack = player.queue.tracks.length > 0;

        if (!hasNextTrack) {
            console.log(`   ❌ No tracks in queue to skip to`);
            // Still stop current track
            await player.stopPlaying();
            return await interaction.reply({
                content: 'No more tracks in queue. Stopping playback.',
                ephemeral: true
            });
        }

        player.skipInProgress = true;
        cleanupCollector(player.guildId);

        await player.skip();
        console.log(`   ✅ Successfully skipped track`);

        await interaction.reply({
            content: `⏭️ Skipped to next track!`,
            ephemeral: true
        });

    } catch (error) {
        console.error('❌ Skip track error:', error.message);
        player.skipInProgress = false;

        await interaction.reply({
            content: 'Failed to skip track! Please try again.',
            ephemeral: true
        }).catch(() => { });
    }
}

/**
 * Stop music and clear queue
 */
async function stopMusic(player, interaction, message) {
    console.log(`\n⏹️ STOP requested for guild ${player.guildId}`);
    try {
        const queueSize = player.queue.tracks.length;
        console.log(`   Clearing queue (${queueSize} tracks)`);
        player.queue.tracks.splice(0, queueSize); // Clear all tracks

        cleanupCollector(player.guildId);

        await player.stopPlaying();

        const disabledControlButtons = createControlButtons(player, true);
        await interaction.update({ components: [disabledControlButtons] });
        await interaction.followUp({
            content: 'Music stopped and queue cleared!',
            flags: 64 // ephemeral
        });

        console.log(`   ✅ Music stopped and queue cleared`);
    } catch (error) {
        console.error('❌ Stop music error:', error.message);
    }
}

/**
 * Toggle loop mode
 */
async function toggleLoop(player, interaction, message) {
    try {
        const modes = ['off', 'track', 'queue'];
        const currentIndex = modes.indexOf(player.loop);
        const nextMode = modes[(currentIndex + 1) % modes.length];
        player.loop = nextMode;

        // Set lavalink-client repeat mode
        if (nextMode === 'off') {
            player.setRepeatMode('off');
        } else if (nextMode === 'track') {
            player.setRepeatMode('track');
        } else if (nextMode === 'queue') {
            player.setRepeatMode('queue');
        }

        console.log(`\n🔁 Loop mode changed to: ${nextMode}`);

        const newControlButtons = createControlButtons(player);
        await interaction.update({ components: [newControlButtons] });
        await interaction.followUp({
            content: `Loop mode: **${nextMode.toUpperCase()}**`,
            ephemeral: true
        });
    } catch (error) {
        console.error('❌ Toggle loop error:', error.message);
    }
}

/**
 * Show queue
 */
async function showQueue(player, interaction) {
    console.log(`\n📋 Queue requested for guild ${player.guildId}`);
    try {
        if (player.queue.tracks.length === 0) {
            return await interaction.reply({
                content: 'Queue is empty!',
                ephemeral: true
            });
        }

        const queueEmbed = createQueueEmbed(player);

        await interaction.reply({
            embeds: [queueEmbed],
            ephemeral: true
        });

        console.log(`   Displayed ${Math.min(10, player.queue.tracks.length)} of ${player.queue.tracks.length} tracks`);
    } catch (error) {
        console.error('❌ Show queue error:', error.message);
    }
}

/**
 * Clear queue
 */
function clearQueue(player) {
    if (!player) return false;

    const queueLength = player.queue.tracks.length;
    player.queue.tracks.splice(0, queueLength); // Clear all tracks
    console.log(`🗑️ Cleared queue (${queueLength} tracks removed)`);
    return queueLength;
}

/**
 * Handle button interactions
 */
async function handleButtonInteraction(buttonInteraction, player, message, client) {
    // Fetch fresh player to avoid stale state in closures
    const freshPlayer = getPlayer(client, buttonInteraction.guild.id);

    if (!freshPlayer) {
        return await buttonInteraction.reply({
            content: '❌ Player session expired or not found.',
            ephemeral: true
        });
    }

    const member = buttonInteraction.guild.members.cache.get(buttonInteraction.user.id);
    const memberVoice = member?.voice?.channelId;
    const botVoice = buttonInteraction.guild.members.me?.voice?.channelId;

    if (memberVoice !== botVoice) {
        return await buttonInteraction.reply({
            content: 'You need to be in the same voice channel as me to use controls!',
            ephemeral: true
        });
    }

    switch (buttonInteraction.customId) {
        case 'music_pause_resume':
            const wasPaused = freshPlayer.paused;
            await freshPlayer.setPause(!wasPaused);
            console.log(`   ${wasPaused ? 'Resumed' : 'Paused'} playback`);

            const newControlButtons = createControlButtons(freshPlayer);
            await buttonInteraction.update({ components: [newControlButtons] });
            break;

        case 'music_skip':
            await skipTrack(freshPlayer, buttonInteraction);
            break;

        case 'music_stop':
            await stopMusic(freshPlayer, buttonInteraction, message);
            break;

        case 'music_loop':
            await toggleLoop(freshPlayer, buttonInteraction, message);
            break;

        case 'music_queue':
            await showQueue(freshPlayer, buttonInteraction);
            break;
    }
}

/**
 * Display search results with selection buttons
 */
async function displaySearchResults(client, interaction, tracks, query, requester, sendNowPlayingEmbed) {
    console.log(`\n🔍 Displaying ${tracks.length} search results for: "${query}"`);

    try {
        cleanupSearchCollector(interaction.user.id);

        const displayTracks = tracks.slice(0, 7);
        const searchEmbed = createSearchEmbed(displayTracks, query, interaction);

        const buttonRows = [];
        const firstRow = new ActionRowBuilder();
        const secondRow = new ActionRowBuilder();

        for (let i = 0; i < displayTracks.length; i++) {
            const button = new ButtonBuilder()
                .setCustomId(`select_track_${i}`)
                .setLabel(`${i + 1}`)
                .setStyle(ButtonStyle.Primary);

            if (i < 4) {
                firstRow.addComponents(button);
            } else {
                secondRow.addComponents(button);
            }
        }

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_search')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('<a:NoSpamming_1326464261953818664:1342443519070961684>');

        if (displayTracks.length <= 4) {
            firstRow.addComponents(cancelButton);
            buttonRows.push(firstRow);
        } else {
            secondRow.addComponents(cancelButton);
            buttonRows.push(firstRow, secondRow);
        }

        const message = await interaction.editReply({
            embeds: [searchEmbed],
            components: buttonRows
        });

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 30000,
            filter: (i) => i.user.id === interaction.user.id
        });

        searchCollectors.set(interaction.user.id, collector);

        collector.on('collect', async (buttonInteraction) => {
            try {
                if (buttonInteraction.customId === 'cancel_search') {
                    await buttonInteraction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(EMBED_COLORS.WARNING)
                                .setDescription('❌ Search cancelled!')
                        ],
                        components: []
                    });
                    collector.stop();
                    return;
                }

                const trackIndex = parseInt(buttonInteraction.customId.split('_')[2]);
                const selectedTrack = displayTracks[trackIndex];

                if (!selectedTrack) {
                    await buttonInteraction.reply({
                        content: '❌ Invalid track selection!',
                        ephemeral: true
                    });
                    return;
                }

                selectedTrack.requester = requester;

                const member = buttonInteraction.guild.members.cache.get(buttonInteraction.user.id);
                if (!member?.voice?.channelId) {
                    await buttonInteraction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(EMBED_COLORS.ERROR)
                                .setDescription('❌ You need to be in a voice channel!')
                        ],
                        components: []
                    });
                    collector.stop();
                    return;
                }

                let player = getPlayer(client, buttonInteraction.guild.id);

                if (!player) {
                    player = await createPlayer(
                        client,
                        buttonInteraction.guild.id,
                        member.voice.channelId,
                        buttonInteraction.channel.id
                    );
                }

                const isPlaying = await playTrack(player, selectedTrack);

                const successEmbed = createTrackAddedEmbed(
                    selectedTrack,
                    player,
                    isPlaying,
                    buttonInteraction.user
                );

                await buttonInteraction.update({
                    embeds: [successEmbed],
                    components: []
                });

                if (isPlaying && sendNowPlayingEmbed) {
                    // Now playing embed is handled by trackStart event
                }

                collector.stop();

            } catch (error) {
                console.error('❌ Search selection error:', error.message);
                try {
                    await buttonInteraction.reply({
                        content: '❌ Failed to play the selected track!',
                        ephemeral: true
                    });
                } catch (replyError) {
                    console.error('❌ Failed to send error reply:', replyError.message);
                }
            }
        });

        collector.on('end', async (collected, reason) => {
            searchCollectors.delete(interaction.user.id);

            if (reason === 'time') {
                try {
                    await message.edit({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(EMBED_COLORS.WARNING)
                                .setDescription('⏱️ Search selection timed out!')
                        ],
                        components: []
                    });
                } catch (error) { }
            }
        });

    } catch (error) {
        console.error('❌ Failed to display search results:', error.message);
        throw error;
    }
}

module.exports = {
    playTrack,
    skipTrack,
    stopMusic,
    toggleLoop,
    showQueue,
    clearQueue,
    handleButtonInteraction,
    displaySearchResults,
    cleanupCollector,
    cleanupSearchCollector,
    activeCollectors,
    searchCollectors
};
