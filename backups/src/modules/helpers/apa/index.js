/**
 * APA (Anti-Permission Abuse) Module - Main Orchestrator
 * 
 * ARCHITECTURE:
 * - ROLE_CREATE: Neutralize role + punish untrusted creator
 * - ROLE_UPDATE: Neutralize added perms + punish untrusted editor
 * - ROLE_ASSIGN: ONLY punish untrusted assigner (don't touch the pre-existing role!)
 */

require('dotenv').config();

const { getDefaultConfig, DANGEROUS_PERMISSIONS, getPermissionName } = require('./config');
const {
    findExecutor,
    isTrusted,
    hasDangerousPermissions,
    getDangerousPermissions,
    getAddedDangerousPermissions,
    isSelfAssignment,
    validateBotPermissions,
    canPunish
} = require('./detection');
const { stripDangerousRoles, executePunishment } = require('./punishment');
const { neutralizeRole } = require('./neutralize');
const { notifyAndLog, notifyPermissionFailure, notifyIgnoredAction } = require('./notification');
const { registerStoredButtons } = require('./buttons');
const db = require('./database');
const logManager = require('../logManager');

class AntiPermissionAbuse {
    constructor(client = null) {
        this.moduleName = 'APA';
        this.client = client;
        this.configs = new Map();

        // Duplicate punishment prevention: guildId -> Map<userId, timestamp>
        this.punishedUsers = new Map();

        // Performance metrics
        this.metrics = {
            eventsProcessed: 0,
            rolesNeutralized: 0,
            punishmentsExecuted: 0,
            duplicatesPrevented: 0,
            permissionFailures: 0
        };

        // Intervals
        this.syncInterval = null;
        this.cleanupInterval = null;

        this.init();
    }

    async init() {
        // Initialize DB connection
        await db.connect();
        await this.syncConfigs();

        // Cleanup punished users periodically
        this.cleanupInterval = setInterval(() => this.cleanupPunishedUsers(), 60000);

        // Sync configs periodically
        this.syncInterval = setInterval(() => this.syncConfigs(), 60000);

        // Buttons are now registered in setClient to ensure DB/Client readiness

        console.log(`[${this.moduleName}] Anti-Permission Abuse Protection initialized`);
    }

    setClient(client) {
        this.client = client;
        console.log(`[${this.moduleName}] Discord client reference set`);

        // Register stored buttons
        registerStoredButtons(client).catch(err =>
            console.error(`[${this.moduleName}] Failed to register stored buttons:`, err)
        );
    }

    // ==========================================
    // CONFIG MANAGEMENT
    // ==========================================

    async syncConfigs() {
        try {
            const dbConfigs = await db.getAllConfigs();
            for (const dbConfig of dbConfigs) {
                const guildId = dbConfig.guildId;
                const cachedConfig = this.configs.get(guildId);

                // Only update cache if different to avoid unnecessary operations
                if (!cachedConfig || JSON.stringify(cachedConfig) !== JSON.stringify(dbConfig.config)) {
                    this.configs.set(guildId, dbConfig.config);
                }
            }
        } catch (error) {
            console.error(`[${this.moduleName}] ❌ Config sync loop failed:`, error.message);
        }
    }

    getConfig(guildId) {
        const cached = this.configs.get(guildId);
        const defaults = getDefaultConfig();

        // Always merge with defaults to self-heal corrupted configs
        return cached ? { ...defaults, ...cached } : defaults;
    }

    async updateConfig(guildId, newConfig) {
        const success = await db.updateConfig(guildId, newConfig);

        if (success) {
            this.configs.set(guildId, newConfig);
            console.log(`[${this.moduleName}] ✅ Config updated for guild ${guildId}`);
            return true;
        }
        return false;
    }

    // ==========================================
    // EVENT HANDLERS (called from main bot)
    // ==========================================

    async handleRoleCreate(role) {
        await this.processEvent(role.guild, 'ROLE_CREATE', role, null, role);
    }

    async handleRoleUpdate(oldRole, newRole) {
        await this.processEvent(newRole.guild, 'ROLE_UPDATE', newRole, oldRole, newRole);
    }

    async handleMemberRoleAdd(member, role) {
        await this.processEvent(member.guild, 'ROLE_ASSIGN', role, null, { member, role });
    }

    // ==========================================
    // MAIN PROCESSING LOGIC
    // ==========================================

    async processEvent(guild, actionType, role, oldRole, eventData) {
        const guildId = guild.id;
        const config = this.getConfig(guildId);

        // Check if module is enabled
        if (!config.enabled) {
            return;
        }

        // Check monitoring toggles
        if (actionType === 'ROLE_CREATE' && !config.monitorRoleCreation) return;
        if (actionType === 'ROLE_UPDATE' && !config.monitorRoleUpdates) return;
        if (actionType === 'ROLE_ASSIGN' && !config.monitorRoleAssignments) return;

        // Skip managed roles (Integration roles cannot be modified by bots)
        if (role.managed) {
            if (config.debug) console.log(`[${this.moduleName}] Skipping managed role: ${role.name}`);
            return;
        }

        this.metrics.eventsProcessed++;

        try {
            // =============================================
            // STEP 1: Check if role has dangerous permissions
            // =============================================
            let isDangerous = false;
            let dangerousPerms = [];

            if (actionType === 'ROLE_CREATE') {
                isDangerous = hasDangerousPermissions(role);
                if (isDangerous) {
                    dangerousPerms = getDangerousPermissions(role);
                }
            } else if (actionType === 'ROLE_UPDATE') {
                // Check if dangerous perms were ADDED
                dangerousPerms = getAddedDangerousPermissions(oldRole, role);
                isDangerous = dangerousPerms.length > 0;
            } else if (actionType === 'ROLE_ASSIGN') {
                // For assignment, check if the assigned role has dangerous perms
                isDangerous = hasDangerousPermissions(role);
                if (isDangerous) {
                    dangerousPerms = getDangerousPermissions(role);
                }
            }

            if (!isDangerous) return;

            // =============================================
            // STEP 2: Find executor from audit logs
            // =============================================
            const executor = await findExecutor(guild, actionType, role, eventData, config.auditLogTimeout);

            if (!executor) {
                console.log(`[${this.moduleName}] ⚠️ Could not identify executor from audit logs - skipping`);
                return;
            }

            const targetInfo = actionType === 'ROLE_ASSIGN'
                ? `-> Assigned to: ${eventData.member.user.username} (${eventData.member.id})`
                : '';

            // =============================================
            // LOG TO CENTRALIZED LOG CHANNEL
            // =============================================
            const eventTypeMap = {
                'ROLE_CREATE': 'DANGEROUS_ROLE_CREATE',
                'ROLE_UPDATE': 'DANGEROUS_ROLE_UPDATE',
                'ROLE_ASSIGN': 'DANGEROUS_ROLE_UPDATE'
            };
            logManager.log(guild, eventTypeMap[actionType] || actionType, {
                target: role,
                executor,
                fields: [
                    { name: '🎭 Role', value: `${role.name} (${role.id})`, inline: true },
                    { name: '⚠️ Dangerous Permissions', value: dangerousPerms.map(p => getPermissionName(p)).join(', ') || 'N/A', inline: false },
                    targetInfo ? { name: '🎯 Assigned To', value: targetInfo, inline: true } : null
                ].filter(Boolean)
            });

            console.log(`\n[${this.moduleName}] 🚨 APA EVENT DETECTED: ${actionType}`);
            console.log(`[${this.moduleName}] 👤 Executor: ${executor.username} (${executor.id}) ${executor.bot ? '[BOT]' : '[USER]'}`);
            if (targetInfo) console.log(`[${this.moduleName}] 🎯 Target: ${targetInfo}`);
            console.log(`[${this.moduleName}] 🎭 Role: ${role.name} (${role.id})`);
            console.log(`[${this.moduleName}] ⚡ Dangerous Perms: [${dangerousPerms.map(p => getPermissionName(p)).join(', ')}]`);

            // =============================================
            // STEP 3: Check skip conditions
            // =============================================

            // Skip bot's own actions
            const isSelfBot = executor.id === this.client?.user?.id;
            if (isSelfBot) {
                console.log(`[${this.moduleName}] Skipping self-bot action`);
                return;
            }


            // =============================================
            // STEP 3: Fetch Member Early for Hierarchy Checks
            // =============================================
            const member = await guild.members.fetch(executor.id).catch(() => null);
            if (!member) {
                console.log(`[${this.moduleName}] ⚠️ Executor left server or not found`);
                return;
            }

            // =============================================
            // STEP 4: Check Trust & Hierarchy (Ignore but Notify)
            // =============================================

            // 1. Check if user is trusted/owner/whitelisted
            if (isTrusted(executor, guild, config)) {
                // Special case: If whitelisted, we still notify (as per original logic, but now cleaner)
                if (config.whitelistedUsers?.includes(executor.id)) {
                    await notifyOwner(guild, executor, actionType, role, dangerousPerms, {
                        roleNeutralized: false,
                        stripResult: { success: false, count: 0 },
                        punishmentResult: { success: false, reason: 'User is whitelisted' }
                    }, config);
                } else {
                    // For Owner/Trusted Roles: Just warn nicely
                    await notifyIgnoredAction(guild, executor, actionType, role, dangerousPerms, 'User is Owner or Trusted', config);
                }
                console.log(`[${this.moduleName}] Skipping trusted user: ${executor.username}`);
                return;
            }

            // 2. Check Hierarchy (If user > bot, we CANNOT punish/act)
            const punishCheck = canPunish(guild, member);
            if (!punishCheck.success) {
                console.log(`[${this.moduleName}] Skipping due to hierarchy/manageable check: ${punishCheck.reason}`);

                // Notify Owner/Log about this (User request: "warn about it simply in log and dms")
                await notifyIgnoredAction(guild, executor, actionType, role, dangerousPerms, `Hierarchy: ${punishCheck.reason}`, config);
                return;
            }


            // Skip self-assignment (edge case)
            if (actionType === 'ROLE_ASSIGN' && isSelfAssignment(executor, eventData)) {
                console.log(`[${this.moduleName}] Skipping self-assignment`);
                return;
            }

            // =============================================
            // STEP 5: Validate bot permissions
            // =============================================
            const permCheck = validateBotPermissions(guild);
            if (!permCheck.hasEssentialPerms) {
                console.error(`[${this.moduleName}] ❌ CRITICAL: Bot lacks essential permissions!`);
                this.metrics.permissionFailures++;

                if (config.notifyOwner && config.notifyOnPermissionFailure) {
                    await notifyPermissionFailure(guild, executor, actionType, role, dangerousPerms, permCheck, config);
                }
                return;
            }

            // =============================================
            // STEP 6: NEUTRALIZATION (ROLE_CREATE/UPDATE only!)
            //For ROLE_ASSIGN: We DON'T touch the pre-existing role!
            // =============================================
            let roleNeutralized = false;
            let neutralizeResult = { success: true };

            if (actionType === 'ROLE_CREATE' || actionType === 'ROLE_UPDATE') {
                neutralizeResult = await neutralizeRole(role, dangerousPerms);
                roleNeutralized = neutralizeResult.success;

                if (roleNeutralized) {
                    this.metrics.rolesNeutralized++;
                } else {
                    console.error(`[${this.moduleName}] ❌ FAILED to neutralize role`);
                    this.metrics.permissionFailures++;

                    if (config.notifyOwner && config.notifyOnPermissionFailure) {
                        await notifyPermissionFailure(guild, executor, actionType, role, dangerousPerms, permCheck, config);
                    }
                    // Continue to punishment even if neutralization failed
                }
            } else if (actionType === 'ROLE_ASSIGN') {
                // For ROLE_ASSIGN: We DON'T neutralize the role!
                // The role is pre-existing and legitimate.
                // We only punish the untrusted user who assigned it.
                console.log(`[${this.moduleName}] ℹ️ ROLE_ASSIGN - Not neutralizing pre-existing role, only punishing assigner`);
            }

            // =============================================
            // STEP 7: Check duplicate punishment
            // =============================================
            const isDuplicate = this.isAlreadyPunished(guildId, executor.id);
            if (isDuplicate) {
                this.metrics.duplicatesPrevented++;
                console.log(`[${this.moduleName}] User ${executor.username} already punished recently, skipping`);
                return;
            }

            // =============================================
            // STEP 8: Fetch member and punish executor
            // =============================================
            // Note: Member was already fetched in Step 3!

            let stripResult = { success: false, count: 0 };
            let punishmentResult = { success: false, reason: 'Member not found' };

            if (member) {
                // Strip dangerous roles from executor
                if (config.stripExecutorRoles) {
                    stripResult = await stripDangerousRoles(guild, executor, member);
                    if (stripResult.success && stripResult.count > 0) {
                        this.metrics.punishmentsExecuted++;
                    }
                }

                // Execute configured punishment (timeout/kick/ban)
                punishmentResult = await executePunishment(member, guild, config);
                if (punishmentResult.success) {
                    this.metrics.punishmentsExecuted++;
                }
            }

            // Mark as punished
            this.markAsPunished(guildId, executor.id);

            // =============================================
            // STEP 9: Notify owner and log
            // =============================================
            const results = {
                roleNeutralized,
                stripResult,
                punishmentResult
            };

            // Unified notification + logging (Simultaneous Button Updates)
            await notifyAndLog(guild, executor, actionType, role, dangerousPerms, results, config);

            console.log(`[${this.moduleName}] ✅ Event processed successfully`);

        } catch (error) {
            console.error(`[${this.moduleName}] ❌ Error processing ${actionType}:`, error.message);
        }
    }

    // ==========================================
    // DUPLICATE PUNISHMENT PREVENTION
    // ==========================================

    isAlreadyPunished(guildId, userId) {
        if (!this.punishedUsers.has(guildId)) {
            return false;
        }
        const guildPunished = this.punishedUsers.get(guildId);
        return guildPunished.has(userId);
    }

    markAsPunished(guildId, userId) {
        if (!this.punishedUsers.has(guildId)) {
            this.punishedUsers.set(guildId, new Map());
        }
        const guildPunished = this.punishedUsers.get(guildId);
        guildPunished.set(userId, Date.now());
    }

    cleanupPunishedUsers() {
        const now = Date.now();

        this.punishedUsers.forEach((guildPunished, guildId) => {
            const config = this.getConfig(guildId);
            const cooldownMs = (config.punishmentCooldown || 300) * 1000;

            guildPunished.forEach((timestamp, userId) => {
                if (now - timestamp > cooldownMs) {
                    guildPunished.delete(userId);
                }
            });

            if (guildPunished.size === 0) {
                this.punishedUsers.delete(guildId);
            }
        });
    }

    // ==========================================
    // STATUS & CLEANUP
    // ==========================================

    getStatus(guildId) {
        const config = this.getConfig(guildId);
        const punishedCount = this.punishedUsers.get(guildId)?.size || 0;

        return {
            moduleName: this.moduleName,
            enabled: config.enabled,
            config,
            stats: {
                currentlyPunishedUsers: punishedCount,
                punishmentCooldownSeconds: config.punishmentCooldown
            },
            metrics: this.metrics,
            dangerousPermissions: DANGEROUS_PERMISSIONS.map(p => getPermissionName(p)),
            isConnectedToMongoDB: this.collection !== null,
            hasDiscordClient: this.client !== null
        };
    }

    async shutdown() {
        console.log(`[${this.moduleName}] 🛑 Shutting down...`);

        if (this.syncInterval) clearInterval(this.syncInterval);
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);

        await db.close();
    }
}

module.exports = AntiPermissionAbuse;
