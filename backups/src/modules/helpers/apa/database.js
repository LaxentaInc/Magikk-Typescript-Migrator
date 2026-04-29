/**
 * APA (Anti-Permission Abuse) Database Manager
 * uses shared mongodb connection from CloudDB
 */

const { getCollection } = require('../../../utils/CloudDB');

class APADatabase {
    constructor() {
        this.collection = null;
        this.moduleName = 'APA';
    }

    /**
     * connect using the shared pool
     */
    async connect() {
        try {
            this.collection = await getCollection('apa_configs', 'antiraid');
            console.log(`[${this.moduleName}] ✅ connected to MongoDB (shared pool)`);
            return true;
        } catch (error) {
            console.error(`[${this.moduleName}] ❌ MongoDB connection failed:`, error.message);
            return false;
        }
    }

    /**
     * fetch all guild configurations from db
     */
    async getAllConfigs() {
        if (!this.collection) return [];
        try {
            return await this.collection.find({}).toArray();
        } catch (error) {
            console.error(`[${this.moduleName}] ❌ failed to fetch configs:`, error.message);
            return [];
        }
    }

    /**
     * update configuration for a specific guild
     */
    async updateConfig(guildId, newConfig) {
        if (!this.collection) return false;
        try {
            await this.collection.updateOne(
                { guildId },
                {
                    $set: {
                        config: newConfig,
                        lastUpdated: new Date()
                    }
                },
                { upsert: true }
            );
            return true;
        } catch (error) {
            console.error(`[${this.moduleName}] ❌ failed to update config:`, error.message);
            return false;
        }
    }

    /**
     * check connection status
     */
    isConnected() {
        return this.collection !== null;
    }

    /**
     * no-op — connection lifecycle is managed by shared pool
     */
    async close() {
        this.collection = null;
    }
}

// export singleton
module.exports = new APADatabase();
