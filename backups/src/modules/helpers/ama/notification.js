const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');
const logManager = require('../logManager');
const { registerAndPersist } = require('./buttons'); // Persistent buttons

/**
 * Helper: Create violation embed
 */
function createViolationEmbed(guild, violator, violationData, actionsPerformed, config) {
    const isBot = violationData.isBot || false; // Or check violator.user.bot
    // Ensure isBot is accurate
    const botDetected = isBot || violator.user.bot;

    const violationType = violationData.kickThresholdExceeded ? 'Mass Kicks' : 'Mass Bans';
    const actionCount = violationData.kickThresholdExceeded ? violationData.kickCount : violationData.banCount;

    const threshold = violationData.kickThresholdExceeded
        ? (botDetected ? (config.botKickThreshold || 2) : config.kickThreshold)
        : (botDetected ? (config.botBanThreshold || 2) : config.banThreshold);

    return {
        title: `<:mod:1437818267489013960> [AMA] Mass Action Prevention System triggered ${botDetected ? '(BOT DETECTED)' : ''}`,
        description: `A ${botDetected ? '**compromised bot**' : 'user'} in "**${guild.name}**" has exceeded the ${violationType} threshold.`,
        color: botDetected ? 0xFF0000 : 0xff6600, // Red for bots, orange for users
        fields: [
            {
                name: '<a:e:1333357974751678524> Violator',
                value: [
                    `**${botDetected ? 'Bot' : 'User'}:** ${violator.user.username} ${botDetected ? '🤖' : ''} (${violator.user.id})`,
                    `**Mention:** <@${violator.user.id}>`,
                    `**Account Age:** ${Math.floor((Date.now() - violator.user.createdTimestamp) / (1000 * 60 * 60 * 24))} days`
                ].join('\n'),
                inline: true
            },
            {
                name: '<a:warn_1327982612634931251:1342442972469395478> Violation Details',
                value: [
                    `**Action Type:** ${violationType}`,
                    `**Count:** ${actionCount}/${threshold} ${botDetected ? '(bot threshold)' : '(user threshold)'}`,
                    `**Time Window:** ${config.timeWindow}s`,
                    `**Last Target:** ${violationData.targetUser.username}`
                ].join('\n'),
                inline: true
            },
            {
                name: '<a:check:1422449088351178804> Actions Taken',
                value: actionsPerformed.length > 0 ? actionsPerformed.join('\n') : 'None',
                inline: false
            }
        ],
        timestamp: new Date(),
        footer: { text: `Anti-Raid System Active | Guild:"${guild.name} | /dashboard to change settings"` }
    };
}

/**
 * Helper: Create buttons
 */
function createComponents(violator) {
    // Deterministic ID for persistence
    const customId = `ama_whitelist_${violator.id}`;

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel('Whitelist This User')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:police:1333357876822933514>')
        );
    return [row];
}

/**
 * Notify server owner about violation
 */
/**
 * Unified Notification: Notify Owner + Log to Channel + Persist Buttons
 */
async function notifyAndLog(guild, violator, violationData, actionsPerformed, config) {
    const moduleName = 'mass-action-protection';
    try {
        const embed = createViolationEmbed(guild, violator, violationData, actionsPerformed, config);
        const components = createComponents(violator);
        const relatedMessages = [];

        // 1. Notify Owner
        if (config.notifyOwner) {
            try {
                const owner = await guild.fetchOwner();
                if (owner) {
                    const sentMessage = await owner.send({ embeds: [embed], components });
                    if (sentMessage) {
                        relatedMessages.push({ channelId: sentMessage.channel.id, messageId: sentMessage.id });
                        console.log(`[${moduleName}] 📧 Owner notified`);
                    }
                }
            } catch (error) {
                console.error(`[${moduleName}] Failed to notify owner:`, error.message);
            }
        }

        // 2. Log to Channel
        if (config.logActions) {
            try {
                // Use LogManager to send to alert channel
                const alertMsg = await logManager.logAlert(guild, { embed, components });
                if (alertMsg) {
                    relatedMessages.push({ channelId: alertMsg.channel.id, messageId: alertMsg.id });
                    console.log(`[${moduleName}] Logged alert to aero-alerts`);
                }
            } catch (error) {
                console.error(`[${moduleName}] Failed to log violation:`, error.message);
            }
        }

        // 3. Register Buttons with Linked Messages
        if (relatedMessages.length > 0) {
            const customId = `ama_whitelist_${violator.id}`;
            await registerAndPersist(guild.id, customId, {
                type: 'whitelist_user',
                targetId: violator.id,
                guildId: guild.id,
                relatedMessages // Attach list for simultaneous updates
            });
            console.log(`[${moduleName}] Registered persistent buttons with ${relatedMessages.length} linked messages`);
        }

    } catch (error) {
        console.error(`[${moduleName}] NotifyAndLog failed:`, error.message);
    }
}

module.exports = {
    notifyAndLog,
    createViolationEmbed
};
