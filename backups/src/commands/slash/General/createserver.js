const { SlashCommandBuilder, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const fs = require('fs');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channels')
    .setDescription('Creates a beautiful guild using predefined templates (Administrators only).')
    .addStringOption(option => {
      // Load the JSON templates from the "./templates" folder.
      const templatesPath = path.join(__dirname, '../../../templates/templates.json');
      let templates = {};
      try {
        templates = require(templatesPath);
      } catch (err) {
        console.error('Error loading templates:', err);
      }
      const choices = Object.keys(templates).map(key => ({
        name: `${templates[key].name} (${key})`,
        value: key,
      }));
      return option
        .setName('template')
        .setDescription('Select a guild template')
        .setRequired(true)
        .addChoices(...choices);
    }),
  async execute(interaction) {
    // Ensure the command is used in a guild.
    if (!interaction.guild) {
      const noGuildEmbed = new EmbedBuilder()
        .setColor('#ff4757')
        .setTitle('❌ Guild Only Command')
        .setDescription('This command can only be used in a guild!')
        .setTimestamp();
      
      return interaction.reply({ embeds: [noGuildEmbed], ephemeral: true });
    }

    // Check if user has administrator permissions
    const member = interaction.member;
    const hasAdminPerms = member.permissions.has(PermissionFlagsBits.Administrator);
    const isOwner = interaction.user.id === interaction.guild.ownerId;

    if (!hasAdminPerms && !isOwner) {
      const noPermsEmbed = new EmbedBuilder()
        .setColor('#ff4757')
        .setTitle('🚫 Insufficient Permissions')
        .setDescription('You need **Administrator** permissions to use this command!')
        .setFooter({ text: 'Only administrators can modify guild structure' })
        .setTimestamp();
      
      return interaction.reply({ embeds: [noPermsEmbed], ephemeral: true });
    }

    // If user is admin (but not owner), notify the owner
    if (hasAdminPerms && !isOwner) {
      try {
        const owner = await interaction.guild.fetchOwner();
        const notificationEmbed = new EmbedBuilder()
          .setColor('#ffa502')
          .setTitle('⚠️ Administrator Action Alert')
          .setDescription(`**${interaction.user.tag}** is attempting to use the \`/channels\` command in your guild!`)
          .addFields(
            { name: '👤 User', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
            { name: '🕒 Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
            { name: '🏷️ Template', value: interaction.options.getString('template'), inline: true },
            { name: '🏠 Guild', value: interaction.guild.name, inline: false }
          )
          .setThumbnail(interaction.guild.iconURL() || null)
          .setFooter({ text: 'This is a security notification' })
          .setTimestamp();

        await owner.send({ embeds: [notificationEmbed] });
      } catch (error) {
        console.error('Failed to notify owner:', error);
        
        const dmFailedEmbed = new EmbedBuilder()
          .setColor('#ff4757')
          .setTitle('🔒 Action Blocked')
          .setDescription('The guild owner has their private messages disabled, so I cannot inform them of this risky action.')
          .addFields(
            { name: '📝 What to do?', value: 'Please contact the guild owner directly or ask them to run this command themselves.' },
            { name: '🛡️ Security Notice', value: 'This safeguard prevents unauthorized guild structure changes.' }
          )
          .setFooter({ text: 'Contact your guild owner to proceed' })
          .setTimestamp();
        
        return interaction.reply({ embeds: [dmFailedEmbed], ephemeral: true });
      }
    }

    // Load the templates JSON.
    const templatesPath = path.join(__dirname, '../../../templates/templates.json');
    let templates;
    try {
      templates = require(templatesPath);
    } catch (err) {
      console.error('Error loading templates:', err);
      const errorEmbed = new EmbedBuilder()
        .setColor('#ff4757')
        .setTitle('❌ Template Load Error')
        .setDescription('Failed to load guild templates. Please try again later.')
        .setTimestamp();
      
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }

    const selectedTemplateKey = interaction.options.getString('template');
    const template = templates[selectedTemplateKey];
    if (!template) {
      const notFoundEmbed = new EmbedBuilder()
        .setColor('#ff4757')
        .setTitle('❌ Template Not Found')
        .setDescription('The selected template could not be found.')
        .setTimestamp();
      
      return interaction.reply({ embeds: [notFoundEmbed], ephemeral: true });
    }

    // Create action buttons for purge/extend choice
    const purgeButton = new ButtonBuilder()
      .setCustomId('purge_channels')
      .setLabel('🗑️ Purge & Replace')
      .setStyle(ButtonStyle.Danger);

    const extendButton = new ButtonBuilder()
      .setCustomId('extend_channels')
      .setLabel('➕ Keep & Extend')
      .setStyle(ButtonStyle.Primary);

    const actionRow = new ActionRowBuilder()
      .addComponents(purgeButton, extendButton);

    const choiceEmbed = new EmbedBuilder()
      .setColor('#3742fa')
      .setTitle('🎨 Channel Template Setup')
      .setDescription(`**Template:** ${template.name}\n\nHow would you like to apply this template?`)
      .addFields(
        { name: '🗑️ Purge & Replace', value: 'Delete all existing channels and create new ones from template', inline: false },
        { name: '➕ Keep & Extend', value: 'Keep existing channels and add new ones from template', inline: false }
      )
      .setFooter({ text: 'This choice will expire in 1 minute' })
      .setTimestamp();

    const response = await interaction.reply({ 
      embeds: [choiceEmbed], 
      components: [actionRow], 
      ephemeral: true 
    });

    // Create collector for button interactions
    const collector = response.createMessageComponentCollector({
      time: 60000 // 1 minute
    });

    collector.on('collect', async (buttonInteraction) => {
      if (buttonInteraction.user.id !== interaction.user.id) {
        return buttonInteraction.reply({ content: 'Only the command user can make this choice!', ephemeral: true });
      }

      const shouldPurge = buttonInteraction.customId === 'purge_channels';
      
      await buttonInteraction.update({ 
        embeds: [new EmbedBuilder()
          .setColor('#ffa502')
          .setTitle('⚙️ Processing Template')
          .setDescription(`${shouldPurge ? 'Purging existing channels and creating' : 'Creating'} template channels... please wait!`)
          .setTimestamp()
        ], 
        components: [] 
      });

      try {
        const startTime = Date.now();
        let deletedChannels = 0;
        let deletedCategories = 0;
        let createdChannels = 0;
        let createdCategories = 0;

        // If purge is selected, delete existing channels (except system channels)
        if (shouldPurge) {
          const guild = interaction.guild;
          
          // Get system channel IDs to preserve them
          const systemChannelIds = new Set([
            guild.systemChannelId,
            guild.rulesChannelId,
            guild.publicUpdatesChannelId,
            guild.afkChannelId
          ].filter(Boolean));
          
          // Delete all non-system channels (categories last)
          const regularChannels = guild.channels.cache.filter(channel => 
            !systemChannelIds.has(channel.id) && 
            channel.type !== ChannelType.GuildCategory
          );
          
          const categories = guild.channels.cache.filter(channel => 
            !systemChannelIds.has(channel.id) && 
            channel.type === ChannelType.GuildCategory
          );
          
          // Delete regular channels first
          for (const [, channel] of regularChannels) {
            try {
              await channel.delete('Template purge - clearing existing channels');
              deletedChannels++;
            } catch (err) {
              console.error(`Failed to delete channel ${channel.name}:`, err);
            }
          }
          
          // Then delete empty categories
          for (const [, category] of categories) {
            try {
              await category.delete('Template purge - clearing existing categories');
              deletedCategories++;
            } catch (err) {
              console.error(`Failed to delete category ${category.name}:`, err);
            }
          }
        }

        // Loop through each category defined in the template.
        for (const category of template.categories) {
          // Create the category channel.
          const createdCategory = await interaction.guild.channels.create({
            name: category.name,
            type: ChannelType.GuildCategory,
            reason: 'Guild template creation',
          });
          createdCategories++;

          // Create each child channel under the category.
          for (const channelData of category.channels) {
            let channelType;
            if (channelData.type === 'text') {
              channelType = ChannelType.GuildText;
            } else if (channelData.type === 'voice') {
              channelType = ChannelType.GuildVoice;
            } else {
              continue;
            }

            await interaction.guild.channels.create({
              name: channelData.name,
              type: channelType,
              parent: createdCategory.id,
              reason: 'Guild template creation',
            });
            createdChannels++;
          }
        }

        const endTime = Date.now();
        const executionTime = ((endTime - startTime) / 1000).toFixed(2);

        // Send detailed metrics via DM to avoid the "Unknown Message" error
        const metricsEmbed = new EmbedBuilder()
          .setColor('#2ed573')
          .setTitle('Completed Successfully :3')
          .setDescription(`Guild template **${template.name}** has been successfully applied to **${interaction.guild.name}**!`)
          .addFields(
            { name: '🏠 Guild', value: interaction.guild.name, inline: true },
            { name: '⚡ Execution Time', value: `${executionTime}s`, inline: true },
            { name: '🕒 Completed', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true }
          )
          .setThumbnail(interaction.guild.iconURL())
          .setTimestamp();

        if (shouldPurge) {
          metricsEmbed.addFields(
            { name: '🗑️ Deleted Channels', value: deletedChannels.toString(), inline: true },
            { name: '🗑️ Deleted Categories', value: deletedCategories.toString(), inline: true },
            { name: '📊 Total Purged', value: (deletedChannels + deletedCategories).toString(), inline: true }
          );
        }

        metricsEmbed.addFields(
          { name: '✨ Created Categories', value: createdCategories.toString(), inline: true },
          { name: '📝 Created Channels', value: createdChannels.toString(), inline: true },
          { name: '🎯 Total Created', value: (createdChannels + createdCategories).toString(), inline: true }
        );

        try {
          await buttonInteraction.user.send({ embeds: [metricsEmbed] });
        } catch (dmError) {
          console.error('Failed to send metrics DM:', dmError);
          // If DM fails, try to edit the original reply (if still possible)
          try {
            const fallbackEmbed = new EmbedBuilder()
              .setColor('#2ed573')
              .setTitle('✅ Template Applied!')
              .setDescription(`Template **${template.name}** applied successfully! Check your DMs for detailed metrics.`)
              .setTimestamp();
            
            await buttonInteraction.editReply({ embeds: [fallbackEmbed], components: [] });
          } catch (editError) {
            console.log('Both DM and edit failed - template was applied successfully but user notification failed');
          }
        }

      } catch (error) {
        console.error('Error creating guild template:', error);
        
        // Send error via DM as well
        const errorEmbed = new EmbedBuilder()
          .setColor('#ff4757')
          .setTitle('❌ Template Creation Failed')
          .setDescription(`There was an error applying the template **${template.name}** to **${interaction.guild.name}**.`)
          .addFields(
            { name: '🐛 Error Details', value: error.message || 'Unknown error occurred' },
            { name: '🕒 Failed At', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
          )
          .setTimestamp();
        
        try {
          await buttonInteraction.user.send({ embeds: [errorEmbed] });
        } catch (dmError) {
          console.error('Failed to send error DM:', dmError);
          // Last resort: try to edit reply
          try {
            await buttonInteraction.editReply({ embeds: [errorEmbed], components: [] });
          } catch (editError) {
            console.log('All notification methods failed');
          }
        }
      }
    });

    collector.on('end', async (collected) => {
      if (collected.size === 0) {
        const timeoutEmbed = new EmbedBuilder()
          .setColor('#747d8c')
          .setTitle('⏰ Choice Expired')
          .setDescription('You took too long to make a choice. Please run the command again.')
          .setTimestamp();
        
        try {
          await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
        } catch (error) {
          console.error('Failed to edit reply on timeout:', error);
        }
      }
    });
  },
};