/**
 * MongoDB Database Operations for Bot Protection
 * uses shared mongodb connection from CloudDB
 */

const { getCollection } = require('../../../utils/CloudDB');
const { getDefaultConfig } = require('./config');

/**
 * initialize mongodb — returns the shared collection handle
 */
async function initDB() {
    try {
        const collection = await getCollection('bot_protection_configs', 'antiraid');
        console.log('[bot-protection] connected to MongoDB (shared pool)');
        return { collection };
    } catch (error) {
        console.error('[bot-protection] MongoDB connection failed:', error.message);
        return { collection: null };
    }
}

/**
 * sync all configurations from MongoDB
 */
async function syncConfigs(collection, configs) {
    if (!collection) return;

    try {
        const dbConfigs = await collection.find({}).toArray();

        for (const dbConfig of dbConfigs) {
            const guildId = dbConfig.guildId;
            let finalConfig = dbConfig.config;

            // auto-repair: check for corrupted config (missing 'enabled')
            if (finalConfig && typeof finalConfig.enabled === 'undefined') {
                finalConfig = { ...getDefaultConfig(), ...finalConfig };

                // save repaired config back to db
                await collection.updateOne(
                    { guildId },
                    {
                        $set: {
                            config: finalConfig,
                            lastUpdated: new Date()
                        }
                    }
                );
            }

            const cachedConfig = configs.get(guildId);

            // only update if changed
            if (!cachedConfig || JSON.stringify(cachedConfig) !== JSON.stringify(finalConfig)) {
                configs.set(guildId, finalConfig);
            }
        }
    } catch (error) {
        console.error('[bot-protection] config sync failed:', error.message);
    }
}

/**
 * update config in MongoDB
 */
async function updateConfig(collection, guildId, newConfig, configs) {
    if (!collection) return false;

    try {
        const mongoUpdate = {};
        for (const [key, value] of Object.entries(newConfig)) {
            mongoUpdate[`config.${key}`] = value;
        }
        mongoUpdate.lastUpdated = new Date();

        await collection.updateOne(
            { guildId },
            { $set: mongoUpdate },
            { upsert: true }
        );

        const currentCache = configs.get(guildId) || {};
        configs.set(guildId, { ...currentCache, ...newConfig });

        return true;
    } catch (error) {
        console.error('[bot-protection] failed to update config:', error.message);
        return false;
    }
}

/**
 * create default config for a guild in MongoDB
 */
async function createDefaultConfig(collection, guildId, defaultConfig, configs) {
    if (!collection) return null;

    try {
        await collection.updateOne(
            { guildId },
            {
                $set: {
                    guildId,
                    config: defaultConfig,
                    lastUpdated: new Date(),
                    createdAt: new Date()
                }
            },
            { upsert: true }
        );

        configs.set(guildId, defaultConfig);
        return defaultConfig;
    } catch (error) {
        console.error('[bot-protection] failed to create default config:', error.message);
        return defaultConfig;
    }
}

module.exports = {
    initDB,
    syncConfigs,
    updateConfig,
    createDefaultConfig
};
