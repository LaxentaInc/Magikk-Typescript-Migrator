const { cleanupCollector, activeCollectors } = require('./controls');
const {
    createNowPlayingEmbed,
    createControlButtons,
    createQueueEndEmbed,
    createErrorEmbed,
    EMBED_COLORS
} = require('./embeds');
const { ComponentType, EmbedBuilder } = require('discord.js');

/**
 * Helper to disable old control message buttons
 */
async function disableOldControlMessage(player) {
    if (player.currentControlMessage) {
        try {
            const disabledButtons = createControlButtons(player, true);
            await player.currentControlMessage.edit({
                components: [disabledButtons]
            }).catch(() => { });
            console.log('   🔒 Disabled old control message buttons');
        } catch (error) {
            // Ignore errors - message might be deleted
        }
        player.currentControlMessage = null;
    }
}

/**
 * Send Now Playing embed with controls
 */
async function sendNowPlayingEmbed(interaction, player, track, client) {
    console.log(`\n📤 Sending Now Playing embed for: ${track.title}`);
    try {
        // Cleanup old collector and disable old message buttons
        await disableOldControlMessage(player);
        cleanupCollector(player.guildId);

        const npEmbed = createNowPlayingEmbed(track, player, client);
        const controlButtons = createControlButtons(player);

        const message = await interaction.channel.send({
            embeds: [npEmbed],
            components: [controlButtons]
        });

        player.currentControlMessage = message;

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300000
        });

        activeCollectors.set(player.guildId, collector);

        collector.on('collect', async (buttonInteraction) => {
            try {
                const { handleButtonInteraction } = require('./controls');
                await handleButtonInteraction(buttonInteraction, player, message, client);
            } catch (error) {
                console.error('❌ Button interaction error:', error.message);
                try {
                    await buttonInteraction.reply({
                        content: 'An error occurred while processing your request!',
                        flags: 64 // ephemeral
                    });
                } catch (replyError) {
                    console.error('❌ Failed to reply to button interaction:', replyError.message);
                }
            }
        });

        collector.on('end', async () => {
            try {
                activeCollectors.delete(player.guildId);
                const disabledControlButtons = createControlButtons(player, true);
                await message.edit({
                    components: [disabledControlButtons]
                }).catch(() => { });
            } catch (error) {
                console.error('❌ Failed to disable buttons on collector end:', error.message);
            }
        });

    } catch (error) {
        console.error('❌ Failed to send now playing embed:', error.message);
    }
}

/**
 * Send auto Now Playing embed when track changes
 */
async function sendAutoNowPlayingEmbed(client, player, track) {
    console.log(`\n📤 Sending Auto Now Playing embed for: ${track.title || track.info?.title}`);
    try {
        const channel = client.channels.cache.get(player.textChannelId);
        if (!channel) return;

        const permissions = channel.permissionsFor(client.user);
        if (!permissions?.has('SendMessages')) return;

        // Disable old message buttons and cleanup collector BEFORE sending new one
        await disableOldControlMessage(player);
        cleanupCollector(player.guildId);

        // Normalize track if needed (it might come directly from lavalink)
        const normalizedTrack = {
            title: track.title || track.info?.title || 'Unknown',
            author: track.author || track.info?.author || 'Unknown',
            duration: track.duration || track.info?.length || 0,
            uri: track.uri || track.info?.uri,
            artworkUrl: track.artworkUrl || track.info?.artworkUrl,
            sourceName: track.sourceName || track.info?.sourceName || 'spotify',
            requester: track.requester
        };

        const npEmbed = createNowPlayingEmbed(normalizedTrack, player, client);
        const controlButtons = createControlButtons(player);

        const message = await channel.send({
            embeds: [npEmbed],
            components: [controlButtons]
        });

        player.currentControlMessage = message;

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300000
        });

        activeCollectors.set(player.guildId, collector);

        collector.on('collect', async (buttonInteraction) => {
            try {
                const { handleButtonInteraction } = require('./controls');
                await handleButtonInteraction(buttonInteraction, player, message, client);
            } catch (error) {
                console.error('❌ Button interaction error:', error.message);
            }
        });

        collector.on('end', async () => {
            try {
                activeCollectors.delete(player.guildId);
                const disabledControlButtons = createControlButtons(player, true);
                await message.edit({
                    components: [disabledControlButtons]
                }).catch(() => { });
            } catch (error) { }
        });

    } catch (error) {
        console.error('❌ Failed to send auto now playing embed:', error.message);
    }
}

/**
 * Setup player event handlers
 */
function setupPlayerEvents(client) {
    client.lavalink
        .on('playerCreate', (player) => {
            console.log(`\n🎵 PLAYER CREATED for guild: ${player.guildId}`);
        })
        .on('playerDestroy', (player, reason) => {
            console.log(`\n🔌 PLAYER DESTROYED for guild: ${player.guildId} | Reason: ${reason}`);
            cleanupCollector(player.guildId);
        })
        .on('trackStart', async (player, track) => {
            const title = track.title || track.info?.title || 'Unknown';
            console.log(`\n🎵 TRACK START: ${title}`);
            console.log(`   Guild: ${player.guildId}`);
            console.log(`   Queue remaining: ${player.queue.tracks.length}`);

            try {
                if (!track || !player.textChannelId) return;

                // ALWAYS send new Now Playing embed when a track starts
                // This ensures skip works correctly
                await sendAutoNowPlayingEmbed(client, player, track);
                player.skipInProgress = false;

            } catch (error) {
                console.error('❌ TrackStart handler error:', error.message);
            }
        })
        .on('trackEnd', async (player, track, payload) => {
            const title = track.title || track.info?.title || 'Unknown';
            console.log(`\n🏁 TRACK END: ${title}`);
            console.log(`   Reason: ${payload.reason}`);
            console.log(`   Guild: ${player.guildId}`);
            console.log(`   Queue length: ${player.queue.tracks.length}`);
        })
        .on('queueEnd', async (player, track, payload) => {
            console.log(`\n📭 QUEUE END for guild: ${player.guildId}`);

            try {
                const channel = client.channels.cache.get(player.textChannelId);
                if (channel?.permissionsFor(client.user)?.has('SendMessages')) {
                    const queueEndEmbed = createQueueEndEmbed();
                    await channel.send({ embeds: [queueEndEmbed] });
                    console.log(`   ✅ Sent queue finished message`);
                }

                cleanupCollector(player.guildId);

                setTimeout(() => {
                    try {
                        if (player && player.queue.tracks.length === 0) {
                            console.log(`   🔌 Auto-disconnecting after queue end`);
                            player.destroy();
                        }
                    } catch (error) {
                        console.error('❌ Failed to auto-disconnect:', error.message);
                    }
                }, 10000);

            } catch (error) {
                console.error('❌ QueueEnd handler error:', error.message);
            }
        })
        .on('playerException', async (player, track, payload) => {
            const title = track.title || track.info?.title || 'Unknown';
            console.error(`\n⚠️ TRACK EXCEPTION: ${title}`);
            console.error(`   Error: ${payload.exception?.message}`);
            console.error(`   Guild: ${player.guildId}`);

            const channel = client.channels.cache.get(player.textChannelId);

            try {
                if (channel?.permissionsFor(client.user)?.has('SendMessages')) {
                    const errorEmbed = createErrorEmbed(track, payload.exception?.message);
                    await channel.send({ embeds: [errorEmbed] });
                }
            } catch (embedError) {
                console.error('❌ Failed to send exception embed:', embedError.message);
            }
        })
        .on('playerStuck', async (player, track, payload) => {
            const title = track.title || track.info?.title || 'Unknown';
            console.error(`\n⚠️ TRACK STUCK: ${title}`);
            console.error(`   Guild: ${player.guildId}`);
            console.error(`   Threshold: ${payload.thresholdMs}ms`);

            const channel = client.channels.cache.get(player.textChannelId);

            try {
                if (channel?.permissionsFor(client.user)?.has('SendMessages')) {
                    const stuckEmbed = new EmbedBuilder()
                        .setColor(EMBED_COLORS.WARNING)
                        .setDescription(`⚠️ Track stuck: **${title}**\nSkipping...`)
                        .setTimestamp();
                    await channel.send({ embeds: [stuckEmbed] });
                }

                // Try to skip stuck track
                if (player.queue.tracks.length > 0) {
                    await player.skip();
                } else {
                    await player.stopPlaying();
                }
            } catch (error) {
                console.error('❌ Failed to handle stuck track:', error.message);
            }
        });

    console.log('✅ Player events registered');
}

module.exports = {
    sendNowPlayingEmbed,
    sendAutoNowPlayingEmbed,
    setupPlayerEvents
};
