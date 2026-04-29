/**
 * Player Module - Main Entry Point
 * Modular lavalink player system for Laxenta
 */

const { initializeManager, createPlayer, getPlayer, getNode } = require('./manager');
const { searchTrack, searchTrackAlternative, smartSearch, normalizeTrack } = require('./search');
const {
    playTrack,
    skipTrack,
    stopMusic,
    toggleLoop,
    showQueue,
    clearQueue,
    displaySearchResults,
    handleButtonInteraction,
    cleanupCollector,
    cleanupSearchCollector
} = require('./controls');
const { sendNowPlayingEmbed, sendAutoNowPlayingEmbed, setupPlayerEvents } = require('./events');
const {
    EMBED_COLORS,
    CUSTOM_ICON,
    SOURCE_INFO,
    formatTime,
    createControlButtons,
    createNowPlayingEmbed,
    createSearchEmbed,
    createTrackAddedEmbed,
    createQueueEndEmbed,
    createQueueEmbed,
    createErrorEmbed
} = require('./embeds');

/**
 * Initialize the player system and attach methods to client
 */
module.exports = (client) => {
    // Initialize LavalinkManager
    initializeManager(client);

    // Setup player events
    setupPlayerEvents(client);

    // Attach search methods
    client.searchTrack = (query, requester, source) => searchTrack(client, query, requester, source);
    client.searchTrackAlternative = (query, requester, source) => searchTrackAlternative(client, query, requester, source);
    client.smartSearch = (query, requester) => smartSearch(client, query, requester);

    // Attach display methods
    client.displaySearchResults = (interaction, tracks, query, requester) =>
        displaySearchResults(client, interaction, tracks, query, requester,
            (i, p, t) => sendNowPlayingEmbed(i, p, t, client));

    // Attach player control methods
    client.playTrack = playTrack;
    client.createPlayer = (guildId, voiceChannelId, textChannelId) =>
        createPlayer(client, guildId, voiceChannelId, textChannelId);
    client.getPlayer = (guildId) => getPlayer(client, guildId);
    client.clearQueue = (guildId) => {
        const player = getPlayer(client, guildId);
        return clearQueue(player);
    };
    client.destroyPlayer = (guildId) => {
        const player = getPlayer(client, guildId);
        if (player) {
            player.destroy();
            console.log(`🗑️ Destroyed player for guild ${guildId}`);
        }
    };

    // Attach embed methods
    client.sendNowPlayingEmbed = (interaction, player, track) =>
        sendNowPlayingEmbed(interaction, player, track, client);
    client.sendAutoNowPlayingEmbed = (contextOrClient, player, track) =>
        sendAutoNowPlayingEmbed(client, player, track);

    console.log('✅ Player module initialized with lavalink-client');
};

// Export all for direct imports if needed
module.exports.manager = require('./manager');
module.exports.search = require('./search');
module.exports.controls = require('./controls');
module.exports.events = require('./events');
module.exports.embeds = require('./embeds');
