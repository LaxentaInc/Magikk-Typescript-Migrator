const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const antiSpam = require('../../../modules/AntiSpam');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a user and add a strike to their AntiSpam record')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to warn')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the warning')
                .setRequired(true)),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.reply({
                content: 'User not found in this server.',
                ephemeral: true
            });
        }

        if (targetMember.id === interaction.user.id) {
            return interaction.reply({
                content: 'You cannot warn yourself.',
                ephemeral: true
            });
        }

        if (targetMember.user.bot) {
            return interaction.reply({
                content: 'You cannot warn bots using this system.',
                ephemeral: true
            });
        }

        if (targetMember.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: 'You cannot warn an administrator.',
                ephemeral: true
            });
        }

        // Check if bot can punish
        if (targetMember.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
            return interaction.reply({
                content: 'I cannot warn this user because my role is below or equal to theirs.',
                ephemeral: true
            });
        }

        // Check hierarchy
        if (targetMember.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: 'You cannot warn someone with a higher or equal role.',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const result = await antiSpam.addManualStrike(interaction, targetMember, reason);

            if (!result) {
                return interaction.editReply('Failed to add strike. User might be trusted/bypassed.');
            }

            if (result.success === false) {
                return interaction.editReply(`Failed: ${result.reason}`);
            }

            const embed = {
                title: result.action === 'punished'
                    ? `<:mod:1422451081224392816> **${targetUser.tag}** Punished`
                    : `<:mod:1422451081224392816> **${targetUser.tag}** Warned`,
                description: `**User:** <@${targetUser.id}>\n**Reason:** ${reason}\n**Strikes:** ${result.strikes}/${result.maxStrikes}`,
                color: result.action === 'punished' ? 0xFF0000 : 0xFFA500,
                footer: { text: result.action === 'punished' ? 'Maximum Strike Threshold reached | Action taken' : 'Strike added | AntiSpam Moderation' }
            };

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await interaction.editReply('Punishment Executed on Max Strikes :D');
        }
    }
};
