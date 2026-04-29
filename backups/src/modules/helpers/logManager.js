/**
 * LogManager - Centralized Logging System for Anti-Raid Modules
 * 
 * FEATURES:
 * - Auto-regenerating log channel (recreates if deleted)
 * - Queue-based logging (prevents rate limits)
 * - Scalable event type system (add new types without code changes)
 * - Consistent embed formatting
 * - Race condition prevention
 * 
 * USAGE:
 * const logManager = require('./logManager');
 * await logManager.log(guild, 'CHANNEL_DELETE', { channel, executor, ... });
 */

const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// =============================================
// EVENT TYPE REGISTRY (Scalable - just add new types here)
// =============================================
const EVENT_TYPES = {
    // AntiNuke Events
    CHANNEL_CREATE: { color: 0x2ECC71, emoji: '<:mod:1437818267489013960>', title: 'Channel Created', module: 'AntiNuke' },
    CHANNEL_DELETE: { color: 0xE74C3C, emoji: '<:warning:1422451081224392816>', title: 'Channel Deleted', module: 'AntiNuke' },
    CHANNEL_UPDATE: { color: 0xF39C12, emoji: '', title: 'Channel Updated', module: 'AntiNuke' },
    ROLE_CREATE: { color: 0x2ECC71, emoji: '<:mod:1437818267489013960>', title: 'Role Created', module: 'AntiNuke' },
    ROLE_DELETE: { color: 0xE74C3C, emoji: '<:warning:1422451081224392816>', title: 'Role Deleted', module: 'AntiNuke' },
    ROLE_UPDATE: { color: 0xF39C12, emoji: '', title: 'Role Updated', module: 'AntiNuke' },
    EMOJI_DELETE: { color: 0xE74C3C, emoji: '<:warning:1422451081224392816>', title: 'Emoji Deleted', module: 'AntiNuke' },
    STICKER_DELETE: { color: 0xE74C3C, emoji: '<:warning:1422451081224392816>', title: 'Sticker Deleted', module: 'AntiNuke' },
    WEBHOOK_CREATE: { color: 0x9B59B6, emoji: '<:mod:1437818267489013960>', title: 'Webhook Created', module: 'AntiNuke' },
    WEBHOOK_UPDATE: { color: 0x9B59B6, emoji: '', title: 'Webhook Updated', module: 'AntiNuke' },

    // APA Events
    DANGEROUS_ROLE_CREATE: { color: 0xFF6B6B, emoji: '<:warning:1422451081224392816>', title: 'Dangerous Role Created', module: 'APA' },
    DANGEROUS_ROLE_UPDATE: { color: 0xFF6B6B, emoji: '<:warning:1422451081224392816>', title: 'Dangerous Permissions Added', module: 'APA' },
    ROLE_NEUTRALIZED: { color: 0x3498DB, emoji: '<:helppppp:1437818267489013960>', title: 'Role Neutralized', module: 'APA' },
    TRUSTED_USER_WARNING: { color: 0x3498DB, emoji: '<:mod:1437818267489013960>', title: 'Trusted User Action', module: 'APA' },

    // AMA Events
    KICK_TRACKED: { color: 0xF39C12, emoji: '', title: 'Kick Tracked', module: 'AMA' },
    BAN_TRACKED: { color: 0xE74C3C, emoji: '', title: 'Ban Tracked', module: 'AMA' },
    MASS_ACTION_DETECTED: { color: 0xFF0000, emoji: '<:warning:1422451081224392816>', title: 'Mass Action Detected', module: 'AMA' },

    // AntiSpam Events
    SPAM_DETECTED: { color: 0xE67E22, emoji: '<:warning:1422451081224392816>', title: 'Spam Detected', module: 'AntiSpam' },
    MESSAGES_DELETED: { color: 0xE67E22, emoji: '', title: 'Messages Deleted', module: 'AntiSpam' },

    // BotProtection Events
    SUSPICIOUS_BOT: { color: 0x9B59B6, emoji: '<:warning:1422451081224392816>', title: 'Suspicious Bot Joined', module: 'BotProtection' },
    BOT_KICKED: { color: 0xE74C3C, emoji: '<:warning:1422451081224392816>', title: 'Bot Kicked', module: 'BotProtection' },

    // AgeVerify Events
    YOUNG_ACCOUNT: { color: 0xF1C40F, emoji: '<:warning:1422451081224392816>', title: 'Young Account Detected', module: 'AgeVerify' },
    ACCOUNT_ACTION: { color: 0xE74C3C, emoji: '<:timeout:1422451090259181568>', title: 'Account Age Action', module: 'AgeVerify' },

    // Universal Punishment Events
    USER_PUNISHED: { color: 0xE74C3C, emoji: '<:timeout:1422451090259181568>', title: 'User Punished', module: 'System' },
    ROLES_STRIPPED: { color: 0xFF6B6B, emoji: '<:timeout:1422451090259181568>', title: 'Roles Stripped', module: 'System' },
    USER_TIMEOUT: { color: 0xF39C12, emoji: '<:timeout:1422451090259181568>', title: 'User Timed Out', module: 'System' },
    USER_KICKED: { color: 0xE74C3C, emoji: '<:timeout:1422451090259181568>', title: 'User Kicked', module: 'System' },
    USER_BANNED: { color: 0x992D22, emoji: '<:timeout:1422451090259181568>', title: 'User Banned', module: 'System' },

    // System Events
    LOG_CHANNEL_CREATED: { color: 0x2ECC71, emoji: '<:mod:1437818267489013960>', title: 'Log Channel Created', module: 'System' },
    MODULE_ERROR: { color: 0xE74C3C, emoji: '<:warning:1422451081224392816>', title: 'Module Error', module: 'System' }
};

// =============================================
// LOG MANAGER CLASS
// =============================================
class LogManager {
    constructor() {
        this.channelCache = new Map();      // guildId -> channelId
        this.alertChannelCache = new Map(); // guildId -> alertChannelId
        this.logQueue = new Map();          // guildId -> [pending logs]
        this.alertQueue = new Map();        // guildId -> [pending alerts]
        this.processing = new Set();         // guildIds currently being processed
        this.alertProcessing = new Set();    // guildIds currently being processed for alerts
        this.channelCreating = new Set();    // guildIds where channel is being created
        this.alertChannelCreating = new Set(); // guildIds where alert channel is being created
        this.submissionSuspended = new Set(); // guildIds where recreation is suspended
        this.categoryLock = new Map();       // guildId -> Promise (for category creation)

        this.LOG_CHANNEL_NAME = 'aero-logs';
        this.ALERT_CHANNEL_NAME = 'aero-alerts'; // Dedicated channel for threshold/punishment events

        this.CATEGORY_NAME = 'Aero';

        this.MAX_BATCH_SIZE = 10;            // Max embeds per message
        this.QUEUE_DELAY = 500;              // ms between queue processing

        console.log('[LogManager] Centralized logging system initialized');
    }

    /**
     * Register a new event type dynamically (for future modules)
     */
    registerEventType(type, config) {
        if (EVENT_TYPES[type]) {
            console.warn(`[LogManager] Event type ${type} already exists, overwriting`);
        }
        EVENT_TYPES[type] = config;
        console.log(`[LogManager] Registered new event type: ${type}`);
    }

    /**
     * Get or create the log channel for a guild
     * Auto-regenerates if deleted
     */
    async getLogChannel(guild) {
        return this._getOrCreateChannel(guild, this.LOG_CHANNEL_NAME, this.channelCache, this.channelCreating);
    }

    /**
     * Get or create the ALERT channel for a guild (for threshold/punishment events)
     */
    async getAlertChannel(guild) {
        return this._getOrCreateChannel(guild, this.ALERT_CHANNEL_NAME, this.alertChannelCache, this.alertChannelCreating);
    }

    /**
     * Ensure the Aero category exists, with locking to prevent duplicates
     */
    async ensureCategory(guild) {
        const CategoryName = this.CATEGORY_NAME;

        // 1. Check cache/API first (fast path)
        let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === CategoryName);
        if (category) return category;

        // 2. Check overlap lock
        if (this.categoryLock.has(guild.id)) {
            return this.categoryLock.get(guild.id);
        }

        // 3. Create lock
        const creationPromise = (async () => {
            try {
                // Double check after acquiring lock
                let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === CategoryName);
                if (cat) return cat;

                cat = await guild.channels.create({
                    name: CategoryName,
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        { // Hide category by default to keep clean
                            id: guild.id,
                            deny: [PermissionFlagsBits.ViewChannel]
                        }
                    ]
                });

                // Move to bottom
                try {
                    await cat.setPosition(guild.channels.cache.size + 1);
                } catch (e) { }

                return cat;
            } catch (err) {
                console.error(`[LogManager] Failed to create category in ${guild.name}:`, err.message);
                return null;
            } finally {
                this.categoryLock.delete(guild.id);
            }
        })();

        this.categoryLock.set(guild.id, creationPromise);
        return creationPromise;
    }

    /**
     * Internal helper to specific channel type
     */
    async _getOrCreateChannel(guild, channelName, cacheMap, creationSet) {
        const guildId = guild.id;

        // Check cache first
        const cachedId = cacheMap.get(guildId);
        if (cachedId) {
            const channel = guild.channels.cache.get(cachedId);
            if (channel) return channel;
            cacheMap.delete(guildId);
        }

        // Search for existing channel
        let channel = guild.channels.cache.find(c => c.name === channelName);

        if (channel) {
            cacheMap.set(guildId, channel.id);

            // Ensure category alignment (lazy fix)
            const category = await this.ensureCategory(guild);
            if (category && channel.parentId !== category.id) {
                try {
                    await channel.setParent(category.id, { lockPermissions: false });
                    console.log(`[LogManager] Moved existing ${channelName} to category`);
                } catch (err) { }
            }
            return channel;
        }

        if (this.submissionSuspended.has(guildId)) return null;
        if (creationSet.has(guildId)) {
            // Wait for existing creation to finish
            await new Promise(r => setTimeout(r, 2000));
            return guild.channels.cache.find(c => c.name === channelName) || null;
        }

        creationSet.add(guildId);

        try {
            if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return null;
            }

            const category = await this.ensureCategory(guild);

            channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: category ? category.id : null,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: guild.members.me.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    }
                ],
                reason: 'Aero LogManager: Auto-regenerated channel'
            });

            // Double Ensure Parent (sometimes create option fails if perms are weird)
            if (category && channel.parentId !== category.id) {
                await channel.setParent(category.id, { lockPermissions: false }).catch(() => { });
            }

            cacheMap.set(guildId, channel.id);
            console.log(`[LogManager] Created ${channelName} in ${guild.name}`);

            if (channelName === this.LOG_CHANNEL_NAME) {
                await this.sendEmbed(channel, this.buildEmbed('LOG_CHANNEL_CREATED', {
                    description: 'Log channel was auto-regenerated',
                }));
            }

            return channel;

        } catch (error) {
            console.error(`[LogManager] Failed to create ${channelName}:`, error.message);
            return null;
        } finally {
            creationSet.delete(guildId);
        }
    }

    /**
     * Build an embed from event type and data
     */
    buildEmbed(eventType, data = {}) {
        const config = EVENT_TYPES[eventType] || {
            color: 0x95A5A6,
            emoji: '<:mod:1437818267489013960>',
            title: eventType,
            module: 'Unknown'
        };

        const embed = new EmbedBuilder()
            .setColor(config.color)
            .setTitle(config.emoji ? `${config.emoji} ${config.title}` : config.title)
            .setFooter({ text: `${config.module} | Aero Anti-Raid` });

        // Add description if provided
        if (data.description) {
            embed.setDescription(data.description);
        }

        // Add executor info (auto-added)
        if (data.executor) {
            const exec = data.executor;
            embed.addFields({
                name: '<:timeout:1422451090259181568> Executor',
                value: `**${exec.username || exec.user?.username || 'Unknown'}** ${exec.bot ? '🤖' : ''}\n<@${exec.id || exec.user?.id}>`,
                inline: true
            });
        }

        // Add target info (auto-added)
        if (data.target) {
            const targetName = data.target.name || data.target.username || data.target.user?.username || 'Unknown';
            embed.addFields({
                name: '<a:marker_1326464173361856524:1342443432240746577> Target',
                value: `**${targetName}**\nID: ${data.target.id || data.target.user?.id || 'N/A'}`,
                inline: true
            });
        }

        // Add custom fields (modules control all fields)
        if (data.fields && Array.isArray(data.fields)) {
            for (const field of data.fields) {
                embed.addFields({
                    name: field.name,
                    value: String(field.value).slice(0, 1024),
                    inline: field.inline ?? false
                });
            }
        }

        // Add reason if provided
        if (data.reason) {
            embed.addFields({ name: '<:warning:1422451081224392816> Reason', value: data.reason, inline: false });
        }

        return embed;
    }

    /**
     * Send embed to channel (with error handling)
     */
    async sendEmbed(channel, embed) {
        try {
            await channel.send({ embeds: [embed] });
            return true;
        } catch (error) {
            console.error(`[LogManager] Failed to send log:`, error.message);
            return false;
        }
    }

    /**
     * Main logging method - queues logs and processes them
     */
    async log(guild, eventType, data = {}) {
        if (!guild) return false;

        const guildId = guild.id;

        // Add to queue
        if (!this.logQueue.has(guildId)) {
            this.logQueue.set(guildId, []);
        }

        this.logQueue.get(guildId).push({
            eventType,
            data,
            timestamp: Date.now()
        });

        // Process queue if not already processing
        if (!this.processing.has(guildId)) {
            this.processQueue(guildId, guild);
        }

        return true;
    }

    /**
     * Process queued logs for a guild
     */
    async processQueue(guildId, guild) {
        if (this.processing.has(guildId)) return;
        this.processing.add(guildId);

        try {
            const channel = await this.getLogChannel(guild);
            if (!channel) {
                console.warn(`[LogManager] No log channel for ${guild.name}, clearing queue`);
                this.logQueue.delete(guildId);
                return;
            }

            while (this.logQueue.has(guildId) && this.logQueue.get(guildId).length > 0) {
                const queue = this.logQueue.get(guildId);
                const batch = queue.splice(0, this.MAX_BATCH_SIZE);

                const embeds = batch.map(item => this.buildEmbed(item.eventType, item.data));

                try {
                    await channel.send({ embeds });
                } catch (error) {
                    if (error.code === 10003) { // Unknown Channel
                        // Channel was deleted, clear cache and retry
                        this.channelCache.delete(guildId);
                        const newChannel = await this.getLogChannel(guild);
                        if (newChannel) {
                            await newChannel.send({ embeds });
                        }
                    } else {
                        console.error(`[LogManager] Queue processing error:`, error.message);
                    }
                }

                // Small delay between batches to prevent rate limits
                if (queue.length > 0) {
                    await new Promise(r => setTimeout(r, this.QUEUE_DELAY));
                }
            }

        } finally {
            this.processing.delete(guildId);
        }
    }

    /**
     * Log a CRITICAL ALERT to the separate aero-alerts channel
     * Supports raw embeds and buttons (components)
     * Sends IMMEDIATELY (no queue) to ensure it syncs with DMs
     */
    async logAlert(guild, { embed, components = [] }) {
        if (!guild) return false;

        try {
            const channel = await this.getAlertChannel(guild);
            if (!channel) return false;

            try {
                const message = await channel.send({ embeds: [embed], components });
                return message;
            } catch (error) {
                console.error('Failed to send alert:', error);
                return null;
            }
        } catch (error) {
            if (error.code === 10003) { // Unknown Channel
                // Channel was deleted, clear cache and retry
                this.alertChannelCache.delete(guild.id);
                const newChannel = await this.getAlertChannel(guild);
                if (newChannel) {
                    await newChannel.send({ embeds: [embed], components }).catch(e => console.error('Failed retry alert:', e.message));
                }
            } else {
                console.error(`[LogManager] Failed to send alert:`, error.message);
            }
            return false;
        }
    }

    /**
     * Quick log methods for common events
     */
    async logChannelChange(guild, action, channel, executor) {
        const eventType = `CHANNEL_${action.toUpperCase()}`;
        return this.log(guild, eventType, {
            target: channel,
            executor,
            fields: [
                { name: '📁 Channel Type', value: channel.type?.toString() || 'Text', inline: true }
            ]
        });
    }

    async logRoleChange(guild, action, role, executor, extraFields = []) {
        const eventType = `ROLE_${action.toUpperCase()}`;
        return this.log(guild, eventType, {
            target: role,
            executor,
            fields: extraFields
        });
    }

    async logPunishment(guild, action, target, executor, reason) {
        const actionMap = {
            'timeout': 'USER_TIMEOUT',
            'kick': 'USER_KICKED',
            'ban': 'USER_BANNED',
            'strip': 'ROLES_STRIPPED'
        };
        return this.log(guild, actionMap[action] || 'USER_PUNISHED', {
            target,
            executor,
            reason
        });
    }

    /**
     * Invalidate cache for a guild (call when channel is deleted)
     */
    invalidateCache(guildId) {
        this.channelCache.delete(guildId);
    }

    /**
     * Suspend recreation for a specific time (e.g. after deletion)
     */
    suspendRecreation(guildId, duration = 60000) {
        this.submissionSuspended.add(guildId);
        console.log(`[LogManager] Suspended recreation for ${guildId} for ${duration}ms`);
        setTimeout(() => {
            this.submissionSuspended.delete(guildId);
        }, duration);
    }

    /**
     * Get available event types (for debugging/docs)
     */
    getEventTypes() {
        return Object.keys(EVENT_TYPES);
    }
}

// Export singleton instance
module.exports = new LogManager();
module.exports.EVENT_TYPES = EVENT_TYPES;
