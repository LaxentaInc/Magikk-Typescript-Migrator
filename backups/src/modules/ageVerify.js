/*
=== ACCOUNT AGE PROTECTION MODULE ===
Automatically monitors new user joins and takes action based on account age.

FEATURES:
- Configurable minimum account age limits
- Trusted user whitelist (owner + configured IDs/roles)
- Multiple action types: kick, ban, timeout (always notifies regardless)
- Customizable log channel for notifications
- ALWAYS notifies owner via DM
- MongoDB config sync every 10 seconds
- Rich analytics and logging
- Bypass system for trusted users


MONGODB DOCUMENT STRUCTURE:
Collection: 'account_age_configs'
Document: {
    guildId: String,
    config: {
        enabled: Boolean,
        minAccountAge: Number (days),
        action: String ('kick'|'ban'|'timeout'|'none'),
        timeoutDuration: Number (seconds),
        logChannelId: String (Discord channel ID),
        trustedUsers: Array<String> (user IDs),
        trustedRoles: Array<String> (role IDs),
        bypassTrusted: Boolean,
        logActions: Boolean,
        debug: Boolean
    },
    lastUpdated: Date,
    createdAt: Date
}
*/

const { getCollection } = require('../utils/CloudDB');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logManager = require('./helpers/logManager');

class AccountAgeProtectionModule {
    constructor() {
        this.moduleName = 'account-age-protection';
        this.configs = new Map(); // guildId -> config cache
        // no longer owns its own client — uses shared pool
        this.collection = null;

        // sync configs every 60s instead of 10s — reduces db load
        this.syncInterval = setInterval(() => this.syncConfigs(), 60000);

        // Initialize MongoDB connection
        this.initMongoDB();

        console.log(`[${this.moduleName}] Module initialized`);
    }

    /**
     * Initialize MongoDB connection
     */
    async initMongoDB() {
        try {
            this.collection = await getCollection('account_age_configs', 'antiraid');
            console.log(`[${this.moduleName}] ✅ connected to MongoDB (shared pool)`);

            // initial config sync
            await this.syncConfigs();

        } catch (error) {
            console.error(`[${this.moduleName}] ❌ MongoDB connection failed:`, error.message);
            // continue without db - use default configs
        }
    }

    /**
     * Sync configurations from MongoDB
     */
    async syncConfigs() {
        if (!this.collection) return;

        try {
            const dbConfigs = await this.collection.find({}).toArray();

            for (const dbConfig of dbConfigs) {
                const guildId = dbConfig.guildId;
                const cachedConfig = this.configs.get(guildId);

                // Check if config changed
                if (!cachedConfig || JSON.stringify(cachedConfig) !== JSON.stringify(dbConfig.config)) {
                    this.configs.set(guildId, dbConfig.config);

                    console.log(`[${this.moduleName}] 🔄 Config updated for guild ${guildId}`);
                }
            }

        } catch (error) {
            console.error(`[${this.moduleName}] ❌ Config sync failed:`, error.message);
        }
    }

    /**
     * Get configuration for a guild (with defaults)
     */
    getConfig(guildId) {
        const cached = this.configs.get(guildId);

        // Default configuration
        const defaults = {
            enabled: true,                    // Module enabled by default
            minAccountAge: 7,                 // Minimum account age in days (default: 7 days)
            action: 'none',                   // Default action: 'none', 'kick', 'ban', 'timeout'
            timeoutDuration: 600,             // Timeout duration in seconds (10 minutes)
            logChannelId: null,               // Discord channel ID for notifications (null = system channel)
            trustedUsers: [],                 // User IDs that bypass age check
            trustedRoles: [],                 // Role IDs that bypass age check
            bypassTrusted: true,              // Whether trusted users bypass the check
            logActions: true,                 // Log actions to configured channel
            debug: true                       // Debug logging
        };

        // Always merge with defaults to self-heal corrupted configs
        return cached ? { ...defaults, ...cached } : defaults;
    }

