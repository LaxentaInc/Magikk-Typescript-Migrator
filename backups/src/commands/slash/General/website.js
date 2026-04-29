const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Access Aero\'s web dashboard!')
        .setIntegrationTypes(0, 1)
        .setContexts(0, 1, 2),
    
    async execute(interaction) {
        const DASHBOARD_URL = 'https://www.laxenta.tech/dashboard';
        const SUPPORT_SERVER = 'https://discord.gg/C9t8dQABgY';
        
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('<a:ehe:1310498098107387974> Aero\'s Web Dashboard')
            .setDescription(`Control **${interaction.client.user.username}** from your browser with our powerful web dashboard!`)
            .addFields(
                { 
                    name: '<a:ehe:1376058398403199060> Security & Moderation', 
                    value: '• **Anti Mass Action, permission checks, spam check, OCR Protection etc.** - Prevent mass kicks/bans/ADMIN Abuse\n• **Bot Protection** - Block suspicious bots\n• **Anti-Nuke** - Server raid protection\n• **No Admin Abuse** - Monitor role changes\n• **Spam Protection** - Advanced spam detection',
                    inline: false 
                },
                {
                    name: '<a:kittycat:1333358006720794624> Modules Available',
                    value: '• Configure punishments\n• Set trusted users & roles\n• View logs & analytics\n• Manage thresholds & timeouts\n• Real-time protection status',
                    inline: false
                },
                {
                    name: '<a:Love:1333357974751678524> Coming Soon',
                    value: '• Unified CyberSec APIS on website\n• Link support for music + local file support\n• Advanced utilities for spoofing and AI/ML detections (or anything you /suggest)',
                    inline: false
                }
            )
            .setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }))
            .setImage('https://media.discordapp.net/attachments/1422947616899207280/1439268419298918490/laxenta.jpg')
            .setFooter({ 
                text: 'Made with 💙 by @me_straight', 
                iconURL: interaction.user.displayAvatarURL() 
            })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Open Dashboard')
                    .setStyle(ButtonStyle.Link)
                    .setURL(DASHBOARD_URL)
                    .setEmoji('<a:zzapinkheartexclam_1327982490144:1342442561297711175>'),
                new ButtonBuilder()
                    .setLabel('Support Server')
                    .setStyle(ButtonStyle.Link)
                    .setURL(SUPPORT_SERVER)
                    .setEmoji('<a:pats_1327965154998095973:1332327251253133383>'),
                new ButtonBuilder()
                    .setLabel('Guide')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${DASHBOARD_URL}/guide`)
                    .setEmoji('📖')
            );

        await interaction.reply({ 
            embeds: [embed], 
            components: [row],
            ephemeral: false
        });
    },
};