"use strict";
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { translateText, LANGUAGES } = require("../../../handlers/translations/translationHandler");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("translate")
    .setDescription("Translate text from one language to another")
    .addStringOption(option =>
      option.setName("text")
        .setDescription("Text to translate")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("to")
        .setDescription("Target language (e.g., en, es, fr, ja). Defaults to English if not provided.")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("from")
        .setDescription("Source language (optional, leave blank for auto-detect)")
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName("ephemeral")
        .setDescription("Should the reply be ephemeral? (default: false)")
        .setRequired(false)
    )
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2),

  async execute(interaction) {
    const text = interaction.options.getString("text");
    const to = interaction.options.getString("to") || "en";
    const from = interaction.options.getString("from");
    const ephemeral = interaction.options.getBoolean("ephemeral") || false;

    try {
      await interaction.deferReply({ ephemeral });

      const result = await translateText(text, to, from);

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("Translation Result")
        .addFields(
          { name: "Original Text", value: result.original.length > 1024 ? result.original.slice(0, 1021) + "..." : result.original },
          { name: "Translated Text", value: result.translated.length > 1024 ? result.translated.slice(0, 1021) + "..." : result.translated },
          { name: "Target Language", value: LANGUAGES[result.targetLang] || result.targetLang, inline: true },
          { name: "Source Language", value: result.sourceLang === 'auto' ? "Auto-detected" : (LANGUAGES[result.sourceLang] || result.sourceLang), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "Using Google Translate" });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Translation error:", error);
      await interaction.editReply("Error translating text. Please check language codes and try again.");
    }
  }
};