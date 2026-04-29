const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

/**
 * Load events from the events directory on bot start, handler for index.js ready event
 * @param {import('discord.js').Client} client 
 */
async function loadEvents(client) {
    try {
        logger.info("📂 Loading events...");

        // this file is in src/handlers/, so we go up one level to src, then to events
        // OR better yet, pass the root dir or use process.cwd()
        // Using strict relative path based on project structure:
        const eventsPath = path.join(__dirname, '..', 'events');

        if (!fs.existsSync(eventsPath)) {
            logger.warn(`⚠️ Events directory not found: ${eventsPath}`);
            return;
        }

        const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

        if (eventFiles.length === 0) {
            logger.warn("⚠️ No event files found in events directory");
            return;
        }

        let loadedCount = 0;
        let errorCount = 0;

        for (const file of eventFiles) {
            try {
                const eventPath = path.join(eventsPath, file);

                delete require.cache[require.resolve(eventPath)];

                const event = require(eventPath);

                if (!event.name || typeof event.execute !== 'function') {
                    logger.warn(`⚠️ Skipping invalid event file: ${file} (missing name or execute function)`);
                    continue;
                }

                const handler = (...args) => {
                    try {
                        // Pass specific arguments based on event name if needed, but usually just passing all args + client matches the existing pattern
                        // Existing pattern in index.js checks event names.
                        // Let's replicate the exact logic for safety.

                        switch (event.name) {
                            case 'guildMemberAdd':
                            case 'guildMemberRemove':
                            case 'guildMemberUpdate':
                                event.execute(...args, client);
                                break;

                            case 'messageCreate':
                            case 'messageUpdate':
                            case 'messageDelete':
                                event.execute(...args, client);
                                break;

                            case 'interactionCreate':
                                event.execute(...args, client);
                                break;

                            case 'ready':
                                event.execute(client);
                                break;

                            case 'guildCreate':
                            case 'guildDelete':
                                event.execute(...args, client);
                                break;

                            default:
                                event.execute(...args, client);
                                break;
                        }

                    } catch (execError) {
                        console.error(`[EVENT ERROR] ${event.name} execution failed:`, execError);
                        logger.error(`Error executing event ${event.name}:`, {
                            message: execError.message,
                            stack: execError.stack,
                            file: file,
                            eventName: event.name
                        });
                    }
                };

                if (event.once) {
                    client.once(event.name, handler);
                    logger.info(`✅ Loaded event (once): ${event.name} (${file})`);
                } else {
                    client.on(event.name, handler);
                    logger.info(`✅ Loaded event: ${event.name} (${file})`);
                }

                loadedCount++;

            } catch (err) {
                errorCount++;
                logger.error(`❌ Failed to load event ${file}:`, {
                    message: err.message,
                    stack: err.stack
                });
                console.error(`💥 [EVENT LOAD ERROR] Failed to load ${file}:`, err);
            }
        }

        logger.info(`📊 Events loading complete: ${loadedCount} loaded, ${errorCount} failed`);

    } catch (error) {
        logger.error('💥 Critical error loading events:', {
            message: error.message,
            stack: error.stack
        });
        throw error;
    }
}

module.exports = { loadEvents };
