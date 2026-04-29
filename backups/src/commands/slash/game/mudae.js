const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const economy = require('../../../utils/economyUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mudae')
        .setDescription('Mudae and Economy System')
                .setIntegrationTypes(0, 1)
                .setContexts(0, 1, 2)
        .addSubcommand(subcommand =>
            subcommand
                .setName('help')
                .setDescription('Shows the guide for the economy and waifu system')
        ),
    async execute(interaction) {
        if (interaction.options.getSubcommand() === 'help') {
            const economyDir = path.join(__dirname, '../../../commands/prefix/economy');
            const commands = [];

            try {
                const files = fs.readdirSync(economyDir).filter(file => file.endsWith('.js'));
                for (const file of files) {
                    const command = require(path.join(economyDir, file));
                    if (command.name && command.description) {
                        commands.push({
                            name: command.name,
                            aliases: command.aliases || [],
                            description: command.description
                        });
                    }
                }
            } catch (err) {
                console.error("Error reading economy commands:", err);
            }

            const balance = await economy.getBalance(interaction.user.id);

            const embed = new EmbedBuilder()
                .setColor('#FF69B4')
                .setTitle('🌸 Mudae & Economy Guide 🌸')
                .setDescription(`Welcome to the new economy! It works in Globally in all servers. Here is how you can earn money, gamble, and marry your favorite characters.\n\n**Current Balance:** ${economy.formatCurrency(balance)}`)
                .addFields({
                    name: 'Earning Money',
                    value: '`!daily` - Claim your daily reward (10k)\n`!work` - Work a shift (1k-5k, 1h cooldown)\n`!cf <bet>` - Coin flip (Max 100k)\n`!slots <bet>` - Play slots (Max 100k)'
                })
                .addFields({
                    name: 'Waifu System',
                    value: '`!mudae` (or `!w`) - Roll for a waifu to marry.\nCosts range from **20k to 150k** depending on luck.\nRare waifus cost more but are worth the flex!'
                })
                      .addFields({
                    name: 'Marriages List',
                    value: '`!harem` (or `!hm` // `!hmudae` // `!mh`) - View your marriages'
                })
                .addFields({
                    name: 'Utility',
                    value: '`!balance` - Check wallet\n`!pay @user <amount>` - Transfer funds\n`!leaderboard` - See top 10 richest users'
                })
                .setFooter({ text: 'Economy System' });

            // If we want to list all commands dynamically as requested:
            const commandList = commands.map(cmd => {
                const aliases = cmd.aliases.length > 0 ? ` [${cmd.aliases.join(', ')}]` : '';
                return `**!${cmd.name}${aliases}**\n${cmd.description}`;
            }).join('\n\n');
            // Add a field for "All Commands" if it fits, or just rely on the curated lists above which look better.
            // The user asked to "recursively loads it from this dir".
            // Let's add a "Detailed Command List" field.

            const detailedField = {
                name: 'All Commands',
                value: commandList.length > 1024 ? commandList.substring(0, 1021) + '...' : commandList
            };

            embed.addFields(detailedField);

            await interaction.reply({ embeds: [embed] });
        }
    }
};
