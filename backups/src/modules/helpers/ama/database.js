/**
 * AMA Database Management
 * uses shared mongodb connection from CloudDB
 */

const { getCollection } = require('../../../utils/CloudDB');

/**
 * initialize mongodb — returns the shared collection handle
 */
async function initMongoDB() {
    try {
        const collection = await getCollection('mass_action_protection_configs', 'antiraid');
        console.log(`[mass-action-protection] ✅ connected to MongoDB (shared pool)`);
        return { collection };
    } catch (error) {
        console.error(`[mass-action-protection] ❌ MongoDB connection failed:`, error.message);
        return { collection: null };
    }
}

/**
 * sync configurations from MongoDB
 */
async function syncConfigs(collection, configs) {
    if (!collection) return;

    try {
        const dbConfigs = await collection.find({}).toArray();
        const defaults = require('./config').getDefaultConfig();

        for (const dbConfig of dbConfigs) {
            const guildId = dbConfig.guildId;
            const cachedConfig = configs.get(guildId);

            // merge db config with defaults for robustness
            const fullConfig = { ...defaults, ...(dbConfig.config || {}) };

            // only update if changed
            if (!cachedConfig || JSON.stringify(cachedConfig) !== JSON.stringify(fullConfig)) {
                configs.set(guildId, fullConfig);
            }
        }

    } catch (error) {
        console.error(`[mass-action-protection] ❌ config sync failed:`, error.message);
    }
}

/**
 * create default config for a guild in MongoDB
 */
async function createDefaultConfig(collection, configs, guildId, defaultConfig) {
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
        console.error(`[mass-action-protection] ❌ failed to create default config:`, error.message);
        return defaultConfig;
    }
}

/**
 * update config in MongoDB
 */
async function updateConfig(collection, configs, guildId, newConfig) {
    if (!collection) return false;

    try {
        let currentConfig = configs.get(guildId);
        const defaults = require('./config').getDefaultConfig();

        if (!currentConfig) {
            const doc = await collection.findOne({ guildId });
            currentConfig = doc?.config || defaults;
        }

        // merge defaults -> current -> newConfig
        const finalConfig = { ...defaults, ...currentConfig, ...newConfig };

        await collection.updateOne(
            { guildId },
            {
                $set: {
                    config: finalConfig,
                    lastUpdated: new Date()
                }
            },
            { upsert: true }
        );

        configs.set(guildId, finalConfig);
        return true;
    } catch (error) {
        console.error(`[mass-action-protection] ❌ failed to update config:`, error.message);
        return false;
    }
}

module.exports = {
    initMongoDB,
    syncConfigs,
    createDefaultConfig,
    updateConfig
};
