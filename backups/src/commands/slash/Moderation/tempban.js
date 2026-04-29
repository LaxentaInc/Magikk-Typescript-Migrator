const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');
const mongoose = require('mongoose');
const ms = require('ms');

// MongoDB Schema
const tempBanSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    endTime: { type: Date, required: true },
});
const TempBan = mongoose.model('TempBan', tempBanSchema);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tempban')
        .setDescription('Temporarily ban a user.')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to ban.')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('The duration of the ban (e.g., 1h, 2d, 3w).')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the ban.')
                .setRequired(false)
        ),

    async execute(interaction) {
        const guild = interaction.guild;
        const targetUser = interaction.options.getUser('user');
        const duration = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided.';
        const adminUser = interaction.user;

        const msDuration = ms(duration);
        if (isNaN(msDuration) || msDuration <= 0) {
            return interaction.reply({ content: 'Invalid ban duration. Please use a valid format (e.g., 1h, 2d, 3w).', ephemeral: true });
        }

        const confirmEmbed = new EmbedBuilder()
            .setColor('#FFCC00')
            .setTitle('Confirm Temporary Ban')
            .setThumbnail(targetUser.displayAvatarURL())
            .setDescription(`
              Are you sure you want to temporarily ban ${targetUser.tag} for ${duration}?

              **Reason:** ${reason}
          `)
            .setFooter({ text: `Action by ${adminUser.tag}`, iconURL: adminUser.displayAvatarURL() });

        const confirmButton = new ButtonBuilder()
            .setCustomId('confirm-tempban')
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel-tempban')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder()
            .addComponents(confirmButton, cancelButton);

        const confirmationMessage = await interaction.reply({
            embeds: [confirmEmbed],
            components: [row],
        });

        const filter = (i) =>
            ['confirm-tempban', 'cancel-tempban'].includes(i.customId) &&
            i.user.id === interaction.user.id;

        const collector = confirmationMessage.createMessageComponentCollector({ filter, time: 15000, max: 1 });

        collector.on('collect', async (i) => {
            if (i.customId === 'confirm-tempban') {
                try {
                    // mongoose is already connected via index.js
                    const endTime = new Date(Date.now() + msDuration);
                    const ban = new TempBan({
                        guildId: guild.id,
                        userId: targetUser.id,
                        endTime: endTime,
                    });
                    await ban.save();

                    await guild.members.ban(targetUser, { reason: reason });

                    const successEmbed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('User Temporarily Banned')
                        .setThumbnail(targetUser.displayAvatarURL())
                        .setDescription(`
                          **User:** ${targetUser.tag}
                          **Duration:** ${duration}
                          **Reason:** ${reason}
                      `)
                        .setFooter({ text: `Action by ${adminUser.tag}`, iconURL: adminUser.displayAvatarURL() });

                    await i.update({ embeds: [successEmbed], components: [] });

                    // Unban the user after the specified duration
                    setTimeout(async () => {
                        try {
                            await guild.members.unban(targetUser.id);
                            console.log(`Unbanned ${targetUser.tag} after ${duration}`);
                            await TempBan.deleteOne({
                                guildId: guild.id,
                                userId: targetUser.id,
                            });
                        } catch (error) {
                            console.error(`Error unbanning ${targetUser.tag}:`, error);
                            // Handle cases where the user is already unbanned manually
                        }
                    }, msDuration);

                } catch (error) {
                    console.error(`Error temporarily banning ${targetUser.tag}:`, error);
                    await i.update({ content: 'An error occurred while processing the ban. Please try again later.', embeds: [], components: [] });
                }
            } else if (i.customId === 'cancel-tempban') {
                await i.update({ content: 'Temporary ban canceled.', embeds: [], components: [] });
            }
        });


        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                confirmationMessage.edit({ content: 'Confirmation timed out. User was not banned.', components: [] });
            }
        });
    },
};