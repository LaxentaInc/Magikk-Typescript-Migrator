/**
 * Bot Protection Module - Main Entry Point
 * Modular bot protection for Discord servers
 * 
 * Automatically kicks suspicious bots and punishes users who add them.
 * ALL bots get permissions stripped immediately - suspicious ones get kicked + adder punished.
 */

const { getDefaultConfig, isTrustedUser } = require('./config');
const { initDB, syncConfigs, updateConfig, createDefaultConfig } = require('./database');
const { analyzeBotSuspicion } = require('./detection');
const { stripBotPermissions } = require('./permissions');
const { punishUser } = require('./punishment');
const { logPunishmentFailure, notifyGoodBotPermissionStrip, notifyOwner, logBotKick } = require('./notification');
const logManager = require('../logManager');

class BotProtectionModule {
    constructor() {
        this.moduleName = 'bot-protection';
        this.configs = new Map(); // guildId -> config cache
        this.mongoClient = null;
        this.db = null;
        this.collection = null;

        // Sync configs every 10 seconds
        this.syncInterval = setInterval(() => this.syncConfigs(), 60000);

        // Initialize MongoDB connection
        this.initMongoDB();

        console.log(`[${this.moduleName}] Module initialized`);
    }

    /**
     * Set Discord client reference
     */
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
     * Initialize MongoDB connection
     */
    async initMongoDB() {
        const dbResult = await initDB();
        this.mongoClient = dbResult.mongoClient;
        this.db = dbResult.db;
        this.collection = dbResult.collection;

        if (this.db) {
            // Initial config sync
            await this.syncConfigs();
        }
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
     * Handle bot member join (call this from guildMemberAdd event)
     * ALL bots get permissions stripped immediately - suspicious ones get kicked + adder punished
     */
    async handleBotJoin(member, inviter = null) {
        // Only process bots
        if (!member.user.bot) return;

        const guildId = member.guild.id;
        const config = this.getConfig(guildId);

        // Check if module is enabled
        if (!config.enabled) {
            if (config.debug) {
                console.log(`[${this.moduleName}] Skipping - module disabled for guild ${guildId}`);
            }
            return;
        }

        // Check if bot is whitelisted
        if (config.whitlistedBots && config.whitlistedBots.includes(member.user.id)) {
            if (config.debug) {
                console.log(`[${this.moduleName}] ✅ Bot ${member.user.username} is whitelisted`);
            }
            return;
        }

        const botData = {
            botId: member.user.id,
            botUsername: member.user.username,
            botCreatedAt: member.user.createdTimestamp,
            botAgeHours: (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60), // Age in hours
            isVerified: member.user.flags?.has('VerifiedBot') || false,
            hasAvatar: member.user.avatar !== null,
            inviterId: inviter?.id || null,
            inviterUsername: inviter?.username || 'Unknown',
            guildId: guildId,
            guildName: member.guild.name
        };

        // STEP 1: STRIP BOT PERMISSIONS IMMEDIATELY (for ALL bots, suspicious or not)
        const strippedPermissions = await stripBotPermissions(member, inviter, config);

        // Check if bot is suspicious
        const suspicionAnalysis = await analyzeBotSuspicion(botData, config);

        if (suspicionAnalysis.suspicious) {
            // STEP 2a: Handle SUSPICIOUS bots - kick/ban + punish adder
            console.log(`[${this.moduleName}] 🚨 SUSPICIOUS BOT DETECTED: ${member.user.username}`);
            await this.handleSuspiciousBot(member, inviter, suspicionAnalysis, config, strippedPermissions);
        } else {
            // STEP 2b: Handle GOOD bots - just notify about permission strip
            console.log(`[${this.moduleName}] ✅ Bot ${member.user.username} passed checks, but permissions were stripped`);
            await notifyGoodBotPermissionStrip(member, inviter, strippedPermissions, botData, config);
        }
    }

    /**
     * Handle suspicious bot detection
     */
    async handleSuspiciousBot(member, inviter, suspicionData, config, strippedPermissions) {
        const guild = member.guild;
        const botUser = member.user;
        const guildId = guild.id;

        console.log(`[${this.moduleName}] 🚨 SUSPICIOUS BOT DETECTED: ${botUser.username} in ${guild.name}`);
        console.log(`[${this.moduleName}] Reasons:`, suspicionData.reasons);

        // Log to centralized log channel
        logManager.log(guild, 'SUSPICIOUS_BOT', {
            target: botUser,
            description: `Suspicious bot detected: ${botUser.username}`,
            fields: [
                { name: '🤖 Bot', value: `${botUser.username} (${botUser.id})`, inline: true },
                { name: '👤 Added By', value: inviter ? `${inviter.username} (${inviter.id})` : 'Unknown', inline: true },
                { name: '⚠️ Reasons', value: suspicionData.reasons.join(', ') || 'N/A', inline: false }
            ]
        });

        const actionsTaken = {
            botKicked: false,
            botBanned: false,
            userPunished: false,
            punishmentTypes: [],
            errors: []
        };

        // Handle bot actions - NO PERMISSION CHECKS, just attempt and log errors
        for (const action of config.punishmentActions) {
            try {
                if (action === 'kick_bot') {
                    await member.kick(`Suspicious bot - ${suspicionData.reasons.join(', ')}`);
                    console.log(`[${this.moduleName}] ✅ Kicked bot: ${botUser.username}`);
                    actionsTaken.botKicked = true;
                } else if (action === 'ban_bot') {
                    await member.ban({ reason: `Suspicious bot - ${suspicionData.reasons.join(', ')}`, deleteMessageSeconds: 0 });
                    console.log(`[${this.moduleName}] 🔨 Banned bot: ${botUser.username}`);
                    actionsTaken.botBanned = true;
                }
            } catch (error) {
                // Fallback error handling - log but continue to next action
                console.error(`[${this.moduleName}] ❌ Failed to ${action}: ${error.message}`);
                actionsTaken.errors.push(`${action}: ${error.message}`);
            }
        }

        try {
            // Handle inviter punishment (if found, not trusted, and punishment enabled)
            if (!inviter) {
                console.log(`[${this.moduleName}] ℹ️ No inviter found - cannot punish`);
            } else if (!config.punishAdders) {
                console.log(`[${this.moduleName}] ℹ️ Punishment disabled in config - skipping ${inviter.username}`);
            } else if (isTrustedUser(inviter, guild, config)) {
                console.log(`[${this.moduleName}] ℹ️ ${inviter.username} is trusted (owner/trusted list) - skipping punishment`);
            } else {
                console.log(`[${this.moduleName}] 🎯 Attempting to punish ${inviter.username}...`);
                const punishmentResults = await punishUser(inviter, guild, config, suspicionData, logPunishmentFailure);
                actionsTaken.userPunished = punishmentResults.punished;
                actionsTaken.punishmentTypes = punishmentResults.punishmentTypes;
                if (punishmentResults.errors) {
                    actionsTaken.errors = [...actionsTaken.errors, ...punishmentResults.errors];
                }
            }

            // Send owner notification if enabled
            if (config.notifyOwner) {
                await notifyOwner(guild, botUser, inviter, suspicionData, actionsTaken);
            }

            // Log to centralized alert channel (aero-alerts) via notification module
            if (config.logActions) {
                // We pass guild directly because logBotKick uses LogManager which handles channel finding
                await logBotKick(guild, botUser, inviter, suspicionData, config, actionsTaken);
            }

        } catch (error) {
            console.error(`[${this.moduleName}] ❌ Error handling suspicious bot outcome:`, error.message);
        }
    }

    /**
     * Create default config for a guild in MongoDB
     */
    async createDefaultConfig(guildId) {
        const defaultConfig = getDefaultConfig();
        return await createDefaultConfig(this.collection, guildId, defaultConfig, this.configs);
    }

    /**
     * Update config in MongoDB (called from frontend API)
     */
    async updateConfig(guildId, newConfig) {
        return await updateConfig(this.collection, guildId, newConfig, this.configs);
    }

    /**
     * Get module status for a guild
     */
    getStatus(guildId) {
        const config = this.getConfig(guildId);

        return {
            moduleName: this.moduleName,
            enabled: config.enabled,
            autoKickBots: config.autoKickBots,
            punishAdders: config.punishAdders,
            config,
            isConnectedToMongoDB: this.collection !== null,
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
     * Graceful shutdown
     */
    async shutdown() {
        console.log(`[${this.moduleName}] 🛑 Shutting down...`);

        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        if (this.mongoClient) {
            await this.mongoClient.close();
            console.log(`[${this.moduleName}] ✅ MongoDB connection closed`);
        }
    }
}

// Export singleton instance
module.exports = new BotProtectionModule();
