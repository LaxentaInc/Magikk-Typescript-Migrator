const { getNode } = require('./manager');
const { SOURCE_INFO } = require('./embeds');

/**
 * Normalize track structure from lavalink-client to flat format
 * lavalink-client uses track.info.* but we want track.title directly
 */
function normalizeTrack(track, requester) {
    return {
        // Keep original encoded data for playback (CRITICAL)
        encoded: track.encoded,
        // Flatten info properties to root level
        title: track.info?.title || track.title || 'Unknown',
        author: track.info?.author || track.author || 'Unknown',
        duration: track.info?.length || track.info?.duration || track.duration || 0,
        uri: track.info?.uri || track.uri,
        artworkUrl: track.info?.artworkUrl || track.thumbnail || null,
        sourceName: track.info?.sourceName || track.sourceName || 'unknown',
        isrc: track.info?.isrc || null,
        isSeekable: track.info?.isSeekable ?? true,
        isStream: track.info?.isStream ?? false,
        // Preserve original info object for player
        info: track.info,
        // Add requester and source info
        requester: requester,
        sourceInfo: SOURCE_INFO[track.info?.sourceName || track.sourceName] || SOURCE_INFO.http
    };
}

/**
 * Search for tracks using primary method
 */
async function searchTrack(client, query, requester, source = 'spotify') {
    console.log(`\n🔍 Searching for: "${query}" (source: ${source})`);

    try {
        let searchQuery;

        // Check if it's a direct URL
        if (query.includes('spotify.com') || query.includes('youtube.com') ||
            query.includes('youtu.be') || query.includes('soundcloud.com')) {
            searchQuery = query;
        } else {
            const prefixes = {
                spotify: 'spsearch:',
                youtube: 'ytsearch:',
                soundcloud: 'scsearch:',
                bandcamp: 'bcsearch:'
            };
            searchQuery = `${prefixes[source] || 'ytsearch:'}${query}`;
        }

        console.log(`   Actual query: ${searchQuery}`);

        // Get a connected node
        const node = getNode(client);
        if (!node) {
            console.log('   ❌ No available Lavalink nodes');
            throw new Error('No available Lavalink nodes');
        }

        console.log(`   ✅ Using node: ${node.id}`);
        const result = await node.search({ query: searchQuery }, requester);

        if (!result?.tracks?.length) {
            throw new Error('No tracks found');
        }

        console.log(`   ✅ Found ${result.tracks.length} track(s)`);

        // Normalize all tracks
        const normalizedTracks = result.tracks.map(track => normalizeTrack(track, requester));

        return { data: normalizedTracks, loadType: result.loadType || 'search' };

    } catch (error) {
        console.error('❌ Search error:', error.message);
        throw error;
    }
}

/**
 * Search with alternative source as fallback
 */
async function searchTrackAlternative(client, query, requester, source = 'spotify') {
    console.log(`\n🔍 [ALT] Searching for: "${query}" (source: ${source})`);

    try {
        let searchQuery;

        if (query.includes('spotify.com') || query.includes('youtube.com') ||
            query.includes('youtu.be') || query.includes('soundcloud.com')) {
            searchQuery = query;
        } else {
            const prefixes = {
                spotify: 'spsearch:',
                youtube: 'ytsearch:',
                soundcloud: 'scsearch:',
                bandcamp: 'bcsearch:'
            };
            searchQuery = `${prefixes[source] || 'ytsearch:'}${query}`;
        }

        console.log(`   Actual query: ${searchQuery}`);

        const node = getNode(client);
        if (!node) {
            throw new Error('No available Lavalink nodes');
        }

        const result = await node.search({ query: searchQuery }, requester);

        if (!result?.tracks?.length) {
            throw new Error('No tracks found');
        }

        console.log(`   ✅ Found ${result.tracks.length} track(s)`);
        const normalizedTracks = result.tracks.map(track => normalizeTrack(track, requester));

        return { data: normalizedTracks, loadType: result.loadType || 'search' };

    } catch (error) {
        console.error('❌ [ALT] Search error:', error.message);
        throw error;
    }
}

/**
 * Smart multi-source search - tries Spotify then YouTube
 */
async function smartSearch(client, query, requester) {
    console.log(`\n🔍 Smart search for: "${query}"`);

    // Direct URL handling
    if (query.includes('spotify.com') || query.includes('youtube.com') ||
        query.includes('youtu.be') || query.includes('soundcloud.com')) {
        try {
            return await searchTrack(client, query, requester);
        } catch (error) {
            console.log(`   ⚠️ Direct URL failed: ${error.message}`);
            try {
                return await searchTrackAlternative(client, query, requester);
            } catch (altError) {
                throw new Error(`Failed to load URL: ${error.message}`);
            }
        }
    }

    // Try Spotify first
    try {
        console.log('   Trying Spotify first...');
        const spotifyResult = await searchTrack(client, query, requester, 'spotify');
        if (spotifyResult?.data?.length) {
            console.log('   ✅ Found on Spotify!');
            return spotifyResult;
        }
    } catch (error) {
        console.log(`   ⚠️ Spotify failed: ${error.message}`);
    }

    // Fallback to YouTube
    try {
        console.log('   Falling back to YouTube...');
        const youtubeResult = await searchTrack(client, query, requester, 'youtube');
        if (youtubeResult?.data?.length) {
            console.log('   ✅ Found on YouTube!');
            return youtubeResult;
        }
    } catch (error) {
        console.log(`   ⚠️ YouTube failed: ${error.message}`);
    }

    throw new Error('No tracks found on Spotify or YouTube');
}

module.exports = {
    normalizeTrack,
    searchTrack,
    searchTrackAlternative,
    smartSearch
};
