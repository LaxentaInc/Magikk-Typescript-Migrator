const {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
} = require('discord.js');
const { Timer } = require('../../../utils/timerRestore');

const formatTime = (ms) => {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    const parts = [];
    if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    if (minutes > 0) parts.push(`${minutes} min${minutes > 1 ? 's' : ''}`);
    if (seconds > 0) parts.push(`${seconds} sec${seconds > 1 ? 's' : ''}`);

    return parts.join(', ') || '0 seconds';
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('timer')
        .setDescription('Set a timer - I\'ll ping you when time\'s up!')
        .setIntegrationTypes(0, 1)
        .setContexts(0, 1, 2)
        .addNumberOption((option) =>
            option.setName('duration')
                .setDescription('How long?')
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption((option) =>
            option.setName('unit')
                .setDescription('Time unit')
                .setRequired(true)
                .addChoices(
                    { name: 'Seconds', value: 'seconds' },
                    { name: 'Minutes', value: 'minutes' },
                    { name: 'Hours', value: 'hours' },
                    { name: 'Days', value: 'days' }
                )
        )
        .addStringOption((option) =>
            option.setName('reminder')
                .setDescription('What\'s this for?')
                .setMaxLength(200)
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const duration = interaction.options.getNumber('duration');
        const unit = interaction.options.getString('unit');
        const reminder = interaction.options.getString('reminder');

        const timeUnits = {
            'seconds': 1000,
            'minutes': 60 * 1000,
            'hours': 60 * 60 * 1000,
            'days': 24 * 60 * 60 * 1000
        };

        const ms = duration * timeUnits[unit];
        const maxDuration = 30 * 24 * 60 * 60 * 1000;

        if (ms > maxDuration) {
            return interaction.editReply({
                content: '⏰ Whoa there! Max timer length is 30 days.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (ms < 5000) {
            return interaction.editReply({
                content: '⏰ Timer needs to be at least 5 seconds dummy!',
                flags: MessageFlags.Ephemeral
            });
        }

        const endTime = new Date(Date.now() + ms);
        const discordTimestamp = Math.floor(endTime.getTime() / 1000);

        const timer = new Timer({
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            endTime: endTime,
            duration: ms,
            reason: reminder
        });

        try {
            await timer.save();

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('<a:loading:1333357988953460807> Timer Started!')
                .setDescription(reminder ? `**${reminder}**` : 'Your timer is running!')
                .addFields(
                    { name: '⏱ Duration', value: formatTime(ms), inline: true },
                    { name: 'This Pings at', value: `<t:${discordTimestamp}:t>`, inline: true },
                    { name: 'That\'s', value: `<t:${discordTimestamp}:R>`, inline: true }
                )
                .setFooter({ text: 'I\'ll DM you + ping you here when it\'s done!' })
                .setTimestamp();

            const reply = await interaction.editReply({ embeds: [embed] });

            timer.messageId = reply.id;
            await timer.save();

            setTimeout(async () => {
                try {
                    const expiredTimer = await Timer.findById(timer._id);
                    if (!expiredTimer) return;

                    const reminderEmbed = new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('<a:hangingstarts13:1333359147655106581> Time\'s Up!')
                        .setDescription(reminder || 'Your timer has finished!')
                        .addFields(
                            { name: 'Timer Duration', value: formatTime(ms), inline: true },
                            { name: 'Completed', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                        )
                        .setTimestamp();

                    let dmSent = false;
                    try {
                        const user = await interaction.client.users.fetch(interaction.user.id);
                        await user.send({
                            content: '# 🔔 Timer Finished!',
                            embeds: [reminderEmbed]
                        });
                        dmSent = true;
                    } catch (dmError) {
                        console.log(`Could not DM user ${interaction.user.id}:`, dmError.message);
                    }

                    try {
                        const channel = await interaction.client.channels.fetch(interaction.channelId);
                        if (channel) {
                            if (dmSent) {
                                await channel.send({
                                    content: `🔔 <@${interaction.user.id}> Your timer's done! (Check your DMs)`
                                });
                            } else {
                                await channel.send({
                                    content: `🔔 <@${interaction.user.id}> Your timer's up!`,
                                    embeds: [reminderEmbed]
                                });
                            }
                        }
                    } catch (channelError) {
                        console.log('Could not send to channel:', channelError.message);
                    }

                    await Timer.findByIdAndDelete(timer._id);
                } catch (error) {
                    console.error('Timer expiration error:', error);
                }
            }, ms);

        } catch (error) {
            console.error('Timer creation error:', error);
            return interaction.editReply({
                content: '❌ Oops! Something went wrong setting your timer. Try again?',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};