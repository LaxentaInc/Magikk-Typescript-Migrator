/**
 * APA (Anti-Permission Abuse) JSON Storage
 * File-based storage for button persistence, user strips, and role neutralization
 * Persists across restarts
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data', 'apa');

// Button expiry: 24 hours (longer than antinuke's 8h for convenience)
const BUTTON_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log(`[APA] 📁 Created data directory: ${DATA_DIR}`);
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
        console.error(`[APA] Failed to load guild data for ${guildId}:`, err.message);
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
        console.error(`[APA] Failed to save guild data for ${guildId}:`, err.message);
        return false;
    }
}

// ==========================================
// USER STRIP DATA (for "Restore User Roles" button)
// ==========================================

/**
 * Save per-user strip data (roles we removed from a user)
 * Used for later restoration via buttons.
 */
function saveUserStrip(guildId, userId, stripData) {
    const existing = loadGuildData(guildId) || {};

    const userStrips = {
        ...(existing.userStrips || {}),
        [userId]: {
            ...stripData,
            timestamp: Date.now()
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
 * Clear user strip data after restoration
 */
function clearUserStrip(guildId, userId) {
    const existing = loadGuildData(guildId);
    if (!existing?.userStrips?.[userId]) return false;

    delete existing.userStrips[userId];
    return saveGuildData(guildId, existing);
}

// ==========================================
// ROLE NEUTRALIZATION DATA (for "Restore Role Perms" button)
// ==========================================

/**
 * Save role neutralization data (original perms we removed)
 */
function saveRoleNeutralization(guildId, roleId, neutralizationData) {
    console.log(`[APA-DEBUG] Saving neutralization for Role ${roleId} in Guild ${guildId}`);
    const existing = loadGuildData(guildId) || {};

    const roleNeutralizations = {
        ...(existing.roleNeutralizations || {}),
        [roleId]: {
            ...neutralizationData,
            timestamp: Date.now()
        }
    };

    const data = {
        ...existing,
        roleNeutralizations
    };

    const result = saveGuildData(guildId, data);
    console.log(`[APA-DEBUG] Save result for ${roleId}: ${result}`);
    return result;
}

/**
 * Load role neutralization data
 */
function loadRoleNeutralization(guildId, roleId) {
    console.log(`[APA-DEBUG] Loading neutralization for Role ${roleId} in Guild ${guildId}`);
    const data = loadGuildData(guildId);

    if (!data) {
        console.log(`[APA-DEBUG] ❌ No guild data found for ${guildId}`);
        return null;
    }

    if (!data.roleNeutralizations) {
        console.log(`[APA-DEBUG] ❌ No roleNeutralizations object for ${guildId}`);
        return null;
    }

    const result = data.roleNeutralizations[roleId] || null;
    console.log(`[APA-DEBUG] Found data for ${roleId}:`, result ? 'YES' : 'NO');
    return result;
}

/**
 * Clear role neutralization data after restoration
 */
function clearRoleNeutralization(guildId, roleId) {
    const existing = loadGuildData(guildId);
    if (!existing?.roleNeutralizations?.[roleId]) return false;

    delete existing.roleNeutralizations[roleId];
    return saveGuildData(guildId, existing);
}

// ==========================================
// BUTTON PERSISTENCE (survive restarts)
// ==========================================

/**
 * Save persistent APA button metadata for a guild.
 * Buttons are stored as a map: customId -> { type, userId, roleId, createdAt, expiresAt }
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
 * Load all APA buttons for a guild.
 */
function loadButtons(guildId) {
    const data = loadGuildData(guildId);
    return data?.buttons || {};
}

/**
 * Load all APA button definitions from disk (for startup restoration).
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
                // Filter out expired buttons
                const now = Date.now();
                const validButtons = {};
                for (const [customId, meta] of Object.entries(data.buttons)) {
                    if (!meta.expiresAt || meta.expiresAt > now) {
                        validButtons[customId] = meta;
                    }
                }
                if (Object.keys(validButtons).length > 0) {
                    buttonsMap.set(guildId, validButtons);
                }
            }
        }

        console.log(`[APA] 📂 Loaded button metadata for ${buttonsMap.size} guilds from files`);
    } catch (err) {
        console.error('[APA] Failed to load button metadata from files:', err.message);
    }

    return buttonsMap;
}

/**
 * Add buttons to existing guild buttons
 */
function persistButtons(guildId, buttonMetas) {
    const existing = loadButtons(guildId);
    const now = Date.now();

    const merged = { ...existing };

    for (const { customId, type, userId, roleId, guildId: metaGuildId, ownerId } of buttonMetas) {
        merged[customId] = {
            type,
            userId: userId || null,
            roleId: roleId || null,
            guildId: metaGuildId || guildId,
            ownerId: ownerId || null,
            createdAt: now,
            expiresAt: now + BUTTON_EXPIRY_MS
        };
    }

    saveButtons(guildId, merged);
}

// ==========================================
// CONFIG PERSISTENCE
// Config is strictly handled by MongoDB in index.js
// Local storage is ONLY for:
// 1. User strip data (restoration)
// 2. Role neutralization data (restoration)
// 3. Button metadata (persistence)
// ==========================================

module.exports = {
    ensureDataDir,
    loadGuildData,
    saveGuildData,
    // User strip
    saveUserStrip,
    loadUserStrip,
    clearUserStrip,
    // Role neutralization
    saveRoleNeutralization,
    loadRoleNeutralization,
    clearRoleNeutralization,
    // Buttons
    saveButtons,
    loadButtons,
    loadAllButtons,
    persistButtons,
    // Constants
    DATA_DIR,
    BUTTON_EXPIRY_MS
};
