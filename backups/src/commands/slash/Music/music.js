const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const {
    EMBED_COLORS,
    CUSTOM_ICON,
    formatTime,
    createGenericErrorEmbed,
    createLoadingEmbed,
    createPlayResponseEmbed,
    createEnhancedQueueEmbed,
    createSkipEmbed,
    createStopEmbed,
    createPauseEmbed,
    createLoopEmbed,
    createClearEmbed,
    createDisconnectEmbed
} = require('../../../handlers/player/embeds');
const {
    createDumbErrorEmbed,
    createDomainErrorEmbed,
    createSafeErrorEmbed,
    createPrivatePlaylistErrorEmbed
} = require('../../../handlers/player/error');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('music')
        .setDescription('Premium & Advanced music player for seamless music playback with homies in VC')
        .addSubcommand(subcommand =>
            subcommand
                .setName('play')
                .setDescription('Search and play music')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Song name, URL, or search term')
                        .setRequired(true)
                        .setMaxLength(500))
                .addStringOption(option =>
                    option.setName('source')
                        .setDescription('Preferred music source')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Auto (Spotify → YouTube)', value: 'auto' },
                            { name: 'Spotify', value: 'spotify' },
                            { name: 'YouTube', value: 'youtube' },
                            { name: 'SoundCloud', value: 'soundcloud' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('queue')
                .setDescription('View the current music queue'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('nowplaying')
                .setDescription('Show currently playing track'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('skip')
                .setDescription('Skip the current track'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('Stop music and clear queue'))
        // .addSubcommand(subcommand =>
        //     subcommand
        //         .setName('pause')
        //         .setDescription('Pause/resume playback'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('loop')
                .setDescription('Toggle loop modes')
                .addStringOption(option =>
                    option.setName('mode')
                        .setDescription('Loop mode')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Off', value: 'off' },
                            { name: 'Track', value: 'track' },
                            { name: 'Queue', value: 'queue' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear the queue'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('disconnect')
                .setDescription('Disconnect from voice channel'))
        .setDefaultMemberPermissions(PermissionFlagsBits.UseVoiceActivation),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        console.log(`\n🎵 MUSIC COMMAND: ${subcommand} by ${interaction.user.tag}`);

        try {
            await interaction.deferReply();

            switch (subcommand) {
                case 'play':
                    await handlePlay(interaction);
                    break;
                case 'queue':
                    await handleQueue(interaction);
                    break;
                case 'nowplaying':
                    await handleNowPlaying(interaction);
                    break;
                case 'skip':
                    await handleSkip(interaction);
                    break;
                case 'stop':
                    await handleStop(interaction);
                    break;
                // case 'pause':
                //     await handlePause(interaction);
                //     break;
                case 'loop':
                    await handleLoop(interaction);
                    break;
                case 'clear':
                    await handleClear(interaction);
                    break;
                case 'disconnect':
                    await handleDisconnect(interaction);
                    break;
                default:
                    await interaction.editReply({ content: 'Unknown subcommand!' });
            }
        } catch (error) {
            console.error(`❌ MUSIC COMMAND ERROR (${subcommand}):`, error);
            await handleError(interaction, error);
        }
    }
};


// ==================== PLAY SUBCOMMAND ====================
async function handlePlay(interaction) {
    const query = interaction.options.getString('query');
    const source = interaction.options.getString('source') || 'auto';

    // Voice validation
    const voiceCheck = await validateVoiceState(interaction);
    if (!voiceCheck.success) {
        return await interaction.editReply({ embeds: [createSafeErrorEmbed(voiceCheck.title, voiceCheck.message)] });
    }

    // Loading embed
    const loadingEmbed = createLoadingEmbed(`Searching for: **${query}**`, `Source: **${source.toUpperCase()}**`);
    await interaction.editReply({ embeds: [loadingEmbed] });

    try {
        // Check if URL
        const isUrl = /^https?:\/\//i.test(query);

        if (isUrl) {
            // 1. Check for Spotify Album - User requested "Dumb" error for this
            if (query.includes('open.spotify.com/album') || query.includes('spotify:album')) {
                return await interaction.editReply({
                    embeds: [createDumbErrorEmbed('album', interaction.user)]
                });
            }

            // 1.5. Check for Spotify Artist - User requested "Dumb" error for this too
            if (query.includes('open.spotify.com/artist') || query.includes('spotify:artist')) {
                return await interaction.editReply({
                    embeds: [createDumbErrorEmbed('artist', interaction.user)]
                });
            }

            // 2. Domain Allowlist Check
            const allowedDomains = [
                'youtube.com', 'youtu.be',
                'spotify.com',
                'soundcloud.com'
            ];

            const domainMatch = query.match(/^https?:\/\/(?:www\.)?([^/]+)/i);
            const domain = domainMatch ? domainMatch[1] : null;

            if (domain) {
                const isAllowed = allowedDomains.some(d => domain.includes(d));
                if (!isAllowed) {
                    return await interaction.editReply({
                        embeds: [createDomainErrorEmbed(domain, interaction.user)]
                    });
                }
            }
        }

        // Search for tracks
        let searchResult;
        try {
            if (isUrl) {
                // Direct URL - search any source
                searchResult = await interaction.client.searchTrack(query, interaction.user, source);
            } else {
                // Text search - use smart search or specific source
                searchResult = source === 'auto'
                    ? await interaction.client.smartSearch(query, interaction.user)
                    : await interaction.client.searchTrack(query, interaction.user, source);
            }
        } catch (searchError) {
            // Check if this is a private playlist error
            if (isUrl && query.includes('open.spotify.com/playlist')) {
                console.log('   ⚠️ Spotify playlist search failed, likely private:', searchError.message);
                return await interaction.editReply({
                    embeds: [createPrivatePlaylistErrorEmbed(interaction.user)]
                });
            }
            // Otherwise, rethrow the error
            throw searchError;
        }

        if (!searchResult?.data?.length) {
            // Check if this is likely a private playlist (Spotify playlist URL with no results)
            if (isUrl && query.includes('open.spotify.com/playlist')) {
                console.log('   ⚠️ Spotify playlist returned no results, likely private');
                return await interaction.editReply({
                    embeds: [createPrivatePlaylistErrorEmbed(interaction.user)]
                });
            }

            return await interaction.editReply({
                embeds: [createSafeErrorEmbed('No Results', `No tracks found for: **${query}**`)]
            });
        }

        // Get or create player
        const member = interaction.guild.members.cache.get(interaction.user.id);
        let player = interaction.client.getPlayer(interaction.guild.id);

        if (!player) {
            player = await interaction.client.createPlayer(
                interaction.guild.id,
                member.voice.channel.id,
                interaction.channel.id
            );
        }

        // If URL and single track/playlist, play immediately
        if (isUrl) {
            // Lavalink v4 uses lowercase loadType: 'playlist', 'track', 'search', 'empty', 'error'
            const isPlaylist = searchResult.loadType === 'playlist';
            const tracks = isPlaylist ? searchResult.data : [searchResult.data[0]];

            console.log(`   📋 Load type: ${searchResult.loadType}, Tracks: ${tracks.length}`);

            // Add all tracks to the queue at once - player.queue.add() accepts arrays
            player.queue.add(tracks);
            console.log(`   ✅ Added ${tracks.length} track(s) to queue`);

            // Start playback if not already playing
            let startedImmediately = false;
            if (!player.playing && !player.paused) {
                await player.play();
                startedImmediately = true;
                console.log(`   ▶️ Started playback`);
            }

            const responseEmbed = createPlayResponseEmbed(tracks, startedImmediately, player);
            return await interaction.editReply({ embeds: [responseEmbed] });
        }

        // Text search - use handler's search selection UI
        await interaction.client.displaySearchResults(
            interaction,
            searchResult.data,
            query,
            interaction.user
        );

    } catch (error) {
        console.error('❌ Play error:', error);
        throw error;
    }
}

// ==================== QUEUE SUBCOMMAND ====================
async function handleQueue(interaction) {
    const player = interaction.client.getPlayer(interaction.guild.id);

    // lavalink-client uses player.queue.current and player.queue.tracks
    if (!player || (!player.queue.current && player.queue.tracks.length === 0)) {
        return await interaction.editReply({
            embeds: [createSafeErrorEmbed('Empty Queue', 'No music is currently playing or queued.')]
        });
    }

    const queueEmbed = createEnhancedQueueEmbed(player);
    await interaction.editReply({ embeds: [queueEmbed] });
}

// ==================== NOW PLAYING SUBCOMMAND ====================
async function handleNowPlaying(interaction) {
    const player = interaction.client.getPlayer(interaction.guild.id);

    // lavalink-client uses player.queue.current
    if (!player || !player.queue.current) {
        return await interaction.editReply({
            embeds: [createSafeErrorEmbed('Nothing Playing', 'No music is currently playing.')]
        });
    }

    await interaction.client.sendNowPlayingEmbed(interaction, player, player.queue.current);
    await interaction.deleteReply();
}

// ==================== SKIP SUBCOMMAND ====================
async function handleSkip(interaction) {
    const player = interaction.client.getPlayer(interaction.guild.id);
    const voiceCheck = await validateVoiceWithPlayer(interaction, player);

    if (!voiceCheck.success) {
        return await interaction.editReply({ embeds: [createSafeErrorEmbed(voiceCheck.title, voiceCheck.message)] });
    }

    // lavalink-client uses player.queue.current and player.queue.tracks
    if (!player.queue.current) {
        return await interaction.editReply({
            embeds: [createSafeErrorEmbed('Nothing Playing', 'No track is currently playing.')]
        });
    }

    if (player.queue.tracks.length === 0) {
        return await interaction.editReply({
            embeds: [createSafeErrorEmbed('Cannot Skip', 'No tracks in queue to skip to.')]
        });
    }

    const currentTrack = player.queue.current?.title || player.queue.current?.info?.title || 'Unknown';
    const nextTrack = player.queue.tracks[0]?.title || player.queue.tracks[0]?.info?.title || 'Unknown';

    player.skipInProgress = true;
    await player.skip();

    const skipEmbed = createSkipEmbed(currentTrack, nextTrack);
    await interaction.editReply({ embeds: [skipEmbed] });
}

// ==================== STOP SUBCOMMAND ====================
async function handleStop(interaction) {
    const player = interaction.client.getPlayer(interaction.guild.id);
    const voiceCheck = await validateVoiceWithPlayer(interaction, player);

    if (!voiceCheck.success) {
        return await interaction.editReply({ embeds: [createSafeErrorEmbed(voiceCheck.title, voiceCheck.message)] });
    }

    // lavalink-client: clear queue with splice, stop playback
    const queueSize = player.queue.tracks.length;
    player.queue.tracks.splice(0, queueSize); // Clear all tracks
    await player.stopPlaying();

    const stopEmbed = createStopEmbed(queueSize);
    await interaction.editReply({ embeds: [stopEmbed] });
}

// ==================== PAUSE SUBCOMMAND ====================
async function handlePause(interaction) {
    const player = interaction.client.getPlayer(interaction.guild.id);
    const voiceCheck = await validateVoiceWithPlayer(interaction, player);

    if (!voiceCheck.success) {
        return await interaction.editReply({ embeds: [createSafeErrorEmbed(voiceCheck.title, voiceCheck.message)] });
    }

    const wasPaused = player.paused;
    await player.setPause(!wasPaused);

    const pauseEmbed = createPauseEmbed(wasPaused);
    await interaction.editReply({ embeds: [pauseEmbed] });
}

// ==================== LOOP SUBCOMMAND ====================
async function handleLoop(interaction) {
    const player = interaction.client.getPlayer(interaction.guild.id);
    const voiceCheck = await validateVoiceWithPlayer(interaction, player);

    if (!voiceCheck.success) {
        return await interaction.editReply({ embeds: [createSafeErrorEmbed(voiceCheck.title, voiceCheck.message)] });
    }

    const mode = interaction.options.getString('mode');

    if (mode) {
        player.loop = mode;
    } else {
        const modes = ['off', 'track', 'queue'];
        const currentIndex = modes.indexOf(player.loop || 'off');
        player.loop = modes[(currentIndex + 1) % modes.length];
    }

    const loopEmbed = createLoopEmbed(player.loop);
    await interaction.editReply({ embeds: [loopEmbed] });
}

// ==================== CLEAR SUBCOMMAND ====================
async function handleClear(interaction) {
    const player = interaction.client.getPlayer(interaction.guild.id);
    const voiceCheck = await validateVoiceWithPlayer(interaction, player);

    if (!voiceCheck.success) {
        return await interaction.editReply({ embeds: [createSafeErrorEmbed(voiceCheck.title, voiceCheck.message)] });
    }

    const queueSize = interaction.client.clearQueue(interaction.guild.id);

    const clearEmbed = createClearEmbed(queueSize);

    await interaction.editReply({ embeds: [clearEmbed] });
}

// ==================== DISCONNECT SUBCOMMAND ====================
async function handleDisconnect(interaction) {
    const player = interaction.client.getPlayer(interaction.guild.id);
    const voiceCheck = await validateVoiceWithPlayer(interaction, player);

    if (!voiceCheck.success) {
        return await interaction.editReply({ embeds: [createSafeErrorEmbed(voiceCheck.title, voiceCheck.message)] });
    }

    interaction.client.destroyPlayer(interaction.guild.id);

    const disconnectEmbed = createDisconnectEmbed();

    await interaction.editReply({ embeds: [disconnectEmbed] });
}

// ==================== HELPER FUNCTIONS ====================
async function validateVoiceState(interaction) {
    // Check if guild is null (edge case that causes crashes)
    if (!interaction.guild) {
        return { success: false, title: 'Invalid Context', message: 'This command can only be used in a server.' };
    }

    const member = interaction.guild.members.cache.get(interaction.user.id);
    const memberVoice = member?.voice?.channel;
    const botVoice = interaction.guild.members.me?.voice?.channel;

    if (!memberVoice) {
        return { success: false, title: 'Join Voice Channel', message: 'You need to be in a voice channel to use music commands.' };
    }

    const voicePermissions = memberVoice.permissionsFor(interaction.client.user);
    if (!voicePermissions.has(['Connect', 'Speak'])) {
        return { success: false, title: 'Missing Permissions', message: `I need Connect and Speak permissions in **${memberVoice.name}**.` };
    }

    if (botVoice && memberVoice.id !== botVoice.id) {
        return { success: false, title: 'Different Voice Channel', message: `I'm already in **${botVoice.name}**. Join that channel or disconnect me first.` };
    }

    return { success: true };
}

async function validateVoiceWithPlayer(interaction, player) {
    if (!player) {
        return { success: false, title: 'No Active Player', message: 'No music session is currently active.' };
    }

    const member = interaction.guild.members.cache.get(interaction.user.id);
    const memberVoice = member?.voice?.channelId;
    const botVoice = interaction.guild.members.me?.voice?.channelId;

    if (memberVoice !== botVoice) {
        return { success: false, title: 'Same Voice Channel Required', message: 'You need to be in the same voice channel as me.' };
    }

    return { success: true };
}

async function handleError(interaction, error) {
    let errorMessage = 'An unexpected error occurred.';
    let errorDetails = error.message;

    if (error.message.includes('No available nodes')) {
        errorMessage = 'Music service is temporarily unavailable.';
        errorDetails = 'Please try again in a few moments.';
    } else if (error.message.includes('Failed to resolve')) {
        errorMessage = 'Could not find the requested music.';
        errorDetails = 'Try a different search term or URL.';
    } else if (error.message.includes('Unknown interaction')) {
        return;
    }

    const { EmbedBuilder } = require('discord.js');
    const errorEmbed = new EmbedBuilder()
        //.setColor(EMBED_COLORS.ERROR) // Removed per user request
        .setAuthor({ name: '❌ Command Failed', iconURL: CUSTOM_ICON })
        .setDescription(errorMessage)
        .addFields({ name: 'Error Details', value: `\`\`\`${errorDetails.slice(0, 200)}\`\`\`` })
        .setTimestamp();

    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [errorEmbed] });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    } catch (replyError) {
        console.error('Failed to send error message:', replyError);
    }
}