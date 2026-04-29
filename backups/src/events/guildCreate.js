/*
=== GUILD CREATE EVENT ===
src/events/guildCreate.js
Sets up spam protection when bot joins a new guild.
*/

const { logger } = require('../utils/logger');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const spamProtection = require('../modules/AntiSpam');

module.exports = {
    name: 'guildCreate',
    async execute(guild, client) {
        try {
            logger.info(`🆕 Joined new guild: ${guild.name} (${guild.id})`);

            // Wait a bit for the guild to be fully loaded
            await new Promise(resolve => setTimeout(resolve, 1000));
            // welcome
            try {
                // Find a suitable channel to send the welcome message
                let channel = guild.systemChannel;
                if (!channel) {
                    // Fallback: look for the first viewable text channel
                    channel = guild.channels.cache.find(c =>
                        c.type === 0 && // GuildText
                        c.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages) &&
                        c.permissionsFor(guild.members.me).has(PermissionFlagsBits.ViewChannel)
                    );
                }

                if (channel) {
                    const DASHBOARD_URL = 'https://www.laxenta.tech/dashboard';
                    const SUPPORT_SERVER = 'https://discord.gg/C9t8dQABgY';

                    const embed = new EmbedBuilder()
                        // .setColor('#5865F2')
                        .setTitle('<a:welcome_1310498060950044712:1342444099449520188> Let\'s Welcome Aero. One that does Everything, From File conv. Antiraid to music! **/help**')
                        .setDescription(`Thanks for inviting **${client.user.username}**! He's here to keep your server safe and entertained, keep them safe and always on top of ALL other roles of admins or people you want to moderate or do not trust.\n\nConfigure the AntiRaid, AntiNuke, AntiBot, AntiSpam, AntiPermission, AgeVerification etc. modules at [Laxenta Inc Dashboard](${DASHBOARD_URL})`)
                        .addFields(
                            {
                                name: '<a:ehe:1376058398403199060> Core Protection Modules',
                                value: '• **Anti-Nuke** - Protects against unauthorized server changes, and admin abuses like kicking/banning members\n• **Anti-Raid** - Prevents mass joins and raids, etc.\n• **Bot Protection** - Blocks unauthorized or unverified bots + punish the adder/strip thier roles etc.\n• **Spam Protection** - Advanced chat filters\n• **Anti-Permission** - Prevents dangerous permission updates\n• **Age Verification** - Prevents underage users, Music and so ON do /help',
                                inline: false
                            },
                            {
                                name: '<a:kittycat:1333358006720794624> Commands & Utilities',
                                value: '• **/help** - View all available commands\n• **/music** - High quality music playback\n• **/** - Detailed event logs',
                                inline: false
                            },
                            {
                                name: '<a:check:1422451073825902684> Important Setup!',
                                value: '> <a:kill94:1333357926202474526> **EXTREMELY IMPORTANT TO READ**: For Safety/Antiraid/PreventionPlease ENSURE Aero has **HIGHEST ROLE** and Permissions **ABOVE** the ROLES of Users you want to moderate or prevent admin abuse!',
                                inline: false
                            }
                        )
                        .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
                        .setImage('https://media.discordapp.net/attachments/1422947616899207280/1439268419298918490/laxenta.jpg')
                        .setFooter({
                            text: 'Made with 💙 by @laxenta',
                            iconURL: guild.members.me.displayAvatarURL()
                        })
                        .setTimestamp();

                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setLabel('Configure Modules')
                                .setStyle(ButtonStyle.Link)
                                .setURL(DASHBOARD_URL)
                                .setEmoji('<a:zzapinkheartexclam_1327982490144:1342442561297711175>'),
                            new ButtonBuilder()
                                .setLabel('Support Server')
                                .setStyle(ButtonStyle.Link)
                                .setURL(SUPPORT_SERVER)
                                .setEmoji('<a:pats_1327965154998095973:1332327251253133383>'),
                            new ButtonBuilder()
                                .setLabel('Read Guide')
                                .setStyle(ButtonStyle.Link)
                                .setURL(`${DASHBOARD_URL}/guide`)
                                .setEmoji('📖')
                        );

                    await channel.send({ embeds: [embed], components: [row] });
                    logger.info(`✅ Sent welcome guide to ${guild.name}`);
                }
            } catch (welcomeError) {
                logger.warn(`Failed to send welcome message to ${guild.name}:`, welcomeError.message);
            }

            // --- EXISTING SPAM PROTECTION SETUP ---
            // Check if spam protection should be enabled for this guild
            if (spamProtection && typeof spamProtection.getConfig === 'function') {
                const config = await spamProtection.getConfig(guild.id);

                if (config.enabled) {
                    if (typeof spamProtection._syncAutoModRules === 'function') {
                        await spamProtection._syncAutoModRules(guild.id, config);
                        logger.info(`Set up spam protection for new guild: ${guild.name}`);
                    }

                    // Note: Removed the old "Spam Protection Active" welcome message in favor of the global guide.
                } else {
                    logger.info(`⏭Spam protection not enabled for new guild: ${guild.name}`);
                }
            }

        } catch (error) {
            logger.error(`Failed to set up spam protection for new guild ${guild.name}:`, {
                message: error.message,
                guildId: guild.id,
                stack: error.stack
            });
        }

        // --- NEW: AUTO-CREATE LOG CHANNEL & UPDATE MODULES ---
        try {
            const { ChannelType } = require('discord.js');
            const logManager = require('../modules/helpers/logManager');
            const apa = require('../modules/APA');
            const antiNuke = require('../modules/AntiNuke');
            const antiSpam = require('../modules/AntiSpam');
            const botProtection = require('../modules/helpers/bot-protection');
            const ageVerify = require('../modules/ageVerify');
            const ama = require('../modules/AMA');

            // Use LogManager to create channels (handles Category placement automatically)
            logger.info(`Creating default channels for ${guild.name}...`);
            const logChannel = await logManager.getLogChannel(guild);
            const alertChannel = await logManager.getAlertChannel(guild); // Also ensure alert channel exists

            if (logChannel) {
                // Update all module configs
                const configUpdate = { logChannelId: logChannel.id };

                await Promise.all([
                    apa.updateConfig(guild.id, configUpdate),
                    antiNuke.updateConfig(guild.id, configUpdate),
                    antiSpam.updateConfig(guild.id, configUpdate),
                    botProtection.updateConfig(guild.id, configUpdate),
                    ageVerify.updateConfig(guild.id, configUpdate),
                    ama.updateConfig(guild.id, configUpdate)
                ]);

                logger.info(`✅ Updated all module configs with log channel for ${guild.name}`);

                // Send confirmation
                const logEmbed = new EmbedBuilder()
                    .setTitle('📝 Log Channel Configured')
                    .setDescription('This channel has been automatically configured as the default log channel for **Anti-Nuke, Anti-Spam, APA, and Bot Protection** modules.')
                    .setColor('#00FF00')
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed] }).catch(() => { });
            }
        } catch (logError) {
            logger.error(`Failed to setup log channel for ${guild.name}:`, logError.message);
        }
    }
};