/**
 * Mass Action Protection Module (AMA)
 * Modularized version
 */

const { getDefaultConfig } = require('./config');
const { initMongoDB, syncConfigs, createDefaultConfig, updateConfig } = require('./database');
const { cleanupOldActions } = require('./tracking');
const { handleModeratorAction, trackAction, handleMassActionViolation, isTrustedUser } = require('./detection');
const { executePunishment, stripDangerousRoles } = require('./punishment');
const { notifyAndLog } = require('./notification');
const logManager = require('../logManager');

class MassActionProtectionModule {
    constructor(discordClient = null) {
        this.moduleName = 'mass-action-protection';
        this.configs = new Map(); // guildId -> config cache
        this.actionTracking = new Map(); // guildId -> Map(userId -> actions[])
        this.processingViolations = new Set(); // Globally track users being punished to prevent spam (Debounce)
        this.mongoClient = null;
        this.db = null;
        this.collection = null;
        this.client = discordClient;

        // Sync configs every 10 seconds
        this.syncInterval = setInterval(() => this.syncConfigs(), 60000);

        // Clean old action tracking every 5 minutes
        this.cleanupInterval = setInterval(() => this.cleanupOldActions(), 300000);

        // Initialize MongoDB connection
        this.initMongoDB();

        console.log(`[${this.moduleName}] Module initialized`);
    }

    setClient(client) {
        this.client = client;
        console.log(`[${this.moduleName}] Discord client reference set`);

        // Initialize persistent buttons
        try {
            const buttons = require('./buttons');
            buttons.init(client);
        } catch (err) {
            console.error(`[${this.moduleName}] Failed to initialize buttons:`, err);
        }
    }

    /**
     * Init MongoDB connection
     */
    async initMongoDB() {
        const { mongoClient, db, collection } = await initMongoDB();
        this.mongoClient = mongoClient;
        this.db = db;
        this.collection = collection;

        // Initial config sync
        await this.syncConfigs();
    }

    /**
     * Sync configurations from MongoDB
     */
    async syncConfigs() {
        await syncConfigs(this.collection, this.configs);
    }

    /**
     * Get configuration for a guild (with defaults)
     */
    getConfig(guildId) {
        const cached = this.configs.get(guildId);
        const defaults = getDefaultConfig();

        // Always merge with defaults to self-heal corrupted configs
        return cached ? { ...defaults, ...cached } : defaults;
    }

    /**
     * Handle member removal (kick detection)
     */
    async handleMemberRemove(member) {
        await this.handleModeratorAction(member.guild, 'MEMBER_KICK', member);
    }

    /**
     * Handle ban addition
     */
    async handleBanAdd(ban) {
        await this.handleModeratorAction(ban.guild, 'MEMBER_BAN_ADD', ban.user);
    }

    /**
     * Handle moderator actions (kick/ban)
     */
    async handleModeratorAction(guild, actionType, targetUser) {
        const context = {
            getConfig: (gid) => this.getConfig(gid),
            trackAction: (gid, eid, at, tu, cfg) => this.trackAction(gid, eid, at, tu, cfg),
            moduleName: this.moduleName
        };
        await handleModeratorAction(guild, actionType, targetUser, context);
    }

    /**
     * Track and analyze moderator actions
     */
    /**
     * Track and analyze moderator actions
     */
    async trackAction(guildId, executorId, actionType, targetUser, config) {
        const context = {
            actionTracking: this.actionTracking,
            processingViolations: this.processingViolations,
            handleMassActionViolation: (gid, eid, vd, cfg) => this.handleMassActionViolation(gid, eid, vd, cfg),
            moduleName: this.moduleName
        };
        await trackAction(guildId, executorId, actionType, targetUser, config, context);
    }

    /**
     * Handle mass action violation
     */
    async handleMassActionViolation(guildId, executorId, violationData, config) {
        const context = {
            getGuildById: (gid) => this.getGuildById(gid),
            actionTracking: this.actionTracking,
            processingViolations: this.processingViolations,
            moduleName: this.moduleName,
            stripDangerousRoles: (m, g) => stripDangerousRoles(m, g) // Pass strip function
        };
        await handleMassActionViolation(guildId, executorId, violationData, config, context);
    }

    /**
     * Execute punishment action on violator
     */
    async executePunishment(member, guild, action, config) {
        return await executePunishment(member, guild, action, config);
    }

