const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { processAndTranslate, isImageUrl, LANGUAGES } = require("../../../handlers/translations/translationHandler");

// Fetch recent images from channel
async function fetchRecentImages(channel, limit = 10) {
    const images = [];
    const messages = await channel.messages.fetch({ limit: 50 });

    for (const msg of messages.values()) {
        for (const attachment of msg.attachments.values()) {
            if (attachment.contentType?.startsWith("image/")) {
                images.push({
                    url: attachment.url,
                    name: attachment.name,
                    messageId: msg.id,
                    author: msg.author.username
                });
                if (images.length >= limit) break;
            }
        }
        for (const embed of msg.embeds) {
            if (embed.image?.url) {
                images.push({
                    url: embed.image.url,
                    name: "Embedded Image",
                    messageId: msg.id,
                    author: msg.author.username
                });
                if (images.length >= limit) break;
            }
        }
        if (images.length >= limit) break;
    }

    return images;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("translate-image")
        .setDescription("Extract and translate text from an image")
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .addAttachmentOption(option =>
            option.setName("image")
                .setDescription("Upload an image to translate")
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName("url")
                .setDescription("Paste an image URL (Discord CDN, imgur, etc.)")
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName("to")
                .setDescription("Target language (default: English)")
                .setRequired(false)
                .addChoices(
                    { name: "English", value: "en" },
                    { name: "Japanese", value: "ja" },
                    { name: "Korean", value: "ko" },
                    { name: "Chinese", value: "zh" },
                    { name: "Spanish", value: "es" },
                    { name: "French", value: "fr" },
                    { name: "German", value: "de" },
                    { name: "Russian", value: "ru" },
                    { name: "Hindi", value: "hi" },
                    { name: "Portuguese", value: "pt" }
                )
        )
        .addStringOption(option =>
            option.setName("engine")
                .setDescription("OCR engine (default: auto)")
                .setRequired(false)
                .addChoices(
                    { name: "Auto", value: "auto" },
                    { name: "Google Vision", value: "google" },
                    { name: "Tesseract", value: "tesseract" }
                )
        ),

    async execute(interaction) {
        const attachment = interaction.options.getAttachment("image");
        const imageUrl = interaction.options.getString("url");
        const targetLang = interaction.options.getString("to") || "en";
        const engine = interaction.options.getString("engine") || "auto";

        let finalImageUrl = null;

        // Priority 1: Direct attachment
        if (attachment) {
            if (!attachment.contentType?.startsWith("image/")) {
                return interaction.reply({
                    content: "That's not an image file!",
                    ephemeral: true
                });
            }
            finalImageUrl = attachment.url;
        }
        // Priority 2: URL option
        else if (imageUrl) {
            if (!isImageUrl(imageUrl)) {
                return interaction.reply({
                    content: "That doesn't look like a valid image URL!",
                    ephemeral: true
                });
            }
            finalImageUrl = imageUrl;
        }
        // Priority 3: Check if replying to a message with image
        else if (interaction.channel) {
            const reference = interaction.message?.reference;
            if (reference) {
                try {
                    const repliedMsg = await interaction.channel.messages.fetch(reference.messageId);
                    const imgAttachment = repliedMsg.attachments.find(a => a.contentType?.startsWith("image/"));
                    if (imgAttachment) {
                        finalImageUrl = imgAttachment.url;
                    } else if (repliedMsg.embeds[0]?.image?.url) {
                        finalImageUrl = repliedMsg.embeds[0].image.url;
                    }
                } catch (e) { }
            }
        }

        // Priority 4: Show recent images picker (only in guilds)
        const isGuildChannel = interaction.guild && interaction.channel;

        if (!finalImageUrl && isGuildChannel) {
            // Show processing message immediately
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setDescription("<a:loading_1310498088724729876:1342443735039868989> **Scanning channel for images...**")]
            });

            try {
                const recentImages = await fetchRecentImages(interaction.channel, 5);

                if (recentImages.length === 0) {
                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setDescription("No images found in recent messages!\n\n**Use one of these instead:**\n`/translate-image image:` upload a file\n`/translate-image url:` paste a link")]
                    });
                }

                const embed = new EmbedBuilder()
                    .setTitle("Select an Image")
                    .setDescription(recentImages.map((img, i) =>
                        `**${i + 1}.** \`${img.name}\` by ${img.author}`
                    ).join("\n"));

                const rows = [];
                const buttonsPerRow = 5;

                for (let i = 0; i < recentImages.length; i += buttonsPerRow) {
                    const row = new ActionRowBuilder();
                    const chunk = recentImages.slice(i, i + buttonsPerRow);

                    chunk.forEach((img, idx) => {
                        row.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`timg_${i + idx}_${interaction.user.id}_${targetLang}_${engine}`)
                                .setLabel(`${i + idx + 1}`)
                                .setStyle(ButtonStyle.Secondary)
                        );
                    });
                    rows.push(row);
                }

                const response = await interaction.editReply({
                    embeds: [embed],
                    components: rows
                });

                const imageMap = new Map();
                recentImages.forEach((img, i) => imageMap.set(i, img.url));

                const collector = response.createMessageComponentCollector({
                    filter: i => i.user.id === interaction.user.id && i.customId.startsWith("timg_"),
                    time: 60000,
                    max: 1
                });

                collector.on("collect", async (btnInteraction) => {
                    const [, indexStr, , lang, eng] = btnInteraction.customId.split("_");
                    const selectedUrl = imageMap.get(parseInt(indexStr));

                    await btnInteraction.update({
                        embeds: [new EmbedBuilder()
                            .setDescription("<a:loading_1310498088724729876:1342443735039868989> **Extracting text and translating...**")],
                        components: []
                    });

                    try {
                        const result = await processAndTranslate(selectedUrl, lang, eng);

                        if (!result.success) {
                            return btnInteraction.editReply({
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
                            .setThumbnail(selectedUrl);

                        await btnInteraction.editReply({ embeds: [resultEmbed] });
                    } catch (error) {
                        console.error("Translation error:", error);
                        await btnInteraction.editReply({
                            embeds: [new EmbedBuilder()
                                .setTitle("Something went wrong")
                                .setDescription(`\`${error.message}\``)]
                        });
                    }
                });

                collector.on("end", (collected, reason) => {
                    if (reason === "time" && collected.size === 0) {
                        interaction.editReply({
                            embeds: [new EmbedBuilder().setDescription("Selection timed out")],
                            components: []
                        }).catch(() => { });
                    }
                });

                return;
            } catch (error) {
                console.log("Failed to fetch recent images:", error.message);
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setDescription("Couldn't scan channel for images.\n\n**Use one of these instead:**\n`/translate-image image:` upload a file\n`/translate-image url:` paste a link")]
                });
            }
        }

        // No image and in DMs - clear error
        if (!finalImageUrl) {
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle("No Image Provided")
                    .setDescription("I can't scan for images in DMs.\n\n**Please use one of these options:**\n`/translate-image image:` upload a file directly\n`/translate-image url:` paste an image link")],
                ephemeral: true
            });
        }

        // Show processing message
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setDescription("<a:loading_1310498088724729876:1342443735039868989> **Extracting text and translating...**")]
        });

        try {
            const result = await processAndTranslate(finalImageUrl, targetLang, engine);

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
                .setThumbnail(finalImageUrl);

            await interaction.editReply({ embeds: [resultEmbed] });

        } catch (error) {
            console.error("Translate-image error:", error);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle("Something went wrong")
                    .setDescription(`\`${error.message}\``)]
            });
        }
    }
};
