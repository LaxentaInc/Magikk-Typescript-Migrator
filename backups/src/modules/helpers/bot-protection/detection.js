/**
 * Bot Suspicion Detection Logic
 * Analyzes bots to determine if they are suspicious
 */

/**
 * Analyze if a bot is suspicious
 */
async function analyzeBotSuspicion(botData, config) {
    const reasons = [];
    let suspicionLevel = 0;

    // Check bot age (in hours to match frontend)
    const minAge = config.minAccountAge || 168; // Fallback to 7 days if not set
    if (botData.botAgeHours < minAge) {
        reasons.push(`Bot too young (${Math.round(botData.botAgeHours)}h < ${minAge}h required)`);
        suspicionLevel += 3;
    }

    // Check verification status
    if (config.checkUnverified && !botData.isVerified) {
        reasons.push('Bot is not verified by Discord');
        suspicionLevel += 2;
    }

    // Check if bot has avatar
    if (!botData.hasAvatar) {
        reasons.push('Bot has no custom avatar');
        suspicionLevel += 1;
    }

    // Additional checks can be added here:
    // - Check bot permissions
    // - Check if bot is in multiple servers
    // - Check bot's application info

    return {
        suspicious: suspicionLevel >= 2, // Threshold for taking action
        suspicionLevel,
        reasons,
        analysis: {
            botAgeHours: Math.round(botData.botAgeHours),
            isVerified: botData.isVerified,
            hasAvatar: botData.hasAvatar
        }
    };
}

module.exports = {
    analyzeBotSuspicion
};
