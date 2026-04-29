const { PermissionFlagsBits } = require('discord.js');
const GuildPrefix = require('../../../utils/guildprefix');

module.exports = {
    name: 'setprefix',
    description: 'Set a custom prefix for this server.',
    aliases: ['prefix', 'changeprefix'],
    usage: '!setprefix <new prefix>',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('You need **Administrator** permission to change the prefix!');
        }

        if (!args[0]) {
            const currentPrefix = message.client.prefixCache?.get(message.guild.id) || '!';
            return message.reply(`Current prefix: \`${currentPrefix}\`\nUsage: \`!setprefix <new prefix>\` (must be one character)`);
        }

        const newPrefix = args[0];

        if (newPrefix.length !== 1) {
            return message.reply('The prefix must be exactly **one character**.');
        }

        try {
            await GuildPrefix.findOneAndUpdate(
                { guildId: message.guild.id },
                { prefix: newPrefix },
                { new: true, upsert: true }
            );

            // update the cache
            if (message.client.prefixCache) {
                message.client.prefixCache.set(message.guild.id, newPrefix);
            }

            await message.reply(`Prefix updated to \`${newPrefix}\` successfully!`);
            console.log(`[prefix] updated for guild ${message.guild.id}: ${newPrefix}`);
        } catch (error) {
            console.error(`[prefix] error updating:`, error.message);
            await message.reply('There was an error updating the prefix. Please try again.');
        }
    },
};
