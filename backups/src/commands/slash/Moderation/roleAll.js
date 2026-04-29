// path: commands/massrole.js
const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roleall')
    .setDescription('Assign or remove a role for all members in the server.')
    .setContexts(0, 1) // 0 = Guild, 1 = User, 2 = DM (Excluded)
    .addStringOption(option =>
      option
        .setName('action')
        .setDescription('Whether to add or remove the role')
        .setRequired(true)
        .addChoices(
          { name: 'Add Role', value: 'add' },
          { name: 'Remove Role', value: 'remove' }
        )
    )
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('The role to assign or remove')
        .setRequired(true)
    ),
  async execute(interaction) {
    const action = interaction.options.getString('action');
    const role = interaction.options.getRole('role');

    // Check if the user has Administrator permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: '❌ You need **Administrator** permissions to use this command.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Check if the bot has Manage Roles permission
    if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({
        content: '❌ I need **Manage Roles** permission to execute this command.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Check role hierarchy
    if (role.position >= interaction.guild.members.me.roles.highest.position) {
      return interaction.reply({
        content: `❌ I cannot manage the role **${role.name}** because it is equal to or higher than my highest role.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Fetch all members
    const members = await interaction.guild.members.fetch();
    const validMembers = members.filter(member => !member.user.bot); // Exclude bots

    if (!validMembers.size) {
      return interaction.reply({
        content: '⚠️ There are no members in this server to modify.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Initial feedback
    await interaction.reply({
      content: `⏳ **Processing Role Changes:**\n**Action:** ${action === 'add' ? 'Adding' : 'Removing'} role **${role.name}** for ${validMembers.size} members.`,
      flags: MessageFlags.Ephemeral,
    });

    // Process members asynchronously
    let successCount = 0;
    let failCount = 0;

    const promises = validMembers.map(async member => {
      try {
        if (action === 'add') {
          await member.roles.add(role);
        } else {
          await member.roles.remove(role);
        }
        successCount++;
      } catch (error) {
        console.error(`Failed to modify role for member ${member.user.tag}: ${error.message}`);
        failCount++;
      }
    });

    await Promise.all(promises);

    // Completion feedback
    await interaction.editReply({
      content: null,
      embeds: [
        {
          title: '✅ Role Changes Complete',
          description: `**Role:** ${role.name}\n**Action:** ${action === 'add' ? 'Added to' : 'Removed from'} members.`,
          fields: [
            { name: '✅ Successful', value: `${successCount} members`, inline: true },
            { name: '❌ Failed', value: `${failCount} members`, inline: true },
          ],
          color: 0x00ff00,
        },
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};