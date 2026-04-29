const { logger } = require('../utils/logger');
const AccountAgeProtectionModule = require('../modules/ageVerify');
const botProtection = require('../modules/bot-protection');
const { AuditLogEvent } = require('discord.js');

module.exports = {
    name: 'guildMemberAdd',
    once: false,
    async execute(member, client) {
        if (!member?.user || !member?.guild) return;

        const accountAge = Date.now() - member.user.createdTimestamp;
        const accountAgeDays = Math.floor(accountAge / (1000 * 60 * 60 * 24));

        logger.info('👤 [MemberJoin] New member joined', {
            username: member.user.username,
            userId: member.user.id,
            guildName: member.guild.name,
            accountAgeDays: accountAgeDays,
            isBot: member.user.bot
        });

        try {
            // Route to appropriate protection module
            if (member.user.bot) {
                // Handle BOT joins - Bot Protection Module
                console.log(`🤖 [guildMemberAdd] Bot joined: ${member.user.username}`);

                // Try to find who invited the bot
                let inviter = null;
                try {
                    const auditLogs = await member.guild.fetchAuditLogs({
                        type: AuditLogEvent.BotAdd,
                        limit: 10
                    });

                    const inviteLog = auditLogs.entries.find(entry =>
                        entry.target?.id === member.user.id &&
                        Date.now() - entry.createdTimestamp < 15000 // 15 seconds
                    );

                    if (inviteLog) {
                        inviter = inviteLog.executor;
                        console.log(`🔍 [guildMemberAdd] Bot ${member.user.username} invited by ${inviter.username}`);
                    }
                } catch (auditError) {
                    logger.warn(`[guildMemberAdd] Could not fetch audit logs:`, auditError.message);
                }

                // Feed to bot protection module
                if (typeof botProtection.handleBotJoin === 'function') {
                    await botProtection.handleBotJoin(member, inviter);
                }
            } else {
                // Handle HUMAN joins - Age Verification Module
                console.log(`👤 [guildMemberAdd] User joined: ${member.user.username} (${accountAgeDays} days old)`);

                if (typeof AccountAgeProtectionModule.handleMemberJoin === 'function') {
                    await AccountAgeProtectionModule.handleMemberJoin(member);
                }
            }
        } catch (error) {
            console.error('💥 [guildMemberAdd] Error:', error.message);
            logger.error('guildMemberAdd error:', {
                error: error.message,
                username: member?.user?.username,
                guildId: member?.guild?.id
            });
        }
    }
};