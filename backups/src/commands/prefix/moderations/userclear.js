const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'purgeuser',
    aliases: ['pusr', 'deleteuser', 'cleanusr'],
    description: 'Delete a specific number of messages from a user',
    usage: 'purgeuser <user_id_or_mention> <amount>',
    permissions: [PermissionFlagsBits.ManageMessages],
    
    async execute(message, args) {
        // Permission check
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({
                content: '❌ **You need the "Manage Messages" permission to use this command!**'
            });
        }
        
        // Bot permission check
        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({
                content: '❌ **I need the "Manage Messages" permission to delete messages!**'
            });
        }
        
        // Check arguments
        if (!args || args.length < 2) {
            return message.reply({
                content: '❌ **Usage:** `!purgeuser <user_id_or_mention> <amount>`\n**Example:** `!pusr @user 10` or `!pusr 123456789012345678 99`'
            });
        }
        
        // Parse user ID from mention or direct ID
        let userId = args[0];
        if (userId.startsWith('<@') && userId.endsWith('>')) {
            userId = userId.slice(2, -1);
            if (userId.startsWith('!')) {
                userId = userId.slice(1);
            }
        }
        
        // Validate user ID
        if (!/^\d{17,19}$/.test(userId)) {
            return message.reply({
                content: '❌ **Invalid user ID or mention!**'
            });
        }
        
        // Parse amount with fallback to max 99
        let amount = parseInt(args[1]);
        if (isNaN(amount) || amount < 1) {
            return message.reply({
                content: '❌ **Amount must be a positive number!**'
            });
        }
        
        // Cap at 99 messages max
        if (amount > 99) {
            amount = 99;
        }
        
        try {
            // Fetch the user to get their username for confirmation
            let targetUser;
            try {
                targetUser = await message.client.users.fetch(userId);
            } catch (error) {
                return message.reply({
                    content: '❌ **User not found!**'
                });
            }
            
            const statusMsg = await message.reply({
                content: `**Searching for messages from ${targetUser.username}...**`
            });
            
            // We need to search through more messages to find enough from the target user
            // Start with a reasonable fetch limit
            let fetchLimit = Math.max(amount * 10, 100);
            let allUserMessages = [];
            let lastMessageId = message.id;
            let totalFetched = 0;
            const maxTotalFetch = 2000; // Don't fetch more than 2000 messages total
            
            // Keep fetching until we have enough user messages or hit limits
            while (allUserMessages.length < amount && totalFetched < maxTotalFetch) {
                const batchLimit = Math.min(100, fetchLimit - totalFetched);
                if (batchLimit <= 0) break;
                
                const messages = await message.channel.messages.fetch({ 
                    limit: batchLimit,
                    before: lastMessageId
                });
                
                if (messages.size === 0) break; // No more messages
                
                // Filter messages from the specific user
                const userMessages = messages.filter(msg => msg.author.id === userId);
                allUserMessages.push(...userMessages.values());
                
                totalFetched += messages.size;
                lastMessageId = messages.last().id;
                
                // If we didn't find any user messages in this batch and we already have some, break
                if (userMessages.size === 0 && allUserMessages.length > 0) {
                    break;
                }
            }
            
            if (allUserMessages.length === 0) {
                await statusMsg.edit({
                    content: `**No recent messages found from ${targetUser.username} in this channel!**`
                });
                return;
            }
            
            // Sort by creation time (newest first) and take only the amount requested
            allUserMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
            const messagesToProcess = allUserMessages.slice(0, amount);
            
            // Separate deletable and non-deletable messages
            const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
            const deletableMessages = messagesToProcess.filter(msg => msg.createdTimestamp > fourteenDaysAgo);
            const tooOldMessages = messagesToProcess.filter(msg => msg.createdTimestamp <= fourteenDaysAgo);
            
            if (deletableMessages.length === 0) {
                await statusMsg.edit({
                    content: `**All found messages from ${targetUser.username} are older than 14 days and cannot be deleted!**`
                });
                return;
            }
            
            await statusMsg.edit({
                content: `**Deleting ${deletableMessages.length} message(s) from ${targetUser.username}...**`
            });
            
            // Delete messages efficiently
            let deletedCount = 0;
            
            if (deletableMessages.length === 1) {
                // Single message deletion
                try {
                    await deletableMessages[0].delete();
                    deletedCount = 1;
                } catch (error) {
                    // If single delete fails, just continue
                }
            } else {
                // Try bulk delete first for messages that can be bulk deleted (less than 14 days and multiple)
                const bulkDeletableMessages = deletableMessages.filter(msg => 
                    Date.now() - msg.createdTimestamp < (14 * 24 * 60 * 60 * 1000 - 60000) // 1 minute buffer
                );
                
                if (bulkDeletableMessages.length > 1) {
                    try {
                        const deleted = await message.channel.bulkDelete(bulkDeletableMessages, true);
                        deletedCount += deleted.size;
                    } catch (error) {
                        // If bulk delete fails, fall back to individual deletion
                        for (const msg of bulkDeletableMessages) {
                            try {
                                await msg.delete();
                                deletedCount++;
                                await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit protection
                            } catch (err) {
                                // Skip failed deletions
                            }
                        }
                    }
                }
                
                // Handle any remaining messages that couldn't be bulk deleted
                const remainingMessages = deletableMessages.filter(msg => 
                    !bulkDeletableMessages.includes(msg)
                );
                
                for (const msg of remainingMessages) {
                    try {
                        await msg.delete();
                        deletedCount++;
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit protection
                    } catch (err) {
                        // Skip failed deletions
                    }
                }
            }
            
            // Create result embed
            const embed = new EmbedBuilder()
                .setTitle('User Messages Purged')
                .setColor(deletedCount > 0 ? 0x00FF00 : 0xFF9900)
                .addFields([
                    { name: 'Target User', value: `${targetUser.username} (${targetUser.id})`, inline: true },
                    { name: 'Messages Deleted', value: deletedCount.toString(), inline: true },
                    { name: 'Channel', value: message.channel.toString(), inline: true }
                ])
                .setTimestamp()
                .setFooter({ 
                    text: `Purged by ${message.author.username}`,
                    iconURL: message.author.displayAvatarURL({ dynamic: true })
                });
            
            let description = `Successfully deleted **${deletedCount}** message(s) from ${targetUser.username}`;
            
            if (tooOldMessages.length > 0) {
                description += `\n⚠️ **${tooOldMessages.length}** message(s) were too old to delete (>14 days)`;
            }
            
            if (deletedCount < amount && tooOldMessages.length === 0) {
                description += `\n📝 Only found **${deletedCount}** recent message(s) from this user`;
            }
            
            embed.setDescription(description);
            
            // Update status message with result
            await statusMsg.edit({ content: '', embeds: [embed] });
            
            // Delete confirmation after 15 seconds
            setTimeout(() => {
                statusMsg.delete().catch(() => {});
            }, 15000);
            
        } catch (error) {
            console.error('Error purging user messages:', error);
            
            let errorMessage = '❌ **Something went wrong while purging messages!**';
            
            if (error.code === 50034) {
                errorMessage = '❌ **Some messages were too old to delete (>14 days)!**';
            } else if (error.code === 50013) {
                errorMessage = '❌ **Missing permissions to delete messages!**';
            } else if (error.code === 50035) {
                errorMessage = '❌ **Invalid message or rate limit exceeded!**';
            }
            
            return message.reply({ content: errorMessage });
        }
    }
};