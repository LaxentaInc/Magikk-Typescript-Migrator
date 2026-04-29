const { LavalinkManager } = require('lavalink-client');

// Lavalink node configuration
const NODES = [
    {
        id: 'lavalink-primary',
        host: 'lava-v4.ajieblogs.eu.org',
        port: 443,
        authorization: 'https://dsc.gg/ajidevserver',
        secure: true,
        retryAmount: 3,
        retryDelay: 3000
    },
    {
        id: 'lavalink-backup-2',
        host: 'lavalinkv4.serenetia.com',
        port: 443,
        authorization: 'https://dsc.gg/ajidevserver',
        secure: true,
        retryAmount: 3,
        retryDelay: 3000
    }
];

/**
 * Initialize LavalinkManager and attach to client
 */
function initializeManager(client) {
    client.lavalink = new LavalinkManager({
        nodes: NODES,
        sendToShard: (guildId, payload) => {
            const guild = client.guilds.cache.get(guildId);
            if (guild) guild.shard.send(payload);
        },
        client: {
            id: client.user?.id || 'temp',
            username: client.user?.username || 'Bot'
        },
        autoSkip: true,
        playerOptions: {
            clientBasedPositionUpdateInterval: 100,
            defaultSearchPlatform: 'spotify',
            volumeDecrementer: 0.75,
            onDisconnect: {
                autoReconnect: true,
                destroyPlayer: false
            },
            onEmptyQueue: {
                destroyAfterMs: 30_000
            },
            useUnresolvedData: true
        },
        queueOptions: {
            maxPreviousTracks: 25
        }
    });

    // Node event handlers
    client.lavalink.nodeManager
        .on('connect', (node) => {
            console.log(`✅ Lavalink Node "${node.id}" connected!`);
        })
        .on('disconnect', (node, reason) => {
            console.log(`⚠️ Lavalink Node "${node.id}" disconnected: ${reason.reason || reason}`);
            console.log(`   Will attempt automatic reconnection...`);

            // Track reconnection attempts
            if (!client.lavalinkReconnectAttempts) client.lavalinkReconnectAttempts = {};
            client.lavalinkReconnectAttempts[node.id] = (client.lavalinkReconnectAttempts[node.id] || 0) + 1;

            // Manual reconnect after multiple failures
            if (client.lavalinkReconnectAttempts[node.id] > 5) {
                console.log(`   ⚠️ Node "${node.id}" failed ${client.lavalinkReconnectAttempts[node.id]}x, manual reconnect...`);
                setTimeout(() => { try { node.connect(); } catch (e) { } }, 5000);
            }
        })
        .on('error', (node, error) => {
            console.error(`❌ Lavalink Node "${node.id}" error:`, error.message);
            console.log(`   Node will auto-reconnect if disconnected`);
        })
        .on('reconnecting', (node) => {
            console.log(`Lavalink Node "${node.id}" reconnecting...`);
        });

    // initialize immediately since this is called from the ready handler
    // (clientReady has already fired by this point)
    client.lavalink.init({
        id: client.user.id,
        username: client.user.username
    });
    console.log('✅ LavalinkManager initialized');

    // start health check - every 5 minutes
    const healthCheckInterval = setInterval(() => {
        const nodes = [...(client.lavalink.nodeManager.nodes?.values() || [])];
        let connected = 0, disconnected = 0;

        nodes.forEach(node => {
            if (node.connected) {
                connected++;
            } else {
                disconnected++;
                console.log(`   ⚠️ Health check: Node "${node.id}" disconnected, reconnecting...`);
                try { node.connect(); } catch (e) { }
            }
        });

        if (connected === 0 && disconnected > 0) {
            console.error(`⚠️ CRITICAL: All nodes disconnected! Emergency reconnect...`);
            nodes.forEach(n => setTimeout(() => { try { n.connect(); } catch (e) { } }, 1000));
        }
    }, 5 * 60 * 1000); // 5min

    console.log('Lavalink health check started (5min interval)');

    // Cleanup on shutdown
    client.on('shardDisconnect', () => {
        if (healthCheckInterval) {
            clearInterval(healthCheckInterval);
            console.log('Lavalink health check stopped');
        }
    });

    // Handle voice updates
    client.on('raw', (d) => {
        if (['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE'].includes(d.t)) {
            client.lavalink.sendRawData(d);
        }
    });

    return client.lavalink;
}

/**
 * Get a connected Lavalink node
 */
function getNode(client) {
    const nodeManager = client.lavalink.nodeManager;

    // Try leastUsedNodes
    if (nodeManager.leastUsedNodes?.length > 0) {
        return nodeManager.leastUsedNodes[0];
    }

    // Try connected nodes from map
    if (nodeManager.nodes) {
        const connected = [...nodeManager.nodes.values()].filter(n => n.connected);
        if (connected.length > 0) return connected[0];
    }

    // Try usableNodes
    if (nodeManager.usableNodes?.length > 0) {
        return nodeManager.usableNodes[0];
    }

    return null;
}

/**
 * Create a player for a guild
 */
async function createPlayer(client, guildId, voiceChannelId, textChannelId) {
    console.log(`\n🎵 CREATING PLAYER for guild ${guildId}`);
    try {
        let player = client.lavalink.getPlayer(guildId);
        if (player) {
            console.log(`✅ Player already exists for guild ${guildId}`);
            return player;
        }

        player = client.lavalink.createPlayer({
            guildId: guildId,
            voiceChannelId: voiceChannelId,
            textChannelId: textChannelId,
            selfDeaf: true,
            selfMute: false,
            volume: 100
        });

        await player.connect();

        // Custom properties
        player.loop = 'off';
        player.skipInProgress = false;

        console.log(`✅ Player created and connected for guild ${guildId}`);
        return player;

    } catch (error) {
        console.error(`❌ Failed to create player:`, error.message);
        throw error;
    }
}

/**
 * Get existing player for a guild
 */
function getPlayer(client, guildId) {
    return client.lavalink.getPlayer(guildId);
}

module.exports = {
    initializeManager,
    getNode,
    createPlayer,
    getPlayer,
    NODES
};
