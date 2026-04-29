const {
    SlashCommandBuilder,
    PermissionsBitField,
    EmbedBuilder,
    MessageFlags,
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("echo")
        .setDescription("Repeats the input message and optionally sends it as an embed.")
        // .setContexts(0, 1) // 0 = Guild, 1 = User, 2 = DM (Excluded)
        .setIntegrationTypes(0, 1)
        .setContexts(0, 1, 2)
        .addStringOption((option) =>
            option
                .setName("message")
                .setDescription("The message to echo.")
                .setRequired(true),
        )
        .addBooleanOption((option) =>
            option
                .setName("embed")
                .setDescription("Send the message as an embed.")
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName("title")
                .setDescription("Title of the embed (optional)."),
        )
        .addStringOption((option) =>
            option
                .setName("footer")
                .setDescription("Footer text of the embed (optional)."),
        )
        .addStringOption((option) =>
            option
                .setName("thumbnail")
                .setDescription("URL of the thumbnail image for the embed (optional)."),
        ),

    async execute(interaction) {
        // In DMs, we want the reply to be public (so it looks like a message).
        // In Guilds, we want it ephemeral (to hide the "Sent!" confirmation).
        const isEphemeral = !!interaction.guild;
        await interaction.deferReply({ flags: isEphemeral ? MessageFlags.Ephemeral : undefined });

        // Only enforce permissions if in a guild
        if (interaction.guild) {
            // Use memberPermissions which works consistently for interactions
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) &&
                !interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels) &&
                !interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.editReply({
                    content: "You need **Administrator**, **Manage Channels**, or **Manage Server** permission to use this command!",
                });
            }
        }

        const message = interaction.options.getString("message");
        const sendAsEmbed = interaction.options.getBoolean("embed") || false;
        // Fallback title safe for DMs
        const defaultTitle = interaction.guild ? interaction.guild.name : "Echo";
        const title = interaction.options.getString("title") || defaultTitle;
        const footer = interaction.options.getString("footer") || "Aero — echo";
        const thumbnail = interaction.options.getString("thumbnail");
        let echoResponse;
        if (sendAsEmbed) {
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(message)
                .setFooter({ text: footer })
                .setColor(`#${(Math.floor(Math.random() * 80) + 50).toString(16).padStart(2, '0')}${(Math.random() < 0.7 ? (Math.floor(Math.random() * 30) + 10) : (Math.floor(Math.random() * 80) + 50)).toString(16).padStart(2, '0')}${(Math.floor(Math.random() * 120) + 80).toString(16).padStart(2, '0')}`)

            if (thumbnail) {
                embed.setThumbnail(thumbnail);
            }

            echoResponse = { embeds: [embed] };
        } else {
            echoResponse = { content: message };
        }

        try {
            let targetChannel = interaction.channel;

            // Fallback: Try to fetch channel if it's null (common in User Apps or if cache is empty)
            if (!targetChannel && interaction.channelId) {
                try {
                    targetChannel = await interaction.client.channels.fetch(interaction.channelId);
                } catch (e) {
                    console.log("Could not fetch channel:", e.message);
                }
            }

            if (!targetChannel) {
                // If we can't find channel, just reply with the echo (likely DM User App)
                return interaction.editReply(echoResponse);
            }

            // Try sending detached message
            await targetChannel.send(echoResponse);

            // If successful, update the thinking/status message
            await interaction.editReply({ content: "Message sent successfully!" });

        } catch (error) {
            // Fallback: If channel.send fails (e.g. User App in DM), reuse the interaction reply
            if (error.code === 50001 || error.status === 403 || !interaction.guild) {
                try {
                    // This turns the "Thinking..." message INTO the echo message
                    await interaction.editReply(echoResponse);
                    return;
                } catch (e) {
                    console.error("Fallback editReply failed:", e);
                }
            }

            console.error("Failed to send the message:", error);
            await interaction.editReply({
                content: `Failed to send message: ${error.message}\n(If using in DMs, the bot might not be able to send detached messages)`,
            });
        }
    },
};