const { getCollection } = require('../../../utils/CloudDB');
const { buildTrustedSets } = require('./config');

/**
 * initialize mongodb — returns the shared collection handle
 * uses db 'antiraid', collection 'spam_protection_config'
 */
async function initDB() {
    try {
        const collection = await getCollection('spam_protection_config', 'antiraid');
        console.log(`[SpamProtection] ✅ connected to MongoDB (shared pool)`);
        return { collection };
    } catch (error) {
        console.error(`[SpamProtection] ❌ MongoDB connection failed:`, error.message);
        return { collection: null };
    }
}

/**
 * sync configurations from MongoDB
 */
async function syncConfigs(collection, configs, configLastRefresh, trustedUsersSets, trustedRolesSets) {
    if (!collection) return;

    try {
        const dbConfigs = await collection.find({}).toArray();
        const defaults = require('./config').getDefaultConfig();

        for (const dbConfig of dbConfigs) {
            const guildId = dbConfig.guildId;
            const cachedConfig = configs.get(guildId);

            // merge with defaults to handle corrupted/partial db entries
            const fullConfig = { ...defaults, ...(dbConfig.config || {}) };

            // only update if changed
            if (!cachedConfig || JSON.stringify(cachedConfig) !== JSON.stringify(fullConfig)) {
                configs.set(guildId, fullConfig);
                buildTrustedSets(guildId, fullConfig, trustedUsersSets, trustedRolesSets);
                configLastRefresh.set(guildId, Date.now());
            }
        }

    } catch (error) {
        console.error(`[SpamProtection] ❌ config sync failed:`, error.message);
    }
}

/**
 * refresh config for a specific guild (on demand)
 */
async function refreshConfig(collection, guildId, configs, configLastRefresh, trustedUsersSets, trustedRolesSets) {
    if (!collection) return;
    try {
        const doc = await collection.findOne({ guildId });
        const defaults = require('./config').getDefaultConfig();
        const fullConfig = { ...defaults, ...(doc?.config || {}) };

        configs.set(guildId, fullConfig);
        buildTrustedSets(guildId, fullConfig, trustedUsersSets, trustedRolesSets);
        configLastRefresh.set(guildId, Date.now());
    } catch (err) {
        console.error(`[SpamProtection] config refresh failed for ${guildId}:`, err.message);
    }
}

/**
 * update config in MongoDB
 */
async function updateConfig(collection, guildId, newConfig, configs, configLastRefresh, trustedUsersSets, trustedRolesSets) {
    if (!collection) return false;

    try {
        let currentConfig = configs.get(guildId);
        const defaults = require('./config').getDefaultConfig();

        if (!currentConfig) {
            const doc = await collection.findOne({ guildId });
            currentConfig = doc?.config || defaults;
        }

        // merge defaults -> current -> updates
        const finalConfig = { ...defaults, ...currentConfig, ...newConfig };

        await collection.updateOne(
            { guildId },
            {
                $set: {
                    guildId,
                    config: finalConfig,
                    lastUpdated: new Date()
                }
            },
            { upsert: true }
        );

        configs.set(guildId, finalConfig);
        buildTrustedSets(guildId, finalConfig, trustedUsersSets, trustedRolesSets);
        configLastRefresh.set(guildId, Date.now());

        return true;
    } catch (error) {
        console.error(`[SpamProtection] ❌ failed to update config:`, error.message);
        return false;
    }
}

module.exports = {
    initDB,
    syncConfigs,
    refreshConfig,
    updateConfig
};
