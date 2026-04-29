const { logger } = require('../utils/logger');
// antiraid related module, for index.js, so it gets called on bot ready for syncing, and periodically too
let guildSyncInterval = null;

/**
 * Sync all guilds to the database
 * @param {import('discord.js').Client} client 
 * @param {import('mongodb').MongoClient} mongoClient 
 */
async function syncAllGuilds(client, mongoClient) {
    try {
        logger.info('Starting full guild sync...');
        const db = mongoClient.db('antiraid');
        const guildsCollection = db.collection('bot_guilds');

        const guildData = [];

        for (const [guildId, guild] of client.guilds.cache) {
            try {
                // Check if bot has required permissions
                const botMember = guild.members.cache.get(client.user.id) || await guild.members.fetch(client.user.id);
                const hasPermissions = botMember && (
                    botMember.permissions.has('Administrator') ||
                    botMember.permissions.has('ManageGuild')
                );

                const guildDoc = {
                    guildId: guild.id,
                    name: guild.name,
                    ownerId: guild.ownerId,
                    icon: guild.iconURL({ format: 'png', size: 64 }),
                    memberCount: guild.memberCount || guild.members.cache.size,
                    botHasPermissions: hasPermissions,
                    botJoinedAt: guild.joinedAt,
                    lastUpdated: new Date(),
                    features: guild.features || []
                };

                guildData.push(guildDoc);

            } catch (err) {
                logger.warn(`⚠️ Error processing guild ${guild.name}:`, err.message);
            }
        }

        // Bulk upsert all guilds
        if (guildData.length > 0) {
            const bulkOps = guildData.map(guild => ({
                updateOne: {
                    filter: { guildId: guild.guildId },
                    update: { $set: guild },
                    upsert: true
                }
            }));

            await guildsCollection.bulkWrite(bulkOps);
        }

        // Remove guilds the bot is no longer in
        const currentGuildIds = Array.from(client.guilds.cache.keys());
        await guildsCollection.deleteMany({
            guildId: { $nin: currentGuildIds }
        });

        logger.info(`✅ Guild sync complete: ${guildData.length} guilds updated`);

    } catch (error) {
        logger.error('❌ Error syncing guilds:', error.message);
    }
}

/**
 * Sync a single guild to the database
 * @param {import('discord.js').Guild} guild 
 * @param {import('mongodb').MongoClient} mongoClient 
 */
async function syncSingleGuild(guild, mongoClient) {
    try {
        const db = mongoClient.db('antiraid');
        const guildsCollection = db.collection('bot_guilds');

        // Check if bot has required permissions
        const botMember = guild.members.cache.get(guild.client.user.id) || await guild.members.fetch(guild.client.user.id);
        const hasPermissions = botMember && (
            botMember.permissions.has('Administrator') ||
            botMember.permissions.has('ManageGuild')
        );

        const guildDoc = {
            guildId: guild.id,
            name: guild.name,
            ownerId: guild.ownerId,
            icon: guild.iconURL({ format: 'png', size: 64 }),
            memberCount: guild.memberCount || guild.members.cache.size,
            botHasPermissions: hasPermissions,
            botJoinedAt: guild.joinedAt,
            lastUpdated: new Date(),
            features: guild.features || []
        };

        await guildsCollection.updateOne(
            { guildId: guild.id },
            { $set: guildDoc },
            { upsert: true }
        );

        logger.info(`✅ Synced guild: ${guild.name}`);

    } catch (error) {
        logger.error(`❌ Error syncing guild ${guild.name}:`, error.message);
    }
}

/**
 * Remove a guild from the database
 * @param {string} guildId 
 * @param {import('mongodb').MongoClient} mongoClient 
 */
async function removeGuildFromDB(guildId, mongoClient) {
    try {
        const db = mongoClient.db('antiraid');
        const guildsCollection = db.collection('bot_guilds');

        await guildsCollection.deleteOne({ guildId });
        logger.info(`✅ Removed guild ${guildId} from database`);

    } catch (error) {
        logger.error(`❌ Error removing guild ${guildId}:`, error.message);
    }
}

/**
 * Start periodic guild synchronization
 * @param {import('discord.js').Client} client 
 * @param {import('mongodb').MongoClient} mongoClient 
 */
function startGuildSync(client, mongoClient) {
    // Sync every 2 minutes
    if (guildSyncInterval) clearInterval(guildSyncInterval);

    guildSyncInterval = setInterval(async () => {
        logger.info('⏰ Running scheduled guild sync...');
        await syncAllGuilds(client, mongoClient);
    }, 2 * 60 * 1000);

    logger.info('⏰ Guild sync scheduler started (2min intervals)');

    return guildSyncInterval;
}

/**
 * Stop guild synchronization
 */
function stopGuildSync() {
    if (guildSyncInterval) {
        clearInterval(guildSyncInterval);
        guildSyncInterval = null;
    }
}

module.exports = {
    syncAllGuilds,
    syncSingleGuild,
    removeGuildFromDB,
    startGuildSync,
    stopGuildSync
};
