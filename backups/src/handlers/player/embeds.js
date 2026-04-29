const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Same embed colors from original
const EMBED_COLORS = {
    NOW_PLAYING: '#5865F2',
    ERROR: '#FF0000',
    SUCCESS: '#2ECC71',
    WARNING: '#FFA500',
    INFO: '#7289DA',
    SPOTIFY: '#1DB954',
    YOUTUBE: '#FF0000',
    SOUNDCLOUD: '#FF5500'
};

const CUSTOM_ICON = 'https://media.tenor.com/Sb0yPHMgNaUAAAAj/music-disc.gif';

const SOURCE_INFO = {
    spotify: { icon: 'Spotify', color: EMBED_COLORS.SPOTIFY, name: 'Spotify' },
    youtube: { icon: 'YouTube', color: EMBED_COLORS.YOUTUBE, name: 'YouTube' },
    soundcloud: { icon: 'SoundCloud', color: EMBED_COLORS.SOUNDCLOUD, name: 'SoundCloud' },
    bandcamp: { icon: 'Bandcamp', color: '#629aa0', name: 'Bandcamp' },
    twitch: { icon: 'Twitch', color: '#9146ff', name: 'Twitch' },
    http: { icon: 'Direct Link', color: EMBED_COLORS.INFO, name: 'Direct Link' }
};

// Enhanced time formatter
function formatTime(ms) {
    if (!ms || isNaN(ms)) return '0:00';

    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));

    return hours > 0
        ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        : `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Truncate string to max length
 */
function truncate(str, maxLength) {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
}

/**
 * Create control buttons for the player
 */
function createControlButtons(player, disabled = false) {
    return new ActionRowBuilder()
        .addComponents(
            // new ButtonBuilder()
            //     .setCustomId('music_pause_resume')
            //     .setEmoji(player.paused ? '▶️' : '⏸️')
            //     .setLabel(player.paused ? 'Resume' : 'Pause')
            //     .setStyle(ButtonStyle.Primary)
            //     .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId('music_skip')
                .setEmoji('<a:marker_1326464173361856524:1342443432240746577>')
                .setLabel('Skip')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId('music_stop')
                .setEmoji('<a:no:1342443519070961684>')
                .setLabel('Stop')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId('music_loop')
                .setEmoji(player.loop === 'off' ? '🔁' : player.loop === 'track' ? '🔂' : '🔁')
                .setLabel(player.loop === 'off' ? 'Loop Off' : player.loop === 'track' ? 'Track' : 'Queue')
                .setStyle(player.loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId('music_queue')
                .setEmoji('<a:VinylRecord_1338415159672307806:1342442912746704998>')
                .setLabel('Queue')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled)
        );
}

/**
 * Create the Now Playing embed
 */
function createNowPlayingEmbed(track, player, client) {
    const sourceInfo = SOURCE_INFO[track.sourceName] || SOURCE_INFO.http;

    return new EmbedBuilder()
        .setAuthor({
            name: `Now Playing`,
            iconURL: CUSTOM_ICON
        })
        .setTitle(`${track.title || 'Unknown title'}`)
        .setURL(track.uri || null)
        .setThumbnail(track.artworkUrl || CUSTOM_ICON)
        .addFields(
            { name: '<a:ansparkles_1326464249609977897:1342443376842248282> Artist', value: `\`${track.author || 'Unknown'}\``, inline: true },
            { name: '<a:loading:1333357988953460807> Duration', value: `\`${formatTime(track.duration)}\``, inline: true },
            { name: 'Loop', value: `\`${player.loop}\``, inline: true },
            { name: '<a:VinylRecord_1338415159672307806:1342442912746704998> Source', value: `${sourceInfo.name || 'Spotify'}`, inline: true },
            { name: '<a:HeheAnimated_1327983123924783155:1342442846887608404> Requested by', value: `<@${track.requester?.id || '0'}>`, inline: true },
            { name: '<a:MusicalHearts_133841522715420263:1342442813648011266> Queue', value: `\`${player.queue.tracks.length} tracks\``, inline: true }
        )
        .setFooter({
            text: `@AeroChan | By @laxenta | Controls Auto-expire in 5 minutes`,
            iconURL: client.user.displayAvatarURL()
        })
        .setTimestamp();
}

