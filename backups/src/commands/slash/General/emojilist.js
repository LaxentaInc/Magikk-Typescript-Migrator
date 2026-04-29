const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

module.exports = {
    name: 'listemoji',
    description: 'Lists all emojis in the server with their details',
    data: new SlashCommandBuilder()
        .setName('listemoji')
        .setDescription('Lists all emojis in the server with their details')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Filter by emoji type')
                .addChoices(
                    { name: 'All', value: 'all' },
                    { name: 'Static', value: 'static' },
                    { name: 'Animated', value: 'animated' }
                )
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Action to perform on emojis')
                .addChoices(
                    { name: 'View Only', value: 'view' },
                    { name: 'Delete', value: 'delete' },
                    { name: 'Copy', value: 'copy' }
                )
                .setRequired(false)
        ),
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            if (!interaction.guild) {
                return interaction.editReply({ content: "kys this command can only be used in a server!" });
            }

            const filterType = interaction.options.getString('type') || 'all';
            const action = interaction.options.getString('action') || 'view';
            let emojis = [...interaction.guild.emojis.cache.values()];

            // Filter logic
            if (filterType === 'static') emojis = emojis.filter(e => !e.animated);
            else if (filterType === 'animated') emojis = emojis.filter(e => e.animated);

            if (emojis.length === 0) {
                return interaction.editReply({ content: ";c No emojis found matching your criteria." });
            }

            // Pagination constants
            const ITEMS_PER_PAGE = 20;
            const totalPages = Math.ceil(emojis.length / ITEMS_PER_PAGE);
            let currentPage = 0;
            let isProcessing = false;

            console.log(`Total emojis: ${emojis.length}, Total pages: ${totalPages}`); // DEBUG

            // Helper to generate embed
            const generateEmbed = (page) => {
                const start = page * ITEMS_PER_PAGE;
                const end = start + ITEMS_PER_PAGE;
                const currentEmojis = emojis.slice(start, end);

                let description = currentEmojis
                    .map(e => `${e} \`${e.name}\` - \`<:${e.name}:${e.id}>\``)
                    .join('\n');

                return new EmbedBuilder()
                    // .setColor('#5865F2')
                    .setTitle(`AHem Server Emojis (${filterType.charAt(0).toUpperCase() + filterType.slice(1)})`)
                    .setDescription(description || 'No emojis here.')
                    .setFooter({
                        text: `Page ${page + 1}/${totalPages} • Total: ${emojis.length} emojis`,
                        iconURL: interaction.guild.iconURL()
                    })
                    .setTimestamp();
            };

            // Helper to generate navigation buttons
            const generateButtons = (page, disabled = false) => {
                // Only show navigation if there's more than 1 page
                if (totalPages <= 1) return null;

                const row = new ActionRowBuilder();

                const firstBtn = new ButtonBuilder()
                    .setCustomId('first')
                    .setEmoji('⏪')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(disabled || page === 0);

                const prevBtn = new ButtonBuilder()
                    .setCustomId('prev')
                    .setEmoji('◀️')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(disabled || page === 0);

                const nextBtn = new ButtonBuilder()
                    .setCustomId('next')
                    .setEmoji('▶️')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(disabled || page >= totalPages - 1);

                const lastBtn = new ButtonBuilder()
                    .setCustomId('last')
                    .setEmoji('⏩')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(disabled || page >= totalPages - 1);

                row.addComponents(firstBtn, prevBtn, nextBtn, lastBtn);
                
                console.log(`Page ${page}, Total pages: ${totalPages}, Next disabled: ${disabled || page >= totalPages - 1}`); // DEBUG
                
                return row;
            };

            // Helper to generate action buttons
            const generateActionButtons = (disabled = false) => {
                const row = new ActionRowBuilder();

                const deleteBtn = new ButtonBuilder()
                    .setCustomId('delete_all')
                    .setLabel('Delete All')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(disabled);

                const copyBtn = new ButtonBuilder()
                    .setCustomId('copy_format')
                    .setLabel('Copy Format')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(disabled);

                row.addComponents(deleteBtn, copyBtn);
                return row;
            };

            // Initial Send
            const components = [];
            const navButtons = generateButtons(currentPage);
            if (navButtons) components.push(navButtons);
            if (action === 'view') {
                components.push(generateActionButtons());
            }

            const message = await interaction.editReply({
                embeds: [generateEmbed(currentPage)],
                components: components
            });

            // Collector
            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 300000 // 5 minutes
            });

            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ content: "NO This is not your command!", ephemeral: true });
                }

                // Prevent multiple simultaneous operations
                if (isProcessing) {
                    return i.reply({ content: "UwUPlease wait for the current operation to complete!", ephemeral: true });
                }

                // Handle pagination
                if (['first', 'prev', 'next', 'last'].includes(i.customId)) {
                    await i.deferUpdate();

                    if (i.customId === 'first') currentPage = 0;
                    if (i.customId === 'prev') currentPage = Math.max(0, currentPage - 1);
                    if (i.customId === 'next') currentPage = Math.min(totalPages - 1, currentPage + 1);
                    if (i.customId === 'last') currentPage = totalPages - 1;

                    console.log(`Navigation: ${i.customId}, New page: ${currentPage}`); // DEBUG

                    const components = [];
                    const navButtons = generateButtons(currentPage);
                    if (navButtons) components.push(navButtons);
                    if (action === 'view') {
                        components.push(generateActionButtons());
                    }

                    await i.editReply({
                        embeds: [generateEmbed(currentPage)],
                        components: components
                    });
                }

                // Handle delete action
                if (i.customId === 'delete_all') {
                    isProcessing = true;
                    collector.stop('action_started');

                    await i.update({
                        embeds: [new EmbedBuilder()
                            // .setColor('#FFA500')
                            .setTitle('Yuh Deleting Emojis...')
                            .setDescription(`Deleting ${emojis.length} emoji(s). Please wait...`)
                            .setTimestamp()],
                        components: []
                    });

                    let deleted = 0;
                    let failed = 0;
                    const errors = [];

                    for (const emoji of emojis) {
                        try {
                            await emoji.delete(`Bulk delete by ${interaction.user.tag}`);
                            deleted++;
                            
                            // Update progress every 5 emojis
                            if (deleted % 5 === 0) {
                                await interaction.editReply({
                                    embeds: [new EmbedBuilder()
                                        .setColor('#FFA500')
                                        .setTitle(' Deleting Emojis...')
                                        .setDescription(`Progress: ${deleted}/${emojis.length} deleted`)
                                        .setTimestamp()]
                                });
                            }
                        } catch (error) {
                            failed++;
                            errors.push(`${emoji.name}: ${error.message}`);
                        }
                    }

                    // Final result
                    const resultEmbed = new EmbedBuilder()
                        .setColor(failed > 0 ? '#FFA500' : '#00FF00')
                        .setTitle('Yawee Deletion Complete')
                        .setDescription(`**Deleted:** ${deleted}\n**Failed:** ${failed}`)
                        .setTimestamp();

                    if (errors.length > 0 && errors.length <= 5) {
                        resultEmbed.addFields({ 
                            name: 'fk Errors', 
                            value: errors.slice(0, 5).join('\n').substring(0, 1024) 
                        });
                    }

                    await interaction.editReply({
                        embeds: [resultEmbed],
                        components: []
                    });
                }

                // Handle copy action
                if (i.customId === 'copy_format') {
                    isProcessing = true;
                    collector.stop('action_started');

                    await i.update({
                        embeds: [new EmbedBuilder()
                            // .setColor('#FFA500')
                            .setTitle('Mmmmhm Generating Copy Format...')
                            .setDescription('pls wait...')
                            .setTimestamp()],
                        components: []
                    });

                    const copyText = emojis
                        .map(e => `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`)
                        .join(' ');

                    // Split into chunks if too long
                    const chunks = [];
                    for (let i = 0; i < copyText.length; i += 1900) {
                        chunks.push(copyText.slice(i, i + 1900));
                    }

                    const resultEmbed = new EmbedBuilder()
                        // .setColor('#00FF00')
                        .setTitle('Yaweee Copy Format Generated')
                        .setDescription(`Generated ${emojis.length} emoji format(s).\nCopy the text below:`)
                        .setTimestamp();

                    await interaction.editReply({
                        embeds: [resultEmbed],
                        components: []
                    });

                    // Send chunks as follow-up messages
                    for (const chunk of chunks) {
                        await interaction.followUp({
                            content: `\`\`\`${chunk}\`\`\``,
                            ephemeral: true
                        });
                    }
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'action_started') return; // Don't disable if action was performed

                // Disable all buttons on timeout
                const disabledComponents = [];
                const navButtons = generateButtons(currentPage, true);
                if (navButtons) disabledComponents.push(navButtons);
                if (action === 'view') {
                    disabledComponents.push(generateActionButtons(true));
                }

                try {
                    await interaction.editReply({ 
                        components: disabledComponents,
                        embeds: [generateEmbed(currentPage).setFooter({
                            text: `Session expired • Page ${currentPage + 1}/${totalPages}`,
                            iconURL: interaction.guild.iconURL()
                        })]
                    });
                } catch (e) {
                    // Interaction might have been deleted
                    console.error('Error disabling buttons:', e);
                }
            });

        } catch (error) {
            console.error('Error in listemoji:', error);
            const errorMessage = "❌ Error executing command: " + error.message;
            
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.editReply({ content: errorMessage, components: [] });
            }
        }
    }
};