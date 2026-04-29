const {
    PermissionsBitField,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { registerButton } = require('../../../handlers/buttonHandler');

module.exports = {
    name: 'tempban',
    description: 'Temporarily ban a user for a specified duration.',
    aliases: ['tban'],
    usage: '!tempban <@user> <duration> [reason]',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            return message.reply(
                '<a:no:1332327203106717736> You do not have permission to ban members!'
            );
        }

        if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            return message.reply(
                '<a:no:1332327203106717736> I lack the necessary permissions to ban members!'
            );
        }

        const userToBan = message.mentions.users.first();
        if (!userToBan) {
            return message.reply(
                'Please mention a user to tempban! Example: `!tempban @user 1h reason`'
            );
        }

        if (userToBan.id === message.author.id) {
            return message.reply('You cannot tempban yourself!');
        }

        if (!args[1]) {
            return message.reply('Please provide a duration! Example: `!tempban @user 1h reason`');
        }

        // parse duration from args[1]
        const durationStr = args[1];
        const durationMs = parseDuration(durationStr);

        if (!durationMs || durationMs <= 0) {
            return message.reply('Invalid duration! Use formats like: 5m, 1h, 2d, 1w');
        }

        const reason = args.slice(2).join(' ') || 'No reason provided.';
        const member = await message.guild.members.fetch(userToBan.id).catch(() => null);

        // hierarchy check
        if (member) {
            if (member.roles.highest.position >= message.guild.members.me.roles.highest.position) {
                return message.reply('I cannot ban this user — my role is too low.');
            }
            if (member.roles.highest.position >= message.member.roles.highest.position && message.author.id !== message.guild.ownerId) {
                return message.reply('You cannot ban someone with an equal or higher role.');
            }
        }

        const confirmEmbed = new EmbedBuilder()
            .setColor('#FFCC00')
            .setTitle('<a:eh:1327965185490550794> Temporary Ban Confirmation')
            .setThumbnail(userToBan.displayAvatarURL({ dynamic: true }))
            .setDescription(`Are you sure you want to temporarily ban **${userToBan.tag}** for **${durationStr}**?`)
            .addFields(
                { name: 'Reason', value: reason },
                { name: 'Duration', value: durationStr },
                { name: 'Warning', value: 'You have 30 seconds to confirm.' }
            )
            .setFooter({ text: `Action by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() });

        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`confirmTempban-${message.id}`)
                .setLabel('Confirm')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`cancelTempban-${message.id}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        const confirmMsg = await message.reply({
            embeds: [confirmEmbed],
            components: [buttonRow],
        });

        const authorId = message.author.id;

        registerButton(`confirmTempban-${message.id}`, [authorId], async (interaction) => {
            try {
                await deferSafe(interaction);

                // save to mongodb for persistence
                const mongoose = require('mongoose');
                const TempBan = mongoose.models.TempBan || mongoose.model('TempBan', new mongoose.Schema({
                    guildId: { type: String, required: true },
                    userId: { type: String, required: true },
                    endTime: { type: Date, required: true },
                }));

                const endTime = new Date(Date.now() + durationMs);
                await TempBan.create({
                    guildId: message.guild.id,
                    userId: userToBan.id,
                    endTime,
                });

                await message.guild.members.ban(userToBan.id, { reason });

                await editSafe(interaction, {
                    content: `<a:done:1327965185490550794> **${userToBan.tag}** has been temporarily banned for **${durationStr}**\nReason: ${reason}`,
                    embeds: [],
                    components: [],
                });

                // schedule unban
                setTimeout(async () => {
                    try {
                        await message.guild.members.unban(userToBan.id);
                        console.log(`[tempban] unbanned ${userToBan.tag} after ${durationStr}`);
                        await TempBan.deleteOne({ guildId: message.guild.id, userId: userToBan.id });
                    } catch (err) {
                        console.error(`[tempban] error unbanning ${userToBan.tag}:`, err.message);
                    }
                }, durationMs);

            } catch (error) {
                console.error(error);
                await editSafe(interaction, {
                    content: '❌ Failed to tempban. Check my permissions.',
                    embeds: [],
                    components: [],
                });
            }
        });

        registerButton(`cancelTempban-${message.id}`, [authorId], async (interaction) => {
            try {
                await deferSafe(interaction);
                await editSafe(interaction, {
                    content: 'Temporary ban cancelled.',
                    embeds: [],
                    components: [],
                });
            } catch (error) {
                console.error(`cancel button error: ${error.message}`);
            }
        });
    },
};

// parse duration string to milliseconds
function parseDuration(str) {
    const match = str.match(/^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|day|days?|w|week|weeks?)$/i);
    if (!match) return null;

    const val = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    const multipliers = {
        s: 1000, sec: 1000, second: 1000, seconds: 1000,
        m: 60000, min: 60000, minute: 60000, minutes: 60000,
        h: 3600000, hr: 3600000, hour: 3600000, hours: 3600000,
        d: 86400000, day: 86400000, days: 86400000,
        w: 604800000, week: 604800000, weeks: 604800000,
    };

    return val * (multipliers[unit] || 0);
}

async function deferSafe(interaction) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(() => { });
    }
}

async function editSafe(interaction, options) {
    try {
        await interaction.editReply(options);
    } catch {
        console.warn('failed to edit tempban interaction reply.');
    }
}