/**
 * Create search results embed
 */
function createSearchEmbed(tracks, query, interaction) {
    const embed = new EmbedBuilder()
        .setAuthor({
            name: '🔍 Search Results',
            iconURL: CUSTOM_ICON
        })
        .setDescription(`**Query:** \`${query}\`\n\nSelect a track to play:`)
        .setFooter({
            text: `Selection expires in 30 seconds | Requested by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
        })
        .setTimestamp();

    tracks.slice(0, 7).forEach((track, index) => {
        const duration = formatTime(track.duration);
        const sourceInfo = SOURCE_INFO[track.sourceName] || SOURCE_INFO.http;

        embed.addFields({
            name: `${index + 1}. ${track.title || 'Unknown'}`,
            value: `**Artist:** \`${track.author || 'Unknown'}\`\n**Duration:** \`${duration}\` | **Source:** ${sourceInfo.name}`,
            inline: false
        });
    });

    return embed;
}

/**
 * Create success embed after track selection
 */
function createTrackAddedEmbed(track, player, isPlaying, user) {
    const sourceInfo = SOURCE_INFO[track.sourceName] || SOURCE_INFO.http;

    return new EmbedBuilder()
        .setColor(EMBED_COLORS.SUCCESS)
        .setAuthor({
            name: isPlaying ? '▶️ Now Playing' : '➕ Added to Queue',
            iconURL: CUSTOM_ICON
        })
        .setTitle(track.title || 'Unknown')
        .setURL(track.uri || null)
        .setThumbnail(track.artworkUrl || CUSTOM_ICON)
        .addFields(
            { name: 'Artist', value: `\`${track.author || 'Unknown'}\``, inline: true },
            { name: 'Duration', value: `\`${formatTime(track.duration)}\``, inline: true },
            { name: 'Position', value: isPlaying ? '`Now Playing`' : `\`#${player.queue.tracks.length}\``, inline: true }
        )
        .setFooter({
            text: `Requested by ${user.tag}`,
            iconURL: user.displayAvatarURL()
        })
        .setTimestamp();
}

/**
 * Create queue end embed
 */
function createQueueEndEmbed() {
    return new EmbedBuilder()
        .setAuthor({
            name: 'Queue Finished',
            iconURL: 'https://media.tenor.com/10BNU95o1a4AAAAM/music-playing.gif'
        })
        .setDescription('All tracks have been played!')
        .addFields(
            { name: 'Ready for more?', value: 'Use `/play` to start a new session!' }
        )
        .setFooter({ text: 'Thanks for listening!' })
        .setTimestamp();
}

/**
 * Create queue display embed
 */
function createQueueEmbed(player) {
    const queueList = player.queue.tracks.slice(0, 10).map((track, index) =>
        `**${index + 1}.** ${track.title || 'Unknown'} - \`${track.author || 'Unknown'}\``
    ).join('\n');

    return new EmbedBuilder()
        .setColor(EMBED_COLORS.INFO)
        .setAuthor({ name: 'Music Queue', iconURL: CUSTOM_ICON })
        .setDescription(queueList || 'Queue is empty!')
        .setFooter({
            text: player.queue.tracks.length > 10
                ? `Showing first 10 of ${player.queue.tracks.length} tracks`
                : `${player.queue.tracks.length} tracks total`,
            iconURL: CUSTOM_ICON
        });
}

/**
 * Create error embed for track exceptions
 */
