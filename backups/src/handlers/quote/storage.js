const fs = require('fs');
const path = require('path');

const QUOTES_FILE = path.join(__dirname, '../../data/quotes.json');
const EXPIRY_TIME = 3 * 24 * 60 * 60 * 1000; // 3 days in ms

/**
 * Load quotes from JSON
 */
function loadQuotes() {
    try {
        if (!fs.existsSync(QUOTES_FILE)) {
            const dir = path.dirname(QUOTES_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(QUOTES_FILE, '{}');
            return {};
        }
        const data = fs.readFileSync(QUOTES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Failed to load quotes:', error);
        return {};
    }
}

/**
 * Save quotes to JSON
 */
function saveQuotes(quotes) {
    try {
        fs.writeFileSync(QUOTES_FILE, JSON.stringify(quotes, null, 2));
    } catch (error) {
        console.error('Failed to save quotes:', error);
    }
}

/**
 * Store a new quote
 */
function storeQuote(messageId, data) {
    const quotes = loadQuotes();
    quotes[messageId] = {
        ...data,
        createdAt: Date.now(),
        expiresAt: Date.now() + EXPIRY_TIME
    };
    saveQuotes(quotes);
}

/**
 * Get quote by message ID
 */
function getQuote(messageId) {
    const quotes = loadQuotes();
    return quotes[messageId];
}

/**
 * Remove a quote
 */
function removeQuote(messageId) {
    const quotes = loadQuotes();
    delete quotes[messageId];
    saveQuotes(quotes);
}

/**
 * Check if quote has expired
 */
function isExpired(quote) {
    return Date.now() > quote.expiresAt;
}

/**
 * Clean up expired quotes and disable their buttons
 */
async function cleanupExpiredQuotes(client) {
    const quotes = loadQuotes();
    let cleaned = 0;

    for (const [messageId, quote] of Object.entries(quotes)) {
        if (isExpired(quote)) {
            try {
                let channel = null;
                
                // Handle DMs differently (when guildId is null)
                if (!quote.guildId) {
                    // For DMs, fetch the user and get their DM channel
                    const user = await client.users.fetch(quote.userId).catch(() => null);
                    if (user) {
                        channel = await user.createDM().catch(() => null);
                    }
                } else {
                    // For guild channels, fetch normally
                    channel = await client.channels.fetch(quote.channelId).catch(() => null);
                }

                if (channel) {
                    const message = await channel.messages.fetch(messageId).catch(() => null);
                    if (message) {
                        await message.edit({ components: [] }).catch(() => { });
                    }
                }
            } catch (error) {
                // Ignore errors
            }

            delete quotes[messageId];
            cleaned++;
        }
    }

    if (cleaned > 0) {
        saveQuotes(quotes);
        console.log(`Cleaned up ${cleaned} expired quotes`);
    }
}

module.exports = {
    storeQuote,
    getQuote,
    removeQuote,
    isExpired,
    cleanupExpiredQuotes
};
