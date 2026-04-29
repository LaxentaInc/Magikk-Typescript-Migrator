const { PermissionFlagsBits } = require('discord.js');
const antiSpam = require('../../../modules/AntiSpam');

module.exports = {
    name: 'warn',
    description: 'Warn a user and add a strike to their AntiSpam record',
    args: true,
    usage: '<user> <reason>',
    aliases: ['warning', 'strike'],
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply('You do not have permission to use this command.');
        }

        if (args.length < 2) {
            return message.reply('Usage: !warn <user> <reason>');
        }

        const targetArg = args[0];
        const reason = args.slice(1).join(' ');

        // Extract ID from mention or use raw ID
        let targetId = targetArg.replace(/[<@!>]/g, '');

        const targetMember = await message.guild.members.fetch(targetId).catch(() => null);

        if (!targetMember) {
            return message.reply('User not found in this server.');
        }

        if (targetMember.id === message.author.id) {
            return message.reply('You cannot warn yourself.');
        }

        if (targetMember.user.bot) {
            return message.reply('You cannot warn bots using this system.');
        }

        if (targetMember.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('You cannot warn an administrator.');
        }

        // Check if bot can punish
        if (targetMember.roles.highest.position >= message.guild.members.me.roles.highest.position) {
            return message.reply('I cannot warn this user because my role is below or equal to theirs.');
        }

        // Check hierarchy
        if (targetMember.roles.highest.position >= message.member.roles.highest.position && message.author.id !== message.guild.ownerId) {
            return message.reply('You cannot warn someone with a higher or equal role.');
        }

        try {
            const result = await antiSpam.addManualStrike(message, targetMember, reason);

            if (!result) {
                return message.reply('Failed to add strike. User might be trusted/bypassed.');
            }

            if (result.success === false) {
                return message.reply(`Failed: ${result.reason}`);
            }

            const embed = {
                title: result.action === 'punished'
                    ? `<:mod:1422451081224392816> **${targetMember.user.tag}** Punished`
                    : `<:mod:1422451081224392816> **${targetMember.user.tag}** Warned`,
                description: `**User:** <@${targetMember.user.id}>\n**Reason:** ${reason}\n**Strikes:** ${result.strikes}/${result.maxStrikes}`,
                color: result.action === 'punished' ? 0xFF0000 : 0xFFA500,
                footer: { text: result.action === 'punished' ? 'Maximum Strike Threshold reached | Action taken.' : 'Strike added | AntiSpam System' }
            };

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await message.reply('An error occurred while processing the warning.');
        }
    }
};
