// src/utils/status.js
// for status ulitiy of bot simple simple
const { logger } = require("./logger");

// function to format numbers (e.g., 1200 -> 1.2K)
function formatNumber(num) {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
    return num.toString();
}

function updateBotStatus(client, lavalinkManager) {
    let i = 0;
    let baselinePlayers = 0; // random baseline when no players
    
    const updateStatus = async () => {
        try {
            // Validate client and user
            if (!client || !client.user) {
                logger.error("Client or client.user is not available");
                return;
            }

            // real values with better error handling
            const guildCount = client.guilds?.cache?.size || 0;
            const userCount = client.guilds?.cache?.reduce((acc, g) => {
                return acc + (g.memberCount || 0);
            }, 0) || 0;
            const actualPlayers = lavalinkManager?.players?.size || 0;

            // if no players active → set a fake baseline 6–15
            if (actualPlayers === 0 && baselinePlayers === 0) {
                baselinePlayers = Math.floor(Math.random() * (15 - 6 + 1)) + 6;
                logger.debug(`Set baseline players to: ${baselinePlayers}`);
            }

            // displayed players = baseline + actual
            const displayedPlayers = baselinePlayers + actualPlayers;

            // reset baseline when active players exist again
            if (actualPlayers > 0) {
                baselinePlayers = baselinePlayers; // keep old baseline
            }

            // compact values
            const formattedGuilds = formatNumber(guildCount);
            const formattedUsers = formatNumber(userCount);

            const statuses = [
                {
                    name: `Music | ${displayedPlayers} Players Live`,
                    type: 1, // Streaming
                    url: "https://www.twitch.tv/discord"
                },
                {
                    name: `in ${formattedGuilds} Servers | ${formattedUsers} Users`,
                    type: 1,
                    url: "https://www.twitch.tv/discord"
                },
                {
                    name: "You.",
                    type: 3 // Watching
                    // No URL for watching type
                },
                {
                    name: "www.laxenta.tech",
                    type: 1,
                    url: "https://www.twitch.tv/discord"
                },
                {
                    name: "/help | /anti-raid",
                    type: 1,
                    url: "https://www.twitch.tv/discord"
                }
            ];

            const currentStatus = statuses[i % statuses.length];
            
            // Determine presence based on activity type
            let presence;
            if (currentStatus.type === 3) { // Watching
                presence = "idle"; // "idle" works better for watching
            } else {
                presence = "online";
            }

            // Build activity object properly
            const activity = {
                name: currentStatus.name,
                type: currentStatus.type
            };

            // Only add URL for streaming activities
            if (currentStatus.type === 1 && currentStatus.url) {
                activity.url = currentStatus.url;
            }

            // Set presence with detailed logging
            const presenceData = {
                activities: [activity],
                status: presence
            };

            // logger.debug(`Attempting to set presence:`, JSON.stringify(presenceData, null, 2));

            await client.user.setPresence(presenceData);
            
            // logger.info(`✅ Status updated → "${currentStatus.name}" (${getActivityTypeString(currentStatus.type)}) | Presence: ${presence}`);
            // logger.debug(`Stats: ${guildCount} guilds, ${userCount} users, ${actualPlayers} real players, ${displayedPlayers} displayed`);
            
            i++;
        } catch (err) {
            logger.error(`❌ Failed to update bot status:`, {
                error: err.message,
                stack: err.stack,
                clientReady: !!client?.user,
                currentIndex: i
            });
        }
    };

    // Helper function to get activity type string for logging
    function getActivityTypeString(type) {
        const types = {
            0: "Playing",
            1: "Streaming",
            2: "Listening",
            3: "Watching",
            4: "Custom",
            5: "Competing"
        };
        return types[type] || "Unknown";
    }

    // Initial update
    logger.info("🚀 Starting bot status rotation...");
    updateStatus();

    // Set interval for regular updates
    const statusInterval = setInterval(updateStatus, 10_000); // every 10s

    // Return cleanup function
    return () => {
        logger.info("🛑 Stopping bot status rotation...");
        clearInterval(statusInterval);
    };
}

module.exports = { updateBotStatus };