const { ContextMenuCommandBuilder, ApplicationCommandType, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { generateQuoteImage } = require('../../handlers/quote/imageGenerator');
const { storeQuote } = require('../../handlers/quote/storage');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Make it a Quote')
        .setType(ApplicationCommandType.Message)
        .setIntegrationTypes(0, 1)
        .setContexts(0, 1, 2),

    async execute(interaction) {
        const targetMessage = interaction.targetMessage;

        // Check if message has content
        if (!targetMessage.content || targetMessage.content.trim().length === 0) {
            return await interaction.reply({
                content: 'This message has no text content to quote.',
                flags: 64 // ephemeral
            });
        }

        // Check if it's too long
        if (targetMessage.content.length > 500) {
            return await interaction.reply({
                content: 'This message is too long to quote (max 500 characters).',
                flags: 64
            });
        }

        await interaction.deferReply();

        try {
            // Generate quote image
            const imageBuffer = await generateQuoteImage(
                targetMessage.content,
                targetMessage.author
            );

            const attachment = new AttachmentBuilder(imageBuffer, { name: 'quote.png' });

            // Create buttons (only "Remove my Quote" now)
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`quote_remove_${interaction.user.id}_placeholder`)
                        .setLabel('Remove my Quote')
                        .setStyle(ButtonStyle.Danger)
                );

            const sentMessage = await interaction.editReply({
                content: `[Jump to original message](${targetMessage.url})`,
                files: [attachment],
                components: [row]
            });

            // Update button with actual message ID
            const updatedRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`quote_remove_${interaction.user.id}_${sentMessage.id}`)
                        .setLabel('Remove my Quote')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.editReply({ components: [updatedRow] });

            // Store quote metadata for button handling
            storeQuote(sentMessage.id, {
                userId: interaction.user.id,
                channelId: interaction.channelId,
                guildId: interaction.guildId,
                originalMessageUrl: targetMessage.url,
                originalAuthor: targetMessage.author.id
            });

            console.log(`Quote created by ${interaction.user.tag} for message from ${targetMessage.author.tag}`);

        } catch (error) {
            console.error('Failed to create quote:', error);
            await interaction.editReply({
                content: 'Failed to create quote image. Please try again.',
                components: []
            });
        }
    }
};
