const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('Remove timeout from a member.')
        .setContexts(0) // Guild only
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The member to remove timeout from.')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for removing the timeout.')
                .setRequired(false)
        ),

    async execute(interaction) {
        // Check permissions
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const target = interaction.options.getUser('target');
        const member = await interaction.guild.members.fetch(target.id);
        const reason = interaction.options.getString('reason') || 'No reason provided';

        // Prevent actions on the server owner
        if (member.id === interaction.guild.ownerId) {
            return interaction.reply({ content: 'I cannot moderate the server owner.', ephemeral: true });
        }

        // Check role hierarchy
        if (member.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
            return interaction.reply({ content: 'I cannot moderate this user because their role is equal to or higher than mine.', ephemeral: true });
        }

        // Check if member is actually timed out
        if (!member.communicationDisabledUntil || member.communicationDisabledUntil < Date.now()) {
            return interaction.reply({ content: `**${member.user.tag}** is not currently timed out.`, ephemeral: true });
        }

        try {
            await member.timeout(null, reason);

            const embed = new EmbedBuilder()
                .setTitle("Timeout Removed")
                .setDescription(`**${member.user.tag}** has been unmuted.`)
                .addFields(
                    { name: "Reason <:r:1326464001793855531>", value: reason, inline: true },
                    { name: "Moderator", value: interaction.user.tag, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: "Moderation Action", iconURL: interaction.guild.iconURL() });

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error executing untimeout command:', error);
            return interaction.reply({ content: 'There was an error removing the timeout. Please try again.', ephemeral: true });
        }
    },
};