function createErrorEmbed(track, errorMessage) {
    return new EmbedBuilder()
        .setColor(EMBED_COLORS.ERROR)
        .setAuthor({
            name: 'Playback Error',
            iconURL: CUSTOM_ICON
        })
        .setDescription(`**${track.title || 'Unknown'}** failed to play`)
        .addFields(
            { name: 'Error', value: `\`${errorMessage || 'Unknown error'}\`` }
        )
        .setFooter({ text: 'Skipping to next track...', iconURL: CUSTOM_ICON })
        .setTimestamp();
}

/**
 * Create loading embed
 */
function createLoadingEmbed(title, description) {
    return new EmbedBuilder()
        .setAuthor({ name: '⏳ Loading...', iconURL: 'https://media.tenor.com/10BNU95o1a4AAAAM/music-playing.gif' })
        .setDescription(`${title}\n${description}`)
        .setFooter({ text: 'This might take a few seconds...' })
        .setTimestamp();
}

/**
 * Create skip embed
 */
function createSkipEmbed(currentTrack, nextTrack) {
    return new EmbedBuilder()
        .setAuthor({ name: 'Track Skipped', iconURL: CUSTOM_ICON })
        .setDescription(`<a:VinylRecord_1338415159672307806:1342442912746704998>  Skipped: **${currentTrack}**\nNow playing: **${nextTrack}**`)
        .setTimestamp();
}

/**
 * Create stop embed
 */
function createStopEmbed(queueSize) {
    return new EmbedBuilder()
        .setAuthor({ name: 'Music Stopped', iconURL: CUSTOM_ICON })
        .setDescription(`<a:VinylRecord_1338415159672307806:1342442912746704998>  Playback stopped and queue cleared (${queueSize} tracks removed)`)
        .setTimestamp();
}

/**
 * Create pause/resume embed
 */
function createPauseEmbed(wasPaused) {
    return new EmbedBuilder()
        .setAuthor({
            name: wasPaused ? '▶️ Music Resumed' : '⏸️ Music Paused',
            iconURL: CUSTOM_ICON
        })
        .setDescription(`Playback ${wasPaused ? 'resumed' : 'paused'}`)
        .setTimestamp();
}

/**
 * Create loop mode change embed
 */
function createLoopEmbed(loopMode) {
    const loopEmoji = loopMode === 'off' ? '🔁' : loopMode === 'track' ? '🔂' : '🔁';
    return new EmbedBuilder()
        .setAuthor({ name: `${loopEmoji} Loop Mode Changed`, iconURL: CUSTOM_ICON })
        .setDescription(`Loop mode: **${loopMode.toUpperCase()}**`)
        .setTimestamp();
}

/**
 * Create queue cleared embed
 */
function createClearEmbed(queueSize) {
    return new EmbedBuilder()
        .setAuthor({ name: 'Queue Cleared', iconURL: CUSTOM_ICON })
        .setDescription(`Removed ${queueSize} tracks from queue`)
        .setTimestamp();
}

/**
 * Create disconnect embed
 */
function createDisconnectEmbed() {
    return new EmbedBuilder()
        .setAuthor({ name: '👋 Disconnected', iconURL: CUSTOM_ICON })
        .setDescription('Disconnected from voice channel and cleared all data')
        .setTimestamp();
}

/**
 * Create enhanced queue display embed (replaces inline queue creation)
 */
function createEnhancedQueueEmbed(player) {
    let description = '';

    // lavalink-client uses player.queue.current for the currently playing track
    if (player.queue.current) {
        const track = player.queue.current;
        const title = track.title || track.info?.title || 'Unknown';
        const author = track.author || track.info?.author || 'Unknown';
        const duration = track.duration || track.info?.length || 0;
        const uri = track.uri || track.info?.uri || '#';

        description += `**Now Playing:**\n[${truncate(title, 50)}](${uri})\n`;
        description += `└ By: ${truncate(author, 30)} • ${formatTime(duration)}\n\n`;
    }

    // lavalink-client uses player.queue.tracks for the queue array
    if (player.queue.tracks.length > 0) {
        description += '**<a:gwys_1327982904604889190:1342442980878979113> Up Next:**\n';
        const queueList = player.queue.tracks.slice(0, 10).map((track, index) => {
            const title = track.title || track.info?.title || 'Unknown';
            const author = track.author || track.info?.author || 'Unknown';
            const duration = track.duration || track.info?.length || 0;
            const uri = track.uri || track.info?.uri || '#';

            return `**${index + 1}.** [${truncate(title, 40)}](${uri})\n` +
                `└ By: ${truncate(author, 30)} • ${formatTime(duration)}`;
        }).join('\n\n');
        description += queueList;

        if (player.queue.tracks.length > 10) {
            description += `\n\n*...and ${player.queue.tracks.length - 10} more tracks*`;
        }
    } else {
        description += '*Queue is empty*';
    }

    return new EmbedBuilder()
        .setColor(EMBED_COLORS.INFO)
        .setAuthor({ name: 'Music Queue', iconURL: CUSTOM_ICON })
        .setDescription(description)
        .setFooter({
            text: `${player.queue.tracks.length} tracks in queue • Loop: ${player.loop || 'off'}`,
            iconURL: CUSTOM_ICON
        })
        .setTimestamp();
}

/**
 * Create play response embed (for URL-based plays)
 */
function createPlayResponseEmbed(tracks, startedImmediately, player) {
    const firstTrack = tracks[0];
    const trackInfo = firstTrack.info || firstTrack;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: startedImmediately ? '🎵 Now Playing' : '➕ Added to Queue',
            iconURL: CUSTOM_ICON
        })
        .setTitle(trackInfo.title || 'Unknown Title')
        .setURL(trackInfo.uri || null)
        .setThumbnail(trackInfo.artworkUrl || CUSTOM_ICON)
        .addFields(
            { name: 'Artist', value: `\`${trackInfo.author || 'Unknown'}\``, inline: true },
            { name: '⏱️ Duration', value: `\`${formatTime(trackInfo.length || trackInfo.duration || firstTrack.duration)}\``, inline: true },
            { name: 'Requested by', value: `<@${firstTrack.requester?.id}>`, inline: true }
        );

    if (tracks.length > 1) {
        embed.addFields({ name: '<a:milkbear_1338415503877865506:1342442875971174470> Playlist', value: `\`${tracks.length} tracks\``, inline: true });
    }

    if (player?.queue?.tracks?.length > 0 && !startedImmediately) {
        embed.addFields({ name: '<a:gwys_1327982904604889190:1342442980878979113> Position', value: `\`#${player.queue.tracks.length}\``, inline: true });
    }

    embed.setFooter({
        text: startedImmediately ? 'Use /music queue to see the queue' : `Added to position ${player?.queue?.tracks?.length || 0}`,
        iconURL: CUSTOM_ICON
    }).setTimestamp();

    return embed;
}

/**
 * Create generic error embed
 */
function createGenericErrorEmbed(title, description) {
    return new EmbedBuilder()
        .setAuthor({ name: `❌ ${title}`, iconURL: CUSTOM_ICON })
        .setColor(EMBED_COLORS.ERROR)
        .setDescription(description)
        .setTimestamp();
}

module.exports = {
    EMBED_COLORS,
    CUSTOM_ICON,
    SOURCE_INFO,
    formatTime,
    truncate,
    createControlButtons,
    createNowPlayingEmbed,
    createSearchEmbed,
    createTrackAddedEmbed,
    createQueueEndEmbed,
    createQueueEmbed,
    createEnhancedQueueEmbed,
    createErrorEmbed,
    createGenericErrorEmbed,
    createLoadingEmbed,
    createSkipEmbed,
    createStopEmbed,
    createPauseEmbed,
    createLoopEmbed,
    createClearEmbed,
    createDisconnectEmbed,
    createPlayResponseEmbed
};

