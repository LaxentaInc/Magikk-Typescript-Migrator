const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, MessageFlags } = require("discord.js");

function parseDuration(duration) {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderation command: Timeout or mute a member.')
    .setContexts(0, 1) // 0 = Guild, 1 = User, 2 = DM (Excluded)
    .addSubcommand(subcommand =>
      subcommand
        .setName('timeout')
        .setDescription('Temporarily timeout a member.')
        .addUserOption(option =>
          option.setName('target')
            .setDescription('The member to timeout.')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('duration')
            .setDescription('Duration (e.g., 10s, 1m, 1h, 1d).')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for the timeout.')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('mute')
        .setDescription('Mute a member by assigning the Muted role.')
        .addUserOption(option =>
          option.setName('target')
            .setDescription('The member to mute.')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('duration')
            .setDescription('Duration (e.g., 10s, 1m, 1h, 1d).')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for the mute.')
            .setRequired(false)
        )
    ),
  async execute(interaction) {
    // Check permissions (require ModerateMembers)
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('target');
    const member = await interaction.guild.members.fetch(target.id);
    const durationInput = interaction.options.getString('duration');
    const durationMs = parseDuration(durationInput);
    if (!durationMs || durationMs > 25 * 24 * 60 * 60 * 1000) {
      return interaction.reply({ content: 'Specify a valid duration up to 25 days (e.g., 10s, 1m, 1h, 1d).', ephemeral: true });
    }
    const reason = interaction.options.getString('reason') || 'No reason provided';

    // Prevent actions on the server owner.
    if (member.id === interaction.guild.ownerId) {
      return interaction.reply({ content: 'I cannot moderate the server owner.', ephemeral: true });
    }

    // Check if target is Administrator (cannot be timed out)
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'I cannot timeout a member with Administrator permissions.', ephemeral: true });
    }

    // Check role hierarchy: the bot's highest role must be higher than the target's.
    if (member.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
      return interaction.reply({ content: 'I cannot moderate this user because their role is equal to or higher than mine.', ephemeral: true });
    }

    if (sub === 'timeout') {
      try {
        await member.timeout(durationMs, reason);
        const timeoutEndDate = new Date(Date.now() + durationMs);
        const embed = new EmbedBuilder()
          .setColor("#ff0000")
          .setTitle("Timeout Issued")
          .setDescription(`**${member.user.tag}** has been timed out.`)
          .addFields(
            { name: "Duration <a:w:1326464173361856524>", value: durationInput, inline: true },
            { name: "Reason <:r:1326464001793855531>", value: reason, inline: true },
            { name: "Ends At <a:Warning:1326464273467179130>", value: `<t:${Math.floor(timeoutEndDate.getTime() / 1000)}:F>`, inline: true }
          )
          .setTimestamp()
          .setFooter({ text: "Moderation Action", iconURL: interaction.guild.iconURL() });
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error executing timeout command:', error);

        let errorMessage = 'There was an error executing the timeout command.';
        if (error.code === 50013) {
          errorMessage = 'I do not have permission to timeout this user. Check my role hierarchy and permissions.';
        }

        return interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } else if (sub === 'mute') {
      // Mute command: add a Muted role and schedule its removal.
      const mutedRole = interaction.guild.roles.cache.find(role => role.name.toLowerCase() === 'muted');
      if (!mutedRole) {
        return interaction.reply({ content: 'Muted role not found. Please create one.', ephemeral: true });
      }
      try {
        await member.roles.add(mutedRole, reason);
        setTimeout(async () => {
          if (member.roles.cache.has(mutedRole.id)) {
            try {
              await member.roles.remove(mutedRole, 'Mute duration expired');
            } catch (err) {
              console.error('Failed to remove muted role:', err);
            }
          }
        }, durationMs);
        const muteEndDate = new Date(Date.now() + durationMs);
        const embed = new EmbedBuilder()
          .setColor("#ff0000")
          .setTitle("Mute Issued")
          .setDescription(`**${member.user.tag}** has been muted.`)
          .addFields(
            { name: "Duration <a:w:1326464173361856524>", value: durationInput, inline: true },
            { name: "Reason <:r:1326464001793855531>", value: reason, inline: true },
            { name: "Ends At <a:Warning:1326464273467179130>", value: `<t:${Math.floor(muteEndDate.getTime() / 1000)}:F>`, inline: true }
          )
          .setTimestamp()
          .setFooter({ text: "Moderation Action", iconURL: interaction.guild.iconURL() });
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error executing mute command:', error);
        return interaction.reply({ content: 'There was an error executing the mute command. Please try again.', ephemeral: true });
      }
    }
  },
};