    /**
     * Notify server owner about violation
     */
    /**
     * Unified notification
     */
    async notifyAndLog(guild, violator, violationData, actionsPerformed, config) {
        await notifyAndLog(guild, violator, violationData, actionsPerformed, config);
    }

    /**
     * Check if user is trusted (owner or in trusted list)
     */
    isTrustedUser(user, guild, config) {
        return isTrustedUser(user, guild, config);
    }

    /**
     * Clean up old action tracking data
     */
    cleanupOldActions() {
        cleanupOldActions(this.actionTracking, (gid) => this.getConfig(gid));
    }

    /**
     * Get guild by ID (helper method)
     */
    async getGuildById(guildId) {
        if (!this.client) {
            console.error(`[${this.moduleName}] ❌ Discord client not set! Call setClient(client) first.`);
            return null;
        }

        try {
            return await this.client.guilds.fetch(guildId);
        } catch (error) {
            console.error(`[${this.moduleName}] ❌ Failed to fetch guild ${guildId}:`, error.message);
            return null;
        }
    }

    /**
     * Create default config for a guild in MongoDB
     */
    async createDefaultConfig(guildId) {
        return await createDefaultConfig(this.collection, this.configs, guildId, getDefaultConfig());
    }

    /**
     * Update config in MongoDB (called from frontend API)
     */
    async updateConfig(guildId, newConfig) {
        return await updateConfig(this.collection, this.configs, guildId, newConfig);
    }

    /**
     * Get current action tracking stats for a guild
     */
    getTrackingStats(guildId) {
        const guildTracking = this.actionTracking.get(guildId);
        if (!guildTracking) return { activeUsers: 0, totalActions: 0 };

        let totalActions = 0;
        guildTracking.forEach(userActions => {
            totalActions += userActions.length;
        });

        return {
            activeUsers: guildTracking.size,
            totalActions,
            userBreakdown: Array.from(guildTracking.entries()).map(([userId, actions]) => ({
                userId,
                actionCount: actions.length,
                kicks: actions.filter(a => a.type === 'MEMBER_KICK').length,
                bans: actions.filter(a => a.type === 'MEMBER_BAN_ADD').length
            }))
        };
    }

    /**
     * Get module status for a guild
     */
    getStatus(guildId) {
        const config = this.getConfig(guildId);
        const trackingStats = this.getTrackingStats(guildId);

        return {
            moduleName: this.moduleName,
            enabled: config.enabled,
            config,
            trackingStats,
            isConnectedToMongoDB: this.collection !== null,
            hasDiscordClient: this.client !== null,
            lastSync: new Date().toISOString()
        };
    }

    /**
     * Manual enable/disable for testing
     */
    async toggleModule(guildId, enabled) {
        const currentConfig = this.getConfig(guildId);
        const newConfig = { ...currentConfig, enabled };

        return await this.updateConfig(guildId, newConfig);
    }

    /**
     * Reset tracking for a specific user (admin command)
     */
    resetUserTracking(guildId, userId) {
        const guildTracking = this.actionTracking.get(guildId);
        if (guildTracking && guildTracking.has(userId)) {
            guildTracking.delete(userId);
            console.log(`[${this.moduleName}] 🔄 Reset tracking for user ${userId} in guild ${guildId}`);
            return true;
        }
        return false;
    }

    /**
     * Get detailed action history for debugging
     */
    getActionHistory(guildId, userId = null) {
        const guildTracking = this.actionTracking.get(guildId);
        if (!guildTracking) return [];

        if (userId) {
            return guildTracking.get(userId) || [];
        } else {
            const allActions = [];
            guildTracking.forEach((userActions, uid) => {
                userActions.forEach(action => {
                    allActions.push({ ...action, executorId: uid });
                });
            });
            return allActions.sort((a, b) => b.timestamp - a.timestamp);
        }
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        console.log(`[${this.moduleName}] 🛑 Shutting down...`);

        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        if (this.mongoClient) {
            await this.mongoClient.close();
            console.log(`[${this.moduleName}] ✅ MongoDB connection closed`);
        }
    }
}

// Create and export singleton instance
const instance = new MassActionProtectionModule();

// Export both class and singleton instance for flexibility
module.exports = instance; // Default export is the instance
module.exports.instance = instance; // Explicit instance export
