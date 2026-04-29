const { ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder } = require('discord.js');
const { processAndTranslate, LANGUAGES } = require('../../handlers/translations/translationHandler');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Translate Image')
        .setType(ApplicationCommandType.Message)
        .setIntegrationTypes(0, 1)
        .setContexts(0, 1, 2),

    async execute(interaction) {
        const targetMessage = interaction.targetMessage;

        let imageUrl = null;

        // Check for attachments first
        const attachment = targetMessage.attachments.find(a => a.contentType?.startsWith('image/'));
        if (attachment) {
            imageUrl = attachment.url;
        }
        // Then check for embeds with images
        else if (targetMessage.embeds.length > 0 && targetMessage.embeds[0].image) {
            imageUrl = targetMessage.embeds[0].image.url;
        }

        if (!imageUrl) {
            return interaction.reply({
                content: "I couldn't find any image in that message!",
                ephemeral: true
            });
        }

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setDescription("<a:loading_1310498088724729876:1342443735039868989> **Extracting text and translating...**")],
            // ephemeral: true
        });

        try {
            // Default to English and Auto engine for context command
            const targetLang = 'en';
            const engine = 'auto';

            const result = await processAndTranslate(imageUrl, targetLang, engine);

            if (!result.success) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setTitle("No Text Found")
                        .setDescription("Couldn't detect any text in this image.\n\n**Tips:**\n• Use clearer images\n• Avoid heavily stylized fonts\n• Make sure text is readable")]
                });
            }

            const resultEmbed = new EmbedBuilder()
                .setTitle("Image Translation")
                .addFields(
                    {
                        name: "Original",
                        value: result.original.length > 1000
                            ? result.original.substring(0, 1000) + "..."
                            : result.original
                    },
                    {
                        name: LANGUAGES[result.targetLang] || result.targetLang,
                        value: result.translated.length > 1000
                            ? result.translated.substring(0, 1000) + "..."
                            : result.translated
                    }
                )
                .setThumbnail(imageUrl)
                .setFooter({ text: `Translated to ${LANGUAGES[result.targetLang]} • Engine: ${result.engine}` });

            await interaction.editReply({ embeds: [resultEmbed] });

        } catch (error) {
            console.error("Context command translation error:", error);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("Something went wrong")
                    .setDescription(`\`${error.message}\``)]
            });
        }
    }
};
