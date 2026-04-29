/**
 * AntiNuke Restoration
 * Batch channel and role restoration, and backup management
 * Uses JSON file storage for persistence
 */

const { saveBackup, loadBackup, loadAllBackups } = require('./storage');

/**
 * Batch restore all deleted channels and roles
 * Categories are restored FIRST so children can be parented correctly
 */
async function batchRestoreChannels(guild, deletedChannels, deletedRoles, backups) {
    const deletedCh = deletedChannels.get(guild.id) || [];
    const deletedR = deletedRoles.get(guild.id) || [];

    if (deletedCh.length === 0 && deletedR.length === 0) {
        console.log(`[AntiNuke] ℹ️ No deletions to restore for ${guild.name}`);
        return { restored: 0 };
    }

    // Try memory backup first, then file backup
    let backup = backups.get(guild.id);
    if (!backup) {
        console.log(`[AntiNuke] 📂 Loading backup from file for ${guild.name}...`);
        backup = loadBackup(guild.id);
    }

    if (!backup) {
        console.log(`[AntiNuke] ⚠️ No backup found for batch restoration of ${guild.name}`);
        return { restored: 0, error: 'No backup' };
    }

    let restoredCount = 0;

    // ========================================
    // RESTORE ROLES FIRST (channels may depend on role permissions)
    // ========================================
    if (deletedR.length > 0) {
        console.log(`[AntiNuke] 🔄 Batch restoring ${deletedR.length} roles...`);

        // Get full role data from backup
        const rolesToRestore = deletedR
            .map(d => backup.roles.find(b => b.id === d.id))
            .filter(Boolean);

        // Sort by position (lower positions first)
        rolesToRestore.sort((a, b) => a.position - b.position);

        for (const role of rolesToRestore) {
            try {
                await guild.roles.create({
                    name: role.name,
                    color: role.color,
                    permissions: role.permissions,
                    hoist: role.hoist,
                    mentionable: role.mentionable,
                    reason: 'AntiNuke Batch Restoration'
                });
                restoredCount++;
                console.log(`[AntiNuke] ✅ Restored role: ${role.name}`);
            } catch (e) {
                console.error(`[AntiNuke] ❌ Failed to restore role ${role.name}:`, e.message);
            }
        }
    }

    // ========================================
    // RESTORE CHANNELS
    // ========================================
    if (deletedCh.length > 0) {
        console.log(`[AntiNuke] 🔄 Batch restoring ${deletedCh.length} channels...`);

        // Get full channel data from backup
        const channelsToRestore = deletedCh
            .map(d => backup.channels.find(b => b.id === d.id))
            .filter(Boolean);

        if (channelsToRestore.length === 0) {
            console.log(`[AntiNuke] ⚠️ No matching channels found in backup (${deletedCh.length} deleted, ${backup.channels.length} in backup)`);
        }

        // Separate: Categories FIRST, then others
        const categories = channelsToRestore
            .filter(c => c.type === 4)
            .sort((a, b) => a.position - b.position);

        const others = channelsToRestore
            .filter(c => c.type !== 4)
            .sort((a, b) => a.position - b.position);

        // Map: OldID -> NewID for parenting
        const idMap = new Map();

        // 1. Restore Categories FIRST
        for (const cat of categories) {
            try {
                const newChannel = await guild.channels.create({
                    name: cat.name,
                    type: 4, // GuildCategory
                    position: cat.position,
                    reason: 'AntiNuke Batch Restoration'
                });
                idMap.set(cat.id, newChannel.id);
                restoredCount++;
                console.log(`[AntiNuke] ✅ Restored category: ${cat.name}`);
            } catch (e) {
                console.error(`[AntiNuke] ❌ Failed to restore category ${cat.name}:`, e.message);
            }
        }

        // 2. Restore Other Channels
        for (const ch of others) {
            try {
                const options = {
                    name: ch.name,
                    type: ch.type,
                    reason: 'AntiNuke Batch Restoration'
                };

                // Find parent
                if (ch.parentId) {
                    if (idMap.has(ch.parentId)) {
                        // Use newly restored category
                        options.parent = idMap.get(ch.parentId);
                    } else if (guild.channels.cache.has(ch.parentId)) {
                        // Parent wasn't deleted
                        options.parent = ch.parentId;
                    }
                }

                if (ch.position !== undefined) {
                    options.position = ch.position;
                }

                await guild.channels.create(options);
                restoredCount++;
                console.log(`[AntiNuke] ✅ Restored channel: ${ch.name}`);
            } catch (e) {
                console.error(`[AntiNuke] ❌ Failed to restore channel ${ch.name}:`, e.message);
            }
        }
    }

    // Clear queues
    deletedChannels.set(guild.id, []);
    deletedRoles.set(guild.id, []);

    console.log(`[AntiNuke] ✅ Batch restoration complete: ${restoredCount} items restored`);

    return { restored: restoredCount };
}

/**
 * Backup a guild's channels and roles
 * Saves to both memory cache AND JSON file
 */
async function backupGuild(guild, backups) {
    try {
        // Backup ALL channels including categories (up to 200)
        const channels = guild.channels.cache
            .map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                position: c.position,
                parentId: c.parentId || null
            }))
            .slice(0, 200);

        // Backup roles (up to 100, exclude managed and @everyone)
        const roles = guild.roles.cache
            .filter(r => !r.managed && r.id !== guild.id)
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.color,
                permissions: r.permissions.bitfield.toString(), // Store as string to avoid precision issues
                position: r.position,
                hoist: r.hoist,
                mentionable: r.mentionable
            }))
            .slice(0, 100);

        const backupData = {
            channels,
            roles,
            updated: Date.now()
        };

        // Save to memory
        backups.set(guild.id, backupData);

        // Save to file for persistence
        saveBackup(guild.id, channels, roles);

        return { channels: channels.length, roles: roles.length };

    } catch (err) {
        console.error('[AntiNuke] Backup failed:', err.message);
        return { error: err.message };
    }
}

/**
 * Backup all guilds the bot is in
 */
async function backupAllGuilds(client, backups, getConfig) {
    if (!client) return;

    // First, load any existing backups from files
    const fileBackups = loadAllBackups();
    for (const [guildId, backup] of fileBackups) {
        if (!backups.has(guildId)) {
            backups.set(guildId, backup);
        }
    }

    let count = 0;
    for (const guild of client.guilds.cache.values()) {
        const config = getConfig(guild.id);
        if (config.enabled && config.tryRestore) {
            await backupGuild(guild, backups);
            count++;
        }
    }

    console.log(`[AntiNuke] 💾 Backed up ${count} guilds to memory and files`);
    return count;
}

module.exports = {
    batchRestoreChannels,
    backupGuild,
    backupAllGuilds
};
