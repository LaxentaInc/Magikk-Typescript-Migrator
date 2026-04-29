/**
 * AntiNuke Database Management
 * uses shared mongodb connection from CloudDB
 */

const { getCollection } = require('../../../utils/CloudDB');

/**
 * initialize mongodb — returns the shared collection handle
 */
async function initMongoDB() {
    try {
        const collection = await getCollection('antinuke_config', 'antiraid');
        console.log(`[AntiNuke] connected to MongoDB (shared pool)`);
        return { collection };
    } catch (error) {
        console.error(`[AntiNuke] MongoDB connection failed:`, error.message);
        return { collection: null };
    }
}

/**
 * sync configurations from MongoDB to cache
 */
async function syncConfigs(collection, configs) {
    if (!collection) return;

    try {
        const dbConfigs = await collection.find({}).toArray();

        for (const dbConfig of dbConfigs) {
            configs.set(dbConfig.guildId, dbConfig.config);
        }

    } catch (error) {
        console.error(`[AntiNuke] config sync failed:`, error.message);
    }
}

/**
 * update config in MongoDB
 */
async function updateConfig(collection, configs, guildId, newConfig) {
    if (!collection) return false;

    try {
        await collection.updateOne(
            { guildId },
            {
                $set: {
                    guildId,
                    config: newConfig,
                    updated: new Date()
                }
            },
            { upsert: true }
        );

        configs.set(guildId, newConfig);
        return true;

    } catch (error) {
        console.error(`[AntiNuke] failed to update config:`, error.message);
        return false;
    }
}

module.exports = {
    initMongoDB,
    syncConfigs,
    updateConfig
};
