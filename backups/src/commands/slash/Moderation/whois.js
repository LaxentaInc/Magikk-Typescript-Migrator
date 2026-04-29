const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Get detailed information about a user')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to get info about')
        .setRequired(false)
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('target') || interaction.user;
    const member = interaction.guild ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;

    const embed = new EmbedBuilder()
      .setAuthor({
        name: target.tag || target.username,
        iconURL: target.displayAvatarURL({ dynamic: true })
      })
      .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 1024 }))
      .addFields([
        {
          name: 'Account Information',
          value: [
            `ID: ${target.id}`,
            `Created: <t:${Math.floor(target.createdTimestamp / 1000)}:R>`,
            `Bot: ${target.bot ? 'Yes' : 'No'}`,
            member ? `Joined Server: <t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '',
          ].filter(Boolean).join('\n'),
          inline: false
        }
      ]);

    if (member && member.roles.cache.size > 1) {
      const roles = member.roles.cache
        .sort((a, b) => b.position - a.position)
        .filter(r => r.id !== interaction.guild.id)
        .map(r => r.toString());

      const truncatedRoles = roles.length > 15
        ? roles.slice(0, 15).join(', ') + ` (+${roles.length - 15} more)`
        : roles.join(', ');

      if (truncatedRoles) {
        embed.addFields({
          name: `Roles (${roles.length})`,
          value: truncatedRoles.substring(0, 1024),
          inline: false
        });
      }
    }

    if (member?.presence) {
      const status = {
        online: 'Online',
        idle: 'Idle',
        dnd: 'Do Not Disturb',
        offline: 'Offline'
      };

      const activities = member.presence.activities
        .filter(a => a.type !== 4)
        .map(activity => {
          let value = `${activity.name}`;
          if (activity.details) value += `\n${activity.details}`;
          return value;
        })
        .slice(0, 2);

      if (activities.length > 0) {
        embed.addFields({
          name: 'Activity',
          value: activities.join('\n').substring(0, 1024),
          inline: false
        });
      }

      embed.addFields({
        name: 'Status',
        value: status[member.presence.status] || 'Offline',
        inline: true
      });
    }

    const acknowledgements = [];
    if (member) {
      if (interaction.guild.ownerId === member.id) {
        acknowledgements.push('Server Owner');
      }
      if (member.permissions.has('Administrator')) acknowledgements.push('Server Administrator');
      if (member.permissions.has('ManageGuild')) acknowledgements.push('Server Manager');
      if (member.permissions.has('ModerateMembers')) acknowledgements.push('Moderator');
    }

    if (acknowledgements.length > 0) {
      embed.addFields({
        name: 'Acknowledgements',
        value: acknowledgements.join(', '),
        inline: false
      });
    }

    await interaction.reply({ embeds: [embed] });
  },
};