    /**
     * Handle new member join (call this from guildMemberAdd event)
     */
    async handleMemberJoin(member) {
        // Skip bots
        if (member.user.bot) return;

        const guildId = member.guild.id;
        const config = this.getConfig(guildId);

        // Only check module-specific toggle
        if (!config.enabled) {
            if (config.debug) {
                console.log(`[${this.moduleName}] Skipping - module disabled for guild ${guildId}`);
            }
            return;
        }

        const userData = {
            userId: member.user.id,
            username: member.user.username,
            userTag: member.user.tag,
            accountCreatedAt: member.user.createdTimestamp,
            accountAge: Date.now() - member.user.createdTimestamp,
            joinedAt: member.joinedTimestamp || Date.now(),
            hasAvatar: member.user.avatar !== null,
            guildId: guildId,
            guildName: member.guild.name
        };

        // Check if user should be processed
        const shouldTakeAction = await this.shouldTakeAction(member, userData, config);

        if (shouldTakeAction.takeAction) {
            await this.handleYoungAccount(member, shouldTakeAction, config);
        } else {
            if (config.debug) {
                console.log(`[${this.moduleName}] ✅ User ${member.user.username} passed age check or is trusted`);
            }
        }
    }

    /**
     * Determine if action should be taken against the user
     */
    async shouldTakeAction(member, userData, config) {
        const accountAgeDays = userData.accountAge / (1000 * 60 * 60 * 24);
        const reasons = [];

        // Check if user is trusted (and bypass is enabled)
        if (config.bypassTrusted && this.isTrustedUser(member.user, member.guild, config)) {
            return {
                takeAction: false,
                reason: 'Trusted user bypass',
                accountAgeDays: Math.round(accountAgeDays)
            };
        }

        // Check account age
        if (accountAgeDays < config.minAccountAge) {
            reasons.push(`Account too young (${Math.round(accountAgeDays)}d < ${config.minAccountAge}d)`);

            return {
                takeAction: true,
                reasons,
                accountAgeDays: Math.round(accountAgeDays),
                action: config.action,
                analysis: {
                    accountAgeDays: Math.round(accountAgeDays),
                    minRequired: config.minAccountAge,
                    hasAvatar: userData.hasAvatar,
                    isTrusted: this.isTrustedUser(member.user, member.guild, config)
                }
            };
        }

        return {
            takeAction: false,
            reason: 'Account age acceptable',
            accountAgeDays: Math.round(accountAgeDays)
        };
    }

    /**
     * Handle young account detection
     */
    async handleYoungAccount(member, actionData, config) {
        const guild = member.guild;
        const user = member.user;

        try {
            let actionTaken = false;
            let actionResult = 'No action taken';

            // take configured action (if not 'none')
            if (config.action !== 'none') {
                switch (config.action) {
                    case 'kick':
                        await member.kick(`Account too young (${actionData.accountAgeDays}d < ${config.minAccountAge}d)`);
                        actionTaken = true;
                        actionResult = 'User kicked';
                        break;

                    case 'ban':
                        await member.ban({
                            reason: `Account too young (${actionData.accountAgeDays}d < ${config.minAccountAge}d)`,
                            deleteMessageSeconds: 0
                        });
                        actionTaken = true;
                        actionResult = 'User banned';
                        break;

                    case 'timeout':
                        await member.timeout(
                            config.timeoutDuration * 1000,
                            `Account too young (${actionData.accountAgeDays}d < ${config.minAccountAge}d)`
                        );
                        actionTaken = true;
                        actionResult = `User timed out for ${config.timeoutDuration}s`;
                        break;

                    default:
                        actionResult = 'Unknown action - no action taken';
                }
            }

            // build the embed once, reuse it for log channel + admin notification
            const actionColors = {
                'none': 0xF1C40F,
                'kick': 0xE74C3C,
                'ban': 0x8B0000,
                'timeout': 0xFF8800
            };

            const alertEmbed = new EmbedBuilder()
                .setColor(actionColors[config.action] || 0xF1C40F)
                .setTitle(`<:warning:1422451081224392816> Young Account Detected`)
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
                .setDescription(`**${user.username}** joined with a suspiciously young account.`)
                .addFields(
                    { name: '<:timeout:1422451090259181568> User', value: `${user} (\`${user.id}\`)`, inline: true },
                    { name: '📅 Account Age', value: `**${actionData.accountAgeDays}** days (min: ${config.minAccountAge})`, inline: true },
                    { name: '📆 Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: '⚡ Action Taken', value: actionResult, inline: true },
                    { name: '🖼️ Avatar', value: actionData.analysis?.hasAvatar ? 'Yes' : 'No', inline: true },
                    ...(config.action === 'timeout' ? [{ name: '⏰ Timeout Duration', value: `${config.timeoutDuration}s`, inline: true }] : [])
                )
                .setFooter({ text: 'Account Age Verification | /dashboard to configure' })
                .setTimestamp();

            // add detection reasons if present
            if (actionData.reasons?.length > 0) {
                alertEmbed.addFields({ name: '⚠️ Reason', value: actionData.reasons.join('\n'), inline: false });
            }

            // log to centralized log channel via logManager
            await logManager.log(guild, actionTaken ? 'ACCOUNT_ACTION' : 'YOUNG_ACCOUNT', {
                target: user,
                description: `Young account detected: **${user.username}** (${actionData.accountAgeDays}d old)`,
                fields: [
                    { name: '📅 Account Age', value: `${actionData.accountAgeDays} days (min: ${config.minAccountAge})`, inline: true },
                    { name: '📆 Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: '⚡ Action', value: actionResult, inline: false }
                ]
            });

            // notify server admins in the log channel
            await this.notifyAdmins(guild, alertEmbed);

            // notify owner via dm
            await this.notifyOwner(guild, user, actionData, config, actionResult, alertEmbed);

        } catch (error) {
            console.error(`[${this.moduleName}] error handling young account:`, error.message);
        }
    }

    /**
     * Check if user is trusted (owner or in trusted list)
     */
    isTrustedUser(user, guild, config) {
        // Guild owner is always trusted
        if (user.id === guild.ownerId) return true;

        // Check trusted user IDs
        if (config.trustedUsers.includes(user.id)) return true;

        // Check if user has trusted roles
        const member = guild.members.cache.get(user.id);
        if (member && config.trustedRoles.some(roleId => member.roles.cache.has(roleId))) {
            return true;
        }

        return false;
    }

    /**
     * notify server admins about the young account in the log channel
     */
    async notifyAdmins(guild, alertEmbed) {
        try {
            // find the aero-alerts or aero-logs channel
            const alertChannel = await logManager.getAlertChannel(guild);
            if (!alertChannel) return;

            // find members with administrator permission to ping
            const adminMentions = [];
            try {
                const members = guild.members.cache.filter(m =>
                    !m.user.bot &&
                    m.permissions.has(PermissionFlagsBits.Administrator) &&
                    m.id !== guild.ownerId
                );
                members.forEach(m => adminMentions.push(`<@${m.id}>`));
            } catch (e) {
                // if we can't fetch members just send without pings
            }

            const pingText = adminMentions.length > 0
                ? `**Server admins:** ${adminMentions.slice(0, 5).join(', ')}`
                : null;

            await alertChannel.send({
                content: pingText,
                embeds: [alertEmbed]
            });
        } catch (error) {
            console.error(`[${this.moduleName}] failed to notify admins:`, error.message);
        }
    }

    /**
     * notify server owner via dm
     */
    async notifyOwner(guild, user, actionData, config, actionResult, alertEmbed) {
        try {
            const owner = await guild.fetchOwner();
            if (!owner) return;

            // build a dm-specific embed based on the alert embed
            const dmEmbed = new EmbedBuilder(alertEmbed.data)
                .setTitle(`<:warning:1422451081224392816> Young Account Alert — ${guild.name}`)
                .setDescription(`A young account was detected in **${guild.name}**.`)
                .setFooter({ text: 'Account Age Verification | Configure via /dashboard' });

            await owner.send({ embeds: [dmEmbed] }).catch(() => { });
        } catch (error) {
            // don't throw - owner might have dms disabled
        }
    }

    /**
     * Create default config for a guild in MongoDB
     */
    async createDefaultConfig(guildId) {
        if (!this.collection) return null;

        const defaultConfig = {
            enabled: true,                    // Module enabled by default
            minAccountAge: 7,                 // 7 days minimum account age
            action: 'none',                   // Default to just notify
            timeoutDuration: 600,             // 10 minutes timeout (if using timeout action)
            logChannelId: null,               // null = use system channel
            trustedUsers: [],                 // User IDs that bypass age check
            trustedRoles: [],                 // Role IDs that bypass age check
            bypassTrusted: true,              // Whether trusted users bypass check
            logActions: true,                 // Log actions to channel
            debug: true                       // Debug logging
        };

        try {
            await this.collection.updateOne(
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

            console.log(`[${this.moduleName}] 📝 Created default config for guild ${guildId}`);
            this.configs.set(guildId, defaultConfig);

            return defaultConfig;
        } catch (error) {
            console.error(`[${this.moduleName}] ❌ Failed to create default config:`, error.message);
            return defaultConfig; // Return defaults even if DB save fails
        }
    }

    /**
     * Update config in MongoDB (called from frontend API)
     */
    async updateConfig(guildId, newConfig) {
        if (!this.collection) return false;

        try {
            // Validate config
            const validatedConfig = this.validateConfig(newConfig);

            await this.collection.updateOne(
                { guildId },
                {
                    $set: {
                        config: validatedConfig,
                        lastUpdated: new Date()
                    }
                },
                { upsert: true }
            );

            // Update cache immediately
            this.configs.set(guildId, validatedConfig);

            console.log(`[${this.moduleName}] ✅ Config updated for guild ${guildId}`);

            return true;
        } catch (error) {
            console.error(`[${this.moduleName}] ❌ Failed to update config:`, error.message);
            return false;
        }
    }

    /**
     * Validate configuration values
     */
    validateConfig(config) {
        const validated = { ...config };

        // Ensure minAccountAge is reasonable (1-365 days)
        if (validated.minAccountAge < 1) validated.minAccountAge = 1;
        if (validated.minAccountAge > 365) validated.minAccountAge = 365;

        // Ensure action is valid
        const validActions = ['none', 'kick', 'ban', 'timeout'];
        if (!validActions.includes(validated.action)) {
            validated.action = 'none';
        }

        // Ensure timeout duration is reasonable (60s - 28 days)
        if (validated.timeoutDuration < 60) validated.timeoutDuration = 60;
        if (validated.timeoutDuration > 2419200) validated.timeoutDuration = 2419200; // 28 days max

        // Ensure arrays exist
        if (!Array.isArray(validated.trustedUsers)) validated.trustedUsers = [];
        if (!Array.isArray(validated.trustedRoles)) validated.trustedRoles = [];

        return validated;
    }

    /**
     * Get module status for a guild
     */
    getStatus(guildId) {
        const config = this.getConfig(guildId);

        return {
            moduleName: this.moduleName,
            enabled: config.enabled,
            config,
            isConnectedToMongoDB: this.collection !== null,
            lastSync: new Date().toISOString(),
            stats: {
                cachedGuilds: this.configs.size,
                uptime: process.uptime()
            }
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
        console.log(`[${this.moduleName}] 🛑 shutting down...`);

        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        // shared pool manages connection lifecycle
    }
}

// Export singleton instance
module.exports = new AccountAgeProtectionModule();