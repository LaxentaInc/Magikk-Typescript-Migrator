const fs = require('fs').promises;
const path = require('path');
const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { Colors } = require('./constants');
const ticketConfig = require('./ticketConfig');
const { logger } = require('./logger');

class TicketManager {
    constructor() {
        this.tickets = new Map();
        this.dataPath = path.join(process.cwd(), 'data', 'tickets.json');
        this.client = null;
        this.transcriptCooldowns = new Map();
        this.init();
    }

    async init() {
        try {
            await fs.mkdir(path.join(process.cwd(), 'data'), { recursive: true });
            await fs.mkdir(path.join(process.cwd(), 'data', 'transcripts'), { recursive: true });
            await this.loadTickets();
        } catch (error) {
            console.error('Eh error initializing TicketManager:', error);
        }
    }

    setClient(client) {
        this.client = client;
    }

    async loadTickets() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf-8');
            const tickets = JSON.parse(data);
            this.tickets = new Map(Object.entries(tickets));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('Error loading tickets:', error);
            }
            await this.saveTickets();
        }
    }

    async saveTickets() {
        try {
            const ticketData = Object.fromEntries(this.tickets);
            await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
            await fs.writeFile(this.dataPath, JSON.stringify(ticketData, null, 2));
        } catch (error) {
            console.error('Error saving tickets:', error);
        }
    }

    // Permission checking helper function
    hasStaffPermissions(member, guildId) {
        // Server owner always has access
        if (member.guild.ownerId === member.id) {
            return true;
        }

        // Administrator permission always has access
        if (member.permissions.has(PermissionFlagsBits.Administrator)) {
            return true;
        }

        // Check if user has support role
        const config = ticketConfig.getGuildConfig(guildId);
        if (!config || !config.supportRoles || config.supportRoles.length === 0) {
            return false;
        }
        
        return config.supportRoles.some(roleId => member.roles.cache.has(roleId));
    }

    createTicketEmbed(guild, user, description, claimed = false, claimedBy = null) {
        const config = ticketConfig.getGuildConfig(guild.id);
        const embed = new EmbedBuilder()
            .setColor(config.embedSettings.color || Colors.INFO)
            .setTitle('<a:eh:1342443037371928627> Support Ticket!')
            .setDescription(`**__${user.tag}__** **Defined that the Ticket is About**: ` + description)
            .addFields(
                { name: 'Ticket Holder:', value: user.tag, inline: true },
                { name: 'Progress Status:', value: claimed ? `<a:claim:1342443653825826846> Claimed/Handled by ${claimedBy.tag}` : '<a:ep:1333357988953460807> Pending And Unclaimed ;c', inline: true }
            )
            .setTimestamp();

        if (guild.iconURL()) {
            embed.setThumbnail(guild.iconURL());
        }

        return embed;
    }

    createTicketButtons(claimed = false) {
        const buttons = [];

        if (!claimed) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId('ticket_claim')
                    .setLabel('Claim Ticket')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('<a:claim:1332327290599641089>')
            );
        }

        buttons.push(
            new ButtonBuilder()
                .setCustomId('ticket_close')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<a:close:1326464261953818664>'),
            new ButtonBuilder()
                .setCustomId('ticket_transcript')
                .setLabel('Save Transcript')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📑')
        );

        return new ActionRowBuilder().addComponents(buttons);
    }

    async createSetupMessage(channel, config) {
        const embed = new EmbedBuilder()
            .setColor(config.embedSettings.color)
            .setTitle(config.embedSettings.title)
            .setDescription(config.embedSettings.description);

        if (channel.guild.iconURL()) {
            embed.setThumbnail(channel.guild.iconURL());
        }

        const button = new ButtonBuilder()
            .setCustomId('create_ticket')
            .setLabel(config.buttonSettings.label)
            .setStyle(ButtonStyle.Primary)
            .setEmoji(config.buttonSettings.emoji);

        const row = new ActionRowBuilder().addComponents(button);

        return await channel.send({ embeds: [embed], components: [row] });
    }

    async createTicket(guild, user, reason) {
        try {
            // Ensure that the TicketManager client is set
            if (!this.client) {
                this.setClient(guild.client);
            }
            
            const config = ticketConfig.getGuildConfig(guild.id);
            const ticketCount = Array.from(this.tickets.values())
                .filter(t => t.guildId === guild.id).length + 1;
            const channelName = config.ticketSettings.nameFormat.replace('{number}', ticketCount);

            // Get the bot's member using this.client or fallback to guild.client
            const botId = this.client?.user?.id || guild.client.user.id;
            const botMember = guild.members.cache.get(botId) || await guild.members.fetch(botId);

            // Build permission overwrites with explicit types
            const permissionOverwrites = [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                    type: 'role'
                },
                {
                    id: user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                    ],
                    type: 'member'
                },
                {
                    id: botMember.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels,
                    ],
                    type: 'member'
                }
            ];

            // Add support roles – ensure each role is fetched if not cached
            if (config.supportRoles && Array.isArray(config.supportRoles)) {
                for (const roleId of config.supportRoles) {
                    let role = guild.roles.cache.get(roleId);
                    if (!role) {
                        try {
                            role = await guild.roles.fetch(roleId);
                        } catch (e) {
                            console.error(`Failed to fetch role ${roleId}:`, e);
                            continue; // Skip if the role cannot be fetched
                        }
                    }
                    if (role) {
                        permissionOverwrites.push({
                            id: role.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                            ],
                            type: 'role'
                        });
                    }
                }
            }

            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: 0, // Text channel obv
                permissionOverwrites
            });

            const embed = this.createTicketEmbed(guild, user, reason);
            const buttons = this.createTicketButtons();

            const message = await ticketChannel.send({
                content: (config.supportRoles && config.supportRoles.length)
                    ? config.supportRoles.map(role => `<@&${role}>`).join(' ')
                    : null,
                embeds: [embed],
                components: [buttons]
            });

            this.tickets.set(ticketChannel.id, {
                userId: user.id,
                channelId: ticketChannel.id,
                guildId: guild.id,
                reason,
                messages: [],
                status: 'open',
                createdAt: Date.now(),
                messageId: message.id,
                claimed: false,
                claimedBy: null
            });

            await this.saveTickets();
            return ticketChannel;
        } catch (error) {
            console.error('Error creating ticket:', error);
            throw error;
        }
    }

    async claimTicket(channelId, staff) {
        const ticket = this.tickets.get(channelId);
        if (!ticket || ticket.claimed) return { success: false, reason: 'already_claimed' };
        
        // Prevent ticket creator from claiming their own ticket
        if (ticket.userId === staff.id) {
            return { success: false, reason: 'creator' };
        }

        ticket.claimed = true;
        ticket.claimedBy = staff.id;

        const channel = await this.client.channels.fetch(channelId);
        if (!channel) return { success: false, reason: 'channel_not_found' };

        const message = await channel.messages.fetch(ticket.messageId);
        if (!message) return { success: false, reason: 'message_not_found' };

        const embed = this.createTicketEmbed(
            channel.guild,
            await this.client.users.fetch(ticket.userId),
            ticket.reason,
            true,
            staff
        );

        const buttons = this.createTicketButtons(true);
        await message.edit({ embeds: [embed], components: [buttons] });
        await this.saveTickets();

        return { success: true };
    }

    async closeTicket(channelId) {
        try {
            const ticket = this.tickets.get(channelId);
            if (!ticket) return false;

            // Save transcript before closing
            const transcriptPath = await this.saveTranscript(channelId);

            if (transcriptPath) {
                const guild = await this.client.guilds.fetch(ticket.guildId);
                const config = ticketConfig.getGuildConfig(guild.id);

                if (config.transcriptChannel) {
                    const transcriptChannel = await guild.channels.fetch(config.transcriptChannel);
                    if (transcriptChannel) {
                        const transcriptContent = await fs.readFile(transcriptPath, 'utf-8');
                        const transcriptData = JSON.parse(transcriptContent);

                        const transcriptEmbed = new EmbedBuilder()
                            .setColor(Colors.INFO)
                            .setTitle(`Ticket Transcript - #${ticket.channelId}`)
                            .setDescription(`<a:closed:1333353760545833073> Ticket created by <@${ticket.userId}>`)
                            .addFields(
                                { name: 'Reason', value: ticket.reason },
                                { name: 'Status', value: 'Closed' },
                                { name: 'Created At', value: new Date(ticket.createdAt).toLocaleString() }
                            );

                        await transcriptChannel.send({
                            embeds: [transcriptEmbed],
                            files: [transcriptPath]
                        });
                    }
                }
            }

            ticket.status = 'closed';
            await this.saveTickets();
            return true;
        } catch (error) {
            console.error('Error closing ticket:', error);
            return false;
        }
    }

    async saveTranscript(channelId) {
        try {
            if (!this.client) {
                throw new Error('Discord client not initialized in TicketManager');
            }

            const ticket = this.tickets.get(channelId);
            if (!ticket) return null;

            const channel = await this.client.channels.fetch(channelId);
            if (!channel) return null;

            const messages = await channel.messages.fetch();
            const transcript = Array.from(messages.values())
                .reverse()
                .map(msg => ({
                    author: msg.author.tag,
                    content: msg.content,
                    timestamp: msg.createdAt.toISOString(),
                    attachments: Array.from(msg.attachments.values()).map(a => a.url),
                }));

            const transcriptDir = path.join(process.cwd(), 'data', 'transcripts');
            await fs.mkdir(transcriptDir, { recursive: true });

            const transcriptPath = path.join(transcriptDir, `ticket-${channelId}.json`);
            await fs.writeFile(transcriptPath, JSON.stringify({
                ticketInfo: ticket,
                messages: transcript,
            }, null, 2));

            return transcriptPath;
        } catch (error) {
            console.error('Error saving transcript:', error);
            return null;
        }
    }

    // --- Updated Ticket Button Handling Method with Permissions ---
    async handleTicketButton(interaction) {
        try {
            const customId = interaction.customId;

            // Ensure client is initialized when invoked from interactions
            if (!this.client && interaction?.client) {
                this.setClient(interaction.client);
            }

            const ticket = this.tickets.get(interaction.channel.id);
            
            // Verify this is actually a ticket channel
            if (!ticket) {
                await interaction.reply({ content: 'This is not a valid ticket channel.', ephemeral: true });
                return;
            }

            switch (customId) {
                case 'ticket_claim': {
                    // Check if user is the ticket creator
                    if (ticket.userId === interaction.user.id) {
                        await interaction.reply({ content: 'You cannot claim your own ticket! Please wait for a staff member to assist you.', ephemeral: true });
                        return;
                    }

                    // Check if user has staff permissions
                    if (!this.hasStaffPermissions(interaction.member, interaction.guild.id)) {
                        await interaction.reply({ content: 'You do not have permission to claim tickets. Only staff members can claim tickets.', ephemeral: true });
                        return;
                    }

                    const result = await this.claimTicket(interaction.channel.id, interaction.user);
                    if (result && result.success) {
                        await interaction.reply({ content: `Ticket claimed by ${interaction.user.tag}!`, ephemeral: true });
                    } else if (result && result.reason === 'creator') {
                        await interaction.reply({ content: 'You cannot claim your own ticket!', ephemeral: true });
                    } else {
                        await interaction.reply({ content: 'I appreciate the enthusiasm but This ticket cannot be claimed; It might be already claimed or not a valid ticket channel :3', ephemeral: true });
                    }
                    break;
                }
                case 'ticket_close': {
                    // Check if user is the ticket creator
                    if (ticket.userId === interaction.user.id && !this.hasStaffPermissions(interaction.member, interaction.guild.id)) {
                        await interaction.reply({ content: 'You cannot close your own ticket! Please wait for a staff member to close it after resolution.', ephemeral: true });
                        return;
                    }

                    // Check if user has staff permissions
                    if (!this.hasStaffPermissions(interaction.member, interaction.guild.id)) {
                        await interaction.reply({ content: 'You do not have permission to close tickets. Only staff members can close tickets.', ephemeral: true });
                        return;
                    }

                    const success = await this.closeTicket(interaction.channel.id);
                    if (success) {
                        await interaction.reply({ content: '<a:close:1333357988953460807> Automated: Ticket will be closed in 5 seconds...', ephemeral: true });
                        setTimeout(() => {
                            interaction.channel.delete().catch(err => console.error(`Error deleting channel: ${err.message}`));
                        }, 5000);
                    } else {
                        await interaction.reply({ content: '.-. This is not a ticket channel :3 Most Probably', ephemeral: true });
                    }
                    break;
                }
                case 'ticket_transcript': {
                    // Check if user has staff permissions (no longer allow ticket creator alone)
                    if (!this.hasStaffPermissions(interaction.member, interaction.guild.id)) {
                        await interaction.reply({ content: 'You do not have permission to save transcripts. Only support staff, the server owner, or administrators can save transcripts.', ephemeral: true });
                        return;
                    }

                    // Simple cooldown: one transcript per channel per minute
                    const now = Date.now();
                    const last = this.transcriptCooldowns.get(interaction.channel.id) || 0;
                    const cooldownMs = 60_000;
                    if (now - last < cooldownMs) {
                        const remaining = Math.ceil((cooldownMs - (now - last)) / 1000);
                        await interaction.reply({ content: `Please wait ${remaining}s before saving another transcript for this ticket.`, ephemeral: true });
                        return;
                    }
                    this.transcriptCooldowns.set(interaction.channel.id, now);

                    const transcriptPath = await this.saveTranscript(interaction.channel.id);
                    if (transcriptPath) {
                        const guild = interaction.guild;
                        let config = ticketConfig.getGuildConfig(guild.id);
                        let transcriptChannelId = config.transcriptChannel;

                        // Auto-create transcript channel if not configured
                        if (!transcriptChannelId) {
                            const me = guild.members.me || await guild.members.fetch(this.client.user.id);
                            const hasManageChannels = me.permissions.has(PermissionFlagsBits.ManageChannels);

                            if (hasManageChannels) {
                                try {
                                    const created = await guild.channels.create({
                                        name: 'ticket-transcripts',
                                        type: 0 // Text channel
                                    });
                                    transcriptChannelId = created.id;
                                    // Persist to config
                                    config = await ticketConfig.setGuildConfig(guild.id, { ...config, transcriptChannel: transcriptChannelId });
                                } catch (e) {
                                    // If creation fails, fall through to messaging below
                                    console.error('Failed to auto-create transcript channel:', e);
                                }
                            }
                        }

                        if (transcriptChannelId) {
                            const transcriptChannel = await guild.channels.fetch(transcriptChannelId).catch(() => null);
                            if (transcriptChannel) {
                                await transcriptChannel.send({
                                    content: `Ticket Transcript for <#${interaction.channel.id}>`,
                                    files: [transcriptPath]
                                });
                                await interaction.reply({ content: 'Transcript saved and sent.', ephemeral: true });
                            } else {
                                await interaction.reply({ content: 'Transcript channel configured but not found.', ephemeral: true });
                            }
                        } else {
                            const me = guild.members.me || await guild.members.fetch(this.client.user.id);
                            const hasManageChannels = me.permissions.has(PermissionFlagsBits.ManageChannels);
                            if (!hasManageChannels) {
                                await interaction.reply({ content: 'Transcript channel is not configured and I lack permission to create one. Please give me Manage Channels.', ephemeral: true });
                            } else {
                                await interaction.reply({ content: 'Transcript channel is not configured: do /ticket setup', ephemeral: true });
                            }
                        }
                    } else {
                        await interaction.reply({ content: ';c Failed to save transcript.', ephemeral: true });
                    }
                    break;
                }
                default: {
                    await interaction.reply({ content: ';c Unknown ticket button action.', ephemeral: true });
                    break;
                }
            }
        } catch (error) {
            console.error('Error handling ticket button:', error);
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({ content: 'Prob an internal error occurred while processing this ticket action.', ephemeral: true });
            }
        }
    }
}

module.exports = new TicketManager();