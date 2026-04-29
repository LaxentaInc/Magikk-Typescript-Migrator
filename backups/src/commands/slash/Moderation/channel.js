const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// Store locked channels data
const LOCKS_FILE = path.join(__dirname, '../../../data/channel_locks.json');

// Ensure data directory exists
const dataDir = path.dirname(LOCKS_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Load locks from file
function loadLocks() {
    try {
        if (fs.existsSync(LOCKS_FILE)) {
            return JSON.parse(fs.readFileSync(LOCKS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading channel locks:', e);
    }
    return {};
}

// Save locks to file
function saveLocks(locks) {
    try {
        fs.writeFileSync(LOCKS_FILE, JSON.stringify(locks, null, 2));
    } catch (e) {
        console.error('Error saving channel locks:', e);
    }
}

// Format duration
function formatDuration(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);

    return parts.join(' ') || '0s';
}

// Active timers map (for auto-unlock)
const activeTimers = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('channel')
        .setDescription('Channel management commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand(sub =>
            sub.setName('lock')
                .setDescription('Lock a channel - prevents everyone from sending messages')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to lock (default: current)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Reason for locking')
                        .setMaxLength(200)
                )
                .addIntegerOption(opt =>
                    opt.setName('duration')
                        .setDescription('Auto-unlock after this many minutes (leave empty for permanent)')
                        .setMinValue(1)
                        .setMaxValue(10080) // 7 days max
                )
        )
        .addSubcommand(sub =>
            sub.setName('unlock')
                .setDescription('Unlock a channel - restores previous permissions')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to unlock (default: current)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Reason for unlocking')
                        .setMaxLength(200)
                )
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Check lock status of a channel')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to check (default: current)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const channel = interaction.options.getChannel('channel') || interaction.channel;

        // Check bot permissions
        if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Missing Permissions')
                    .setDescription(`I don't have permission to manage ${channel}`)],
                ephemeral: true
            });
        }

        if (subcommand === 'lock') {
            await handleLock(interaction, channel);
        } else if (subcommand === 'unlock') {
            await handleUnlock(interaction, channel);
        } else if (subcommand === 'status') {
            await handleStatus(interaction, channel);
        }
    }
};

async function handleLock(interaction, channel) {
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const durationMinutes = interaction.options.getInteger('duration');

    const locks = loadLocks();
    const lockKey = `${interaction.guildId}-${channel.id}`;

    // Check if already locked
    if (locks[lockKey]) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Already Locked')
                .setDescription(`${channel} is already locked`)],
            ephemeral: true
        });
    }

    // Save current @everyone permissions before locking
    const everyoneRole = interaction.guild.roles.everyone;
    const currentPerms = channel.permissionOverwrites.cache.get(everyoneRole.id);

    const previousPerms = {
        sendMessages: currentPerms?.allow.has(PermissionFlagsBits.SendMessages) ? true :
            currentPerms?.deny.has(PermissionFlagsBits.SendMessages) ? false : null,
        addReactions: currentPerms?.allow.has(PermissionFlagsBits.AddReactions) ? true :
            currentPerms?.deny.has(PermissionFlagsBits.AddReactions) ? false : null,
        createThreads: currentPerms?.allow.has(PermissionFlagsBits.CreatePublicThreads) ? true :
            currentPerms?.deny.has(PermissionFlagsBits.CreatePublicThreads) ? false : null
    };

    try {
        // Lock the channel
        await channel.permissionOverwrites.edit(everyoneRole, {
            SendMessages: false,
            AddReactions: false,
            CreatePublicThreads: false
        });

        // Save lock data
        const lockData = {
            lockedBy: interaction.user.id,
            lockedAt: Date.now(),
            reason: reason,
            previousPerms: previousPerms,
            expiresAt: durationMinutes ? Date.now() + (durationMinutes * 60 * 1000) : null
        };
        locks[lockKey] = lockData;
        saveLocks(locks);

        // Build response
        const embed = new EmbedBuilder()
            .setTitle('Channel Locked')
            .setDescription(`${channel} has been locked`)
            .addFields(
                { name: 'Reason', value: reason, inline: true },
                { name: 'Locked by', value: `${interaction.user}`, inline: true }
            );

        if (durationMinutes) {
            const expiresAt = Math.floor((Date.now() + durationMinutes * 60 * 1000) / 1000);
            embed.addFields({
                name: 'Auto-unlock',
                value: `<t:${expiresAt}:R>`,
                inline: true
            });

            // Set auto-unlock timer
            const timerId = setTimeout(async () => {
                await autoUnlock(interaction.client, interaction.guildId, channel.id, lockKey);
            }, durationMinutes * 60 * 1000);

            activeTimers.set(lockKey, timerId);
        }

        await interaction.reply({ embeds: [embed] });

        // Also send a message in the locked channel if different
        if (channel.id !== interaction.channelId) {
            await channel.send({
                embeds: [new EmbedBuilder()
                    .setTitle('Channel Locked')
                    .setDescription(`This channel has been locked by ${interaction.user}`)
                    .addFields({ name: 'Reason', value: reason })]
            }).catch(() => { });
        }

    } catch (error) {
        console.error('Lock error:', error);
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Error')
                .setDescription('Failed to lock the channel')],
            ephemeral: true
        });
    }
}

async function handleUnlock(interaction, channel) {
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const locks = loadLocks();
    const lockKey = `${interaction.guildId}-${channel.id}`;
    const lockData = locks[lockKey];

    if (!lockData) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Not Locked')
                .setDescription(`${channel} is not currently locked (or was locked before I started tracking)`)],
            ephemeral: true
        });
    }

    try {
        const everyoneRole = interaction.guild.roles.everyone;
        const prev = lockData.previousPerms;

        // Restore previous permissions
        await channel.permissionOverwrites.edit(everyoneRole, {
            SendMessages: prev.sendMessages,
            AddReactions: prev.addReactions,
            CreatePublicThreads: prev.createThreads
        });

        // Clear any active timer
        if (activeTimers.has(lockKey)) {
            clearTimeout(activeTimers.get(lockKey));
            activeTimers.delete(lockKey);
        }

        // Remove from locks
        delete locks[lockKey];
        saveLocks(locks);

        const lockedDuration = formatDuration(Date.now() - lockData.lockedAt);

        const embed = new EmbedBuilder()
            .setTitle('Channel Unlocked')
            .setDescription(`${channel} has been unlocked`)
            .addFields(
                { name: 'Reason', value: reason, inline: true },
                { name: 'Unlocked by', value: `${interaction.user}`, inline: true },
                { name: 'Was locked for', value: lockedDuration, inline: true }
            );

        await interaction.reply({ embeds: [embed] });

        // Also notify in the unlocked channel if different
        if (channel.id !== interaction.channelId) {
            await channel.send({
                embeds: [new EmbedBuilder()
                    .setTitle('Channel Unlocked')
                    .setDescription(`This channel has been unlocked by ${interaction.user}`)]
            }).catch(() => { });
        }

    } catch (error) {
        console.error('Unlock error:', error);
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Error')
                .setDescription('Failed to unlock the channel')],
            ephemeral: true
        });
    }
}

async function handleStatus(interaction, channel) {
    const locks = loadLocks();
    const lockKey = `${interaction.guildId}-${channel.id}`;
    const lockData = locks[lockKey];

    if (!lockData) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Channel Status')
                .setDescription(`${channel} is **not locked**`)],
            ephemeral: true
        });
    }

    const lockedAt = Math.floor(lockData.lockedAt / 1000);
    const embed = new EmbedBuilder()
        .setTitle('Channel Status')
        .setDescription(`${channel} is **locked**`)
        .addFields(
            { name: 'Locked by', value: `<@${lockData.lockedBy}>`, inline: true },
            { name: 'Locked at', value: `<t:${lockedAt}:R>`, inline: true },
            { name: 'Reason', value: lockData.reason, inline: false }
        );

    if (lockData.expiresAt) {
        const expiresAt = Math.floor(lockData.expiresAt / 1000);
        embed.addFields({
            name: 'Auto-unlock',
            value: `<t:${expiresAt}:R>`,
            inline: true
        });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Auto-unlock function (called by timer)
async function autoUnlock(client, guildId, channelId, lockKey) {
    const locks = loadLocks();
    const lockData = locks[lockKey];

    if (!lockData) return;

    try {
        const guild = await client.guilds.fetch(guildId);
        const channel = await guild.channels.fetch(channelId);
        const everyoneRole = guild.roles.everyone;
        const prev = lockData.previousPerms;

        await channel.permissionOverwrites.edit(everyoneRole, {
            SendMessages: prev.sendMessages,
            AddReactions: prev.addReactions,
            CreatePublicThreads: prev.createThreads
        });

        delete locks[lockKey];
        saveLocks(locks);
        activeTimers.delete(lockKey);

        await channel.send({
            embeds: [new EmbedBuilder()
                .setTitle('Channel Auto-Unlocked')
                .setDescription('Lock duration expired - channel has been automatically unlocked')]
        });

        console.log(`Auto-unlocked channel ${channelId} in guild ${guildId}`);
    } catch (error) {
        console.error('Auto-unlock error:', error);
    }
}

// Restore timers on bot restart
module.exports.restoreTimers = async (client) => {
    const locks = loadLocks();
    const now = Date.now();

    for (const [lockKey, lockData] of Object.entries(locks)) {
        if (lockData.expiresAt) {
            const remaining = lockData.expiresAt - now;
            const [guildId, channelId] = lockKey.split('-');

            if (remaining <= 0) {
                // Already expired, unlock now
                await autoUnlock(client, guildId, channelId, lockKey);
            } else {
                // Set timer for remaining time
                const timerId = setTimeout(async () => {
                    await autoUnlock(client, guildId, channelId, lockKey);
                }, remaining);
                activeTimers.set(lockKey, timerId);
                console.log(`Restored lock timer for channel ${channelId} (${formatDuration(remaining)} remaining)`);
            }
        }
    }
};
