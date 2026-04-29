const { SlashCommandBuilder, ChannelType, MessageFlags, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

//auto create 
const configFilePath = path.join(process.cwd(), "welcomer.json");
function loadConfig() {
  if (fs.existsSync(configFilePath)) {
    try {
      return JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
    } catch (e) {
      console.error("Error reading welcomer config:", e);
      return {};
    }
  }
  return {};
}

function saveConfig(config) {
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcomer')
    .setDescription('Enable welcomer for your server, simple asf, just enable and set channel.')
    .setContexts(0) // 0 = Guild only (welcomer makes no sense in DMs)
    .addBooleanOption(option =>
      option.setName('enabled')
        .setDescription('Enable or disable the welcomer.')
        .setRequired(true)
    )
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel where welcome messages will be sent.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addAttachmentOption(option =>
      option.setName('background')
        .setDescription('Optional custom background image.')
        .setRequired(false)
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: "This command can only be used in servers.",
        flags: MessageFlags.Ephemeral
      });
    }

    // Permission check: Require Manage Server.
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({
        content: "You need the **Manage Server** permission to use this command.",
        flags: MessageFlags.Ephemeral
      });
    }

    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    const background = interaction.options.getAttachment('background');
    let config = loadConfig();
    config[interaction.guild.id] = {
      enabled,
      channelId: channel.id,
      background: background ? background.url : null
    };

    saveConfig(config);

    await interaction.reply({
      content: `Welcomer has been ${enabled ? 'enabled' : 'disabled'} in <#${channel.id}>.`,
      flags: MessageFlags.Ephemeral
    });
  }
};