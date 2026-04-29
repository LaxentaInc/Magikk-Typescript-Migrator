const {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ChannelType,
  InteractionContextType,
  ButtonStyle
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const { registerButton } = require("../../../handlers/buttonHandler.js");
const { v4: uuidv4 } = require("uuid");

const helpState = {};

async function deferSafe(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => {
      console.warn("Interaction already deferred or expired.");
    });
  }
}

async function editSafe(interaction, options) {
  try {
    await interaction.editReply(options);
  } catch (error) {
    console.warn("Failed to edit interaction reply. It may have expired or already been handled.");
  }
}

function getCategoryDropdown(dropdownOptions, page, categoriesPerPage = 25) {
  const options = dropdownOptions.slice(page * categoriesPerPage, (page + 1) * categoriesPerPage);
  const select = new StringSelectMenuBuilder()
    .setCustomId("help-category-select")
    .setPlaceholder("📚 Choose a command category...")
    .addOptions(options);
  return new ActionRowBuilder().addComponents(select);
}

function getCategoryCommandEmbed(categoryName, cmds, commandPage, commandsPerPage, client) {
  const totalPages = Math.ceil(cmds.length / commandsPerPage) || 1;
  const totalCommands = cmds.length;

  // Category emojis for visual appeal
  // const categoryEmojis = {
  //   moderation: '🛡️',
  //   utility: '🔧',
  //   fun: '🎮',
  //   music: '🎵',
  //   admin: '⚙️',
  //   info: 'ℹ️',
  //   economy: '💰',
  //   leveling: '📊'
  // };
  const categoryEmojis = {
    moderation: '<:LaxnetaInc:1422449088351178804>',
    utility: '<a:moon_1325374132182847528:1342444076880105503>',
    fun: '<:LaxnetaInc:1422449088351178804>',
    music: '<a:milkbear_1338415503877865506:1342442875971174470>',
    admin: '<a:server_markerse_1311202842920488:1342443400636403733>',
    info: '<a:computer6:1333357940341735464>',
    economy: '<a:gwys_1327982904604889190:1342442980878979113>',
    leveling: '<:helppppp:1437818267489013960>'
  };

  const emoji = categoryEmojis[categoryName.toLowerCase()] || '📁';

  const embed = new EmbedBuilder()
    .setColor("#5865F2")
    .setAuthor({
      name: `${categoryName.charAt(0).toUpperCase() + categoryName.slice(1)} Commands`,
      iconURL: client.user.displayAvatarURL()
    })
    .setDescription(`Showing **${totalCommands}** command${totalCommands !== 1 ? 's' : ''} in this category\n${emoji.repeat(3)}\n`)
    .setTimestamp()
    .setFooter({
      text: `Page ${commandPage + 1}/${totalPages} • Use !help for prefix commands`,
      iconURL: client.user.displayAvatarURL()
    });

  const pageCommands = cmds.slice(commandPage * commandsPerPage, (commandPage + 1) * commandsPerPage);

  // Group commands in a cleaner format
  let commandList = '';
  for (const cmd of pageCommands) {
    commandList += `${emoji} **${cmd.name}**\n└ ${cmd.description}\n\n`;
  }

  embed.addFields({
    name: '━━━━━━━━━━━━━━━━━━━━',
    value: commandList || 'No commands available.',
    inline: false
  });

  return embed;
}

async function createCommandPaginationRow(messageId, commandPage, totalPages, userId) {
  const components = [];

  if (commandPage > 0) {
    const prevId = `help-${messageId}-prev-${commandPage}`;
    await registerButton(
      prevId,
      [userId],
      async (interaction) => {
        await deferSafe(interaction);
        const state = helpState[messageId];
        if (!state) return;

        state.commandPage--;
        const cmds = state.categories[state.currentCategory];
        const newTotalPages = Math.ceil(cmds.length / state.commandsPerPage) || 1;
        const commandEmbed = getCategoryCommandEmbed(
          state.currentCategory,
          cmds,
          state.commandPage,
          state.commandsPerPage,
          interaction.client
        );
        const newRow = await createCommandPaginationRow(messageId, state.commandPage, newTotalPages, userId);

        await editSafe(interaction, {
          embeds: [commandEmbed],
          components: newRow ? [newRow] : []
        });
      },
      { type: 'custom' }
    );

    components.push(
      new ButtonBuilder()
        .setCustomId(prevId)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("◀️")
    );
  }

  if (commandPage < totalPages - 1) {
    const nextId = `help-${messageId}-next-${commandPage}`;
    await registerButton(
      nextId,
      [userId],
      async (interaction) => {
        await deferSafe(interaction);
        const state = helpState[messageId];
        if (!state) return;

        state.commandPage++;
        const cmds = state.categories[state.currentCategory];
        const newTotalPages = Math.ceil(cmds.length / state.commandsPerPage) || 1;
        const commandEmbed = getCategoryCommandEmbed(
          state.currentCategory,
          cmds,
          state.commandPage,
          state.commandsPerPage,
          interaction.client
        );
        const newRow = await createCommandPaginationRow(messageId, state.commandPage, newTotalPages, userId);

        await editSafe(interaction, {
          embeds: [commandEmbed],
          components: newRow ? [newRow] : []
        });
      },
      { type: 'custom' }
    );

    components.push(
      new ButtonBuilder()
        .setCustomId(nextId)
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("▶️")
    );
  }

  const backId = `help-${messageId}-back`;
  await registerButton(
    backId,
    [userId],
    async (interaction) => {
      await deferSafe(interaction);
      const state = helpState[messageId];
      if (!state) return;

      state.currentCategory = null;
      state.commandPage = 0;

      const totalCategories = Object.keys(state.categories).length;
      const totalCommands = Object.values(state.categories).reduce((acc, cmds) => acc + cmds.length, 0);

      const mainEmbed = new EmbedBuilder()
        .setColor("#5865F2")
        .setAuthor({
          name: "Command Help Menu",
          iconURL: interaction.client.user.displayAvatarURL()
        })
        .setDescription(
          `Welcome to the help menu! Select a category below to explore available commands.\n\n` +
          `<:helppppp:1437818267489013960> **Statistics**\n` +
          `└ ${totalCategories} Categories\n` +
          `└ ${totalCommands} Total Commands\n\n` +
          `💡 **Tip:** Use the dropdown menu below to navigate through categories!`
        )
        .setThumbnail(interaction.client.user.displayAvatarURL())
        .setTimestamp()
        .setFooter({
          text: "Use !help to view prefix commands",
          iconURL: interaction.client.user.displayAvatarURL()
        });

      const dropdownRow = getCategoryDropdown(state.dropdownOptions, 0);

      await editSafe(interaction, {
        embeds: [mainEmbed],
        components: [dropdownRow]
      });
    },
    { type: 'custom' }
  );

  components.push(
    new ButtonBuilder()
      .setCustomId(backId)
      .setLabel("Back to Menu")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("<a:computer6:1333357940341735464>")
  );

  return components.length > 0 ? new ActionRowBuilder().addComponents(components) : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setContexts([0, 2])
    .setDescription("Lists all available slash commands by category."),
  cooldown: 30,
  async execute(interaction) {
    try {
      // Define the slash commands folder path.
      const slashFolderPath = path.join(__dirname, "../../slash");
      // Get all subdirectories (each representing a category).
      const commandFolders = fs.readdirSync(slashFolderPath).filter(file =>
        fs.statSync(path.join(slashFolderPath, file)).isDirectory()
      );

      // Build the categories object by loading each command file.
      const categories = {};
      for (const folder of commandFolders) {
        const commandFiles = fs
          .readdirSync(path.join(slashFolderPath, folder))
          .filter((file) => file.endsWith(".js"));
        const cmds = commandFiles
          .map((file) => {
            try {
              const command = require(path.join(slashFolderPath, folder, file));
              return {
                name: `/${command.data.name}`,
                description: command.data.description || "No description provided"
              };
            } catch (error) {
              console.error(`Error loading command file ${file} in folder ${folder}:`, error);
              return null;
            }
          })
          .filter((cmd) => cmd && cmd.name && cmd.description);
        if (cmds.length) categories[folder] = cmds;
      }

      // Category emojis for dropdown
      const categoryEmojis = {
        moderation: '<:LaxnetaInc:1422449088351178804>',
        utility: '<a:moon_1325374132182847528:1342444076880105503>',
        fun: '<:LaxnetaInc:1422449088351178804>',
        music: '<a:milkbear_1338415503877865506:1342442875971174470>',
        admin: '<a:server_markerse_1311202842920488:1342443400636403733>',
        info: '<a:computer6:1333357940341735464>',
        economy: '<a:gwys_1327982904604889190:1342442980878979113>',
        leveling: '<:helppppp:1437818267489013960>'
      };

      // Build dropdown options from category names.
      const dropdownOptions = Object.keys(categories).map((cat) => {
        const emoji = categoryEmojis[cat.toLowerCase()] || '<a:marker_1326464173361856524:1342443432240746577>';
        const cmdCount = categories[cat].length;
        return {
          label: `${cat.charAt(0).toUpperCase() + cat.slice(1)}`,
          description: `${cmdCount} command${cmdCount !== 1 ? 's' : ''} available`,
          value: cat,
          emoji: emoji
        };
      });

      if (dropdownOptions.length === 0) {
        return interaction.reply({ content: "No commands available.", ephemeral: true });
      }

      const totalCategories = dropdownOptions.length;
      const totalCommands = Object.values(categories).reduce((acc, cmds) => acc + cmds.length, 0);

      const mainEmbed = new EmbedBuilder()
        .setColor("#5865F2")
        .setAuthor({
          name: "Command Help Menu",
          iconURL: interaction.client.user.displayAvatarURL()
        })
        .setDescription(
          `Welcome to the help menu! Select a category below to explore available commands.\n\n` +
          `<:helppppp:1437818267489013960> **Statistics**\n` +
          `└ ${totalCategories} Categories\n` +
          `└ ${totalCommands} Total Commands\n\n` +
          `💡 **Tip:** Use the dropdown menu below to navigate through categories!`
        )
        .setThumbnail(interaction.client.user.displayAvatarURL())
        .setTimestamp()
        .setFooter({
          text: "Use !help to view prefix commands",
          iconURL: interaction.client.user.displayAvatarURL()
        });

      const dropdownRow = getCategoryDropdown(dropdownOptions, 0);

      await interaction.reply({
        embeds: [mainEmbed],
        components: [dropdownRow]
      });
      const replyMsg = await interaction.fetchReply();

      helpState[replyMsg.id] = {
        currentCategory: null,
        commandPage: 0,
        categories,
        dropdownOptions,
        commandsPerPage: 10
      };

      const collector = replyMsg.createMessageComponentCollector({ time: 300000 });

      collector.on("collect", async (i) => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({ content: "Brotha You cannot use this.", ephemeral: true });
        }

        if (i.isStringSelectMenu() && i.customId === "help-category-select") {
          const state = helpState[replyMsg.id];
          const chosenCategory = i.values[0];
          state.currentCategory = chosenCategory;
          state.commandPage = 0;

          const cmds = state.categories[chosenCategory];
          const totalPages = Math.ceil(cmds.length / state.commandsPerPage) || 1;
          const commandEmbed = getCategoryCommandEmbed(
            chosenCategory,
            cmds,
            state.commandPage,
            state.commandsPerPage,
            interaction.client
          );

          const paginationRow = await createCommandPaginationRow(
            replyMsg.id,
            state.commandPage,
            totalPages,
            interaction.user.id
          );

          await i.update({
            embeds: [commandEmbed],
            components: paginationRow ? [paginationRow] : []
          });
        }
      });

      collector.on("end", async () => {
        try {
          await replyMsg.edit({ components: [] });
        } catch (e) {
          // silently ignore expected errors (missing access in dms, deleted message, etc.)
          const ignoreCodes = [10008, 50001, 50013];
          if (!ignoreCodes.includes(e.code)) {
            console.error("Error editing reply on collector end:", e);
          }
        }
        delete helpState[replyMsg.id];
      });
    } catch (error) {
      console.error("Error executing slash help command:", error);
      if (!interaction.deferred) {
        await interaction.reply({ content: "Something went wrong while executing the help command.", ephemeral: true });
      } else {
        await interaction.editReply({ content: "Something went wrong while executing the help command." });
      }
    }
  }
};