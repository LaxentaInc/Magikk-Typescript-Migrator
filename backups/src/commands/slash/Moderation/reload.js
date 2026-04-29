"use strict";
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const path = require("path");
const fs = require("fs");

const OWNER_ID = "953527567808356404";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("reload")
    .setDescription("Reloads a specific command without restarting (developer only)")
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Choose command type: 'slash' or 'prefix'")
        .setRequired(true)
        .addChoices(
          { name: "Slash Command", value: "slash" },
          { name: "Prefix Command", value: "prefix" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("command")
        .setDescription("The command name to reload")
        .setRequired(true)
    ),

  async execute(interaction) {
    // Only the bot owner can use this command.
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: "Only the bot developer can use this!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const type = interaction.options.getString("type");
    const commandName = interaction.options.getString("command");

    // Defer reply so we have time to process.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Determine the base directory of the commands. Adjust as needed.
      const baseDir = path.join(__dirname, "..", "..", type);
      if (!fs.existsSync(baseDir)) {
        throw new Error(`Base directory not found: ${baseDir}`);
      }

      // Get the appropriate command collection.
      const commandCollection =
        type === "slash"
          ? interaction.client.slashCommands
          : interaction.client.prefixCommands;

      if (!commandCollection) {
        throw new Error(`${type} commands collection not found!`);
      }

      // Recursive function to find the command file.
      function findCommandFile(dir, cmdName) {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const found = findCommandFile(fullPath, cmdName);
            if (found) return found;
          } else if (item.toLowerCase() === `${cmdName.toLowerCase()}.js`) {
            return {
              path: fullPath,
              relativePath: path.relative(baseDir, fullPath),
            };
          }
        }
        return null;
      }

      // Try to locate the command file exactly.
      let foundCommand = findCommandFile(baseDir, commandName);

      // If no exact match, try fuzzy matching.
      if (!foundCommand) {
        function fuzzySearch(dir, cmdName) {
          const items = fs.readdirSync(dir);
          let matches = [];
          for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              matches = matches.concat(fuzzySearch(fullPath, cmdName));
            } else if (
              item.toLowerCase().includes(cmdName.toLowerCase()) &&
              item.endsWith(".js")
            ) {
              matches.push({
                path: fullPath,
                relativePath: path.relative(baseDir, fullPath),
              });
            }
          }
          return matches;
        }
        const fuzzyMatches = fuzzySearch(baseDir, commandName);
        if (fuzzyMatches.length === 1) {
          foundCommand = fuzzyMatches[0];
        } else if (fuzzyMatches.length > 1) {
          const matchList = fuzzyMatches
            .map((cmd) => `\`${path.basename(cmd.path, ".js")}\``)
            .join(", ");
          return interaction.editReply({
            content: `Multiple commands matched your query: ${matchList}.\nPlease be more specific.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      if (!foundCommand) {
        return interaction.editReply({
          content: `Command \`${commandName}\` not found.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // Remove the old command from the collection.
      const oldCommand =
        type === "slash"
          ? commandCollection.get(commandName)
          : Array.from(commandCollection.values()).find(
              (cmd) => cmd.name === commandName
            );
      if (oldCommand) {
        if (type === "slash") {
          commandCollection.delete(commandName);
        } else {
          commandCollection.delete(oldCommand.name);
        }
      }

      // Clear the require cache for the command file.
      delete require.cache[require.resolve(foundCommand.path)];

      // Load the new command.
      const newCommand = require(foundCommand.path);

      // Validate the command structure.
      if (type === "slash" && (!newCommand.data || !newCommand.execute)) {
        throw new Error(
          "The slash command file is missing required properties ('data' or 'execute')."
        );
      }
      if (type === "prefix" && (!newCommand.name || !newCommand.execute)) {
        throw new Error(
          "The prefix command file is missing required properties ('name' or 'execute')."
        );
      }

      // Add the new command to the collection.
      const commandKey = type === "slash" ? newCommand.data.name : newCommand.name;
      commandCollection.set(commandKey, newCommand);

      // For slash commands, clear the old registration from Discord and re-register.
      if (type === "slash") {
        // Fetch current global slash commands.
        const appCommands = await interaction.client.application.commands.fetch();
        const registeredCommand = appCommands.find(
          (cmd) => cmd.name === newCommand.data.name
        );
        if (registeredCommand) {
          // Delete the old registered command.
          await interaction.client.application.commands.delete(registeredCommand.id);
          console.log(`Deleted old registered slash command: ${newCommand.data.name}`);
        }
        // Re-register the new slash command.
        await interaction.client.application.commands.create(newCommand.data.toJSON());
        console.log(`Registered new slash command: ${newCommand.data.name}`);
      }

      await interaction.editReply({
        content: `✅ Successfully reloaded command \`${commandKey}\`!\nPath: \`.../${type}/${foundCommand.relativePath}\``,
        flags: MessageFlags.Ephemeral,
      });

      console.log(
        `[Reload] ${interaction.user.tag} reloaded ${type}/${foundCommand.relativePath}`
      );
    } catch (error) {
      console.error("[Command Reload] Error:", error);
      await interaction.editReply({
        content:
          `⚠️ **Error!**\nMessage: ${error.message}\n\`\`\`js\n${error.stack}\n\`\`\``,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};