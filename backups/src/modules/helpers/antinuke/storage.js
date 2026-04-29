/**
 * AntiNuke JSON Storage
 * Simple file-based storage for guild backups and configs
 * Easier to debug than MongoDB and persists across restarts
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data', 'antinuke');

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log(`[AntiNuke] 📁 Created data directory: ${DATA_DIR}`);
    }
}

/**
 * Get path for a guild's JSON file
 */
function getGuildFilePath(guildId) {
    return path.join(DATA_DIR, `${guildId}.json`);
}

/**
 * Load guild data from JSON file
 */
function loadGuildData(guildId) {
    ensureDataDir();
    const filePath = getGuildFilePath(guildId);

    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error(`[AntiNuke] Failed to load guild data for ${guildId}:`, err.message);
    }

    return null;
}

/**
 * Save guild data to JSON file
 */
function saveGuildData(guildId, data) {
    ensureDataDir();
    const filePath = getGuildFilePath(guildId);

    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error(`[AntiNuke] Failed to save guild data for ${guildId}:`, err.message);
        return false;
    }
}

/**
 * Save guild backup (channels + roles)
 */
function saveBackup(guildId, channels, roles) {
    const existing = loadGuildData(guildId) || {};

    const data = {
        ...existing,
        backup: {
            channels,
            roles,
            updated: Date.now()
        }
    };

    return saveGuildData(guildId, data);
}

/**
 * Save per-user strip data (roles/permissions we removed from a user)
 * Used for later restoration via buttons.
 */
function saveUserStrip(guildId, userId, stripData) {
    const existing = loadGuildData(guildId) || {};

    const userStrips = {
        ...(existing.userStrips || {}),
        [userId]: {
            ...stripData,
            updated: Date.now()
        }
    };

    const data = {
        ...existing,
        userStrips
    };

    return saveGuildData(guildId, data);
}

/**
 * Load per-user strip data (roles/permissions snapshot)
 */
function loadUserStrip(guildId, userId) {
    const data = loadGuildData(guildId);
    return data?.userStrips?.[userId] || null;
}

/**
 * Save persistent AntiNuke button metadata for a guild.
 * Buttons are stored as a map: customId -> { type, userId, createdAt, expiresAt }
 */
function saveButtons(guildId, buttons) {
    const existing = loadGuildData(guildId) || {};

    const data = {
        ...existing,
        buttons,
        buttonsUpdated: Date.now()
    };

    return saveGuildData(guildId, data);
}

/**
 * Load all AntiNuke buttons for a guild.
 */
function loadButtons(guildId) {
    const data = loadGuildData(guildId);
    return data?.buttons || {};
}

/**
 * Load all AntiNuke button definitions from disk.
 * Returns a Map<guildId, buttonsObject>
 */
function loadAllButtons() {
    ensureDataDir();
    const buttonsMap = new Map();

    try {
        const files = fs.readdirSync(DATA_DIR);

        for (const file of files) {
            if (!file.endsWith('.json')) continue;

            const guildId = file.replace('.json', '');
            const data = loadGuildData(guildId);

            if (data?.buttons && Object.keys(data.buttons).length > 0) {
                buttonsMap.set(guildId, data.buttons);
            }
        }

        console.log(`[AntiNuke] 📂 Loaded button metadata for ${buttonsMap.size} guilds from files`);
    } catch (err) {
        console.error('[AntiNuke] Failed to load button metadata from files:', err.message);
    }

    return buttonsMap;
}

/**
 * Load guild backup
 */
function loadBackup(guildId) {
    const data = loadGuildData(guildId);
    return data?.backup || null;
}

/**
 * Save guild config
 */
function saveConfig(guildId, config) {
    const existing = loadGuildData(guildId) || {};

    const data = {
        ...existing,
        config,
        configUpdated: Date.now()
    };

    return saveGuildData(guildId, data);
}

/**
 * Load guild config
 */
function loadConfig(guildId) {
    const data = loadGuildData(guildId);
    return data?.config || null;
}

/**
 * Load all guild configs from files
 */
function loadAllConfigs() {
    ensureDataDir();
    const configs = new Map();

    try {
        const files = fs.readdirSync(DATA_DIR);

        for (const file of files) {
            if (!file.endsWith('.json')) continue;

            const guildId = file.replace('.json', '');
            const data = loadGuildData(guildId);

            if (data?.config) {
                configs.set(guildId, data.config);
            }
        }

        console.log(`[AntiNuke] 📂 Loaded ${configs.size} guild configs from files`);
    } catch (err) {
        console.error('[AntiNuke] Failed to load configs from files:', err.message);
    }

    return configs;
}

/**
 * Load all guild backups from files
 */
function loadAllBackups() {
    ensureDataDir();
    const backups = new Map();

    try {
        const files = fs.readdirSync(DATA_DIR);

        for (const file of files) {
            if (!file.endsWith('.json')) continue;

            const guildId = file.replace('.json', '');
            const data = loadGuildData(guildId);

            if (data?.backup) {
                backups.set(guildId, data.backup);
            }
        }

        console.log(`[AntiNuke] 📂 Loaded ${backups.size} guild backups from files`);
    } catch (err) {
        console.error('[AntiNuke] Failed to load backups from files:', err.message);
    }

    return backups;
}

module.exports = {
    ensureDataDir,
    loadGuildData,
    saveGuildData,
    saveBackup,
    loadBackup,
    saveConfig,
    loadConfig,
    loadAllConfigs,
    loadAllBackups,
    // New helpers for per-user strip data + button persistence
    saveUserStrip,
    loadUserStrip,
    saveButtons,
    loadButtons,
    loadAllButtons,
    DATA_DIR
};
