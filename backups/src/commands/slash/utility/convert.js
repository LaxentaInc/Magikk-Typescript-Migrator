const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Temporary directory for conversions
const TEMP_DIR = path.join(__dirname, '../../../temp/conversions');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Supported conversion mappings (VERIFIED working formats only)
const CONVERSIONS = {
    video: {
        formats: ['mp4', 'webm', 'gif'],
        from: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'm4v', 'gif'] // GIF videos to other formats
    },
    audio: {
        formats: ['mp3', 'wav', 'ogg'],
        from: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'webm']
    },
    image: {
        formats: ['png', 'jpg', 'webp'],
        from: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] // Removed GIF - treat as video instead
    }
};

function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

function getAvailableFormats(inputExt) {
    const formats = new Set();

    for (const [type, data] of Object.entries(CONVERSIONS)) {
        if (data.from.includes(inputExt)) {
            data.formats.forEach(fmt => formats.add(fmt));
        }
    }

    return Array.from(formats).filter(f => f !== inputExt);
}

function downloadFile(url, filepath) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(filepath);

        client.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(filepath, () => { });
            reject(err);
        });
    });
}

function convertFile(inputPath, outputPath, outputFormat) {
    return new Promise((resolve, reject) => {
        const args = ['-i', inputPath];

        // Format-specific optimizations
        if (outputFormat === 'gif') {
            args.push(
                '-vf', 'fps=15,scale=480:-1:flags=lanczos',
                '-loop', '0'
            );
        } else if (outputFormat === 'mp4') {
            args.push(
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '128k'
            );
        } else if (outputFormat === 'webm') {
            args.push(
                '-c:v', 'libvpx',
                '-crf', '10',
                '-b:v', '1M',
                '-c:a', 'libvorbis'
            );
        } else if (outputFormat === 'mp3') {
            args.push(
                '-c:a', 'libmp3lame',
                '-b:a', '192k'
            );
        } else if (outputFormat === 'wav') {
            args.push(
                '-c:a', 'pcm_s16le'
            );
        }

        args.push('-y', outputPath);

        const ffmpeg = spawn(ffmpegPath, args);
        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                resolve();
            } else {
                reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-200)}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(err);
        });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('convert')
        .setDescription('Convert media files to different formats')
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1)
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('The file to convert')
                .setRequired(true)
        ),

    async execute(interaction) {
        const attachment = interaction.options.getAttachment('file');
        const DASHBOARD_URL = 'https://www.laxenta.tech/premium';

        // Check file size (25MB limit for free tier)
        if (attachment.size > 25 * 1024 * 1024) {
            const premiumEmbed = new EmbedBuilder()
                .setTitle('<a:Love:1333357974751678524> Upgrade to Premium!')
                .setDescription(`**Whoops!** That file is too big for the free tier.\n\nFree users are limited to **25MB** per file.\nWant to convert files up to **500MB**? Unlock truly unlimited power!`)
                .addFields(
                    { name: '<a:kittycat:1333358006720794624> Premium Perks', value: '• **500MB** Upload Limit\n• **Faster** Processing Speed\n• **Priority** Queue Access\n• **4K** Video Support', inline: false }
                )
                .setColor(0xF47FFF)
                .setThumbnail('https://media.discordapp.net/attachments/1422947616899207280/1439268419298918490/laxenta.jpg')
                .setFooter({ text: 'Aero Premium • Unlock the full potential', iconURL: interaction.client.user.displayAvatarURL() });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Get Premium')
                    .setStyle(ButtonStyle.Link)
                    .setURL(DASHBOARD_URL)
                    .setEmoji('<a:zzapinkheartexclam_1327982490144:1342442561297711175>')
            );

            return interaction.reply({ embeds: [premiumEmbed], components: [row], ephemeral: true });
        }

        const inputExt = getFileExtension(attachment.name);
        const availableFormats = getAvailableFormats(inputExt);

        if (availableFormats.length === 0) {
            return interaction.reply({
                content: `**Unsupported Format!** I cannot convert \`.${inputExt}\` files. Supported: mp4, webm, mov, avi, mkv, mp3, wav, ogg, png, jpg, gif`,
                ephemeral: true
            });
        }

        // Create dropdown menu
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`convert_${interaction.user.id}_${Date.now()}`)
            .setPlaceholder('Choose output format...')
            .addOptions(
                availableFormats.map(format => ({
                    label: `Convert to ${format.toUpperCase()}`,
                    value: format,
                    description: `Transcode file to .${format}`,
                    emoji: '<a:loading_1310498088724729876:1342443735039868989>'
                }))
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('<a:ehe:1310498098107387974> File Conversion')
            .setDescription(`Ready to convert **${attachment.name}**!\n\n**File Info:**\n Size: \`${(attachment.size / 1024 / 1024).toFixed(2)} MB\`\n Type: \`.${inputExt.toUpperCase()}\``)
            .addFields({ name: 'Available Formats for this attachment', value: availableFormats.map(f => `\`${f.toUpperCase()}\``).join(', '), inline: false })
            .setThumbnail(attachment.contentType?.startsWith('image') ? attachment.url : null)
            .setTimestamp();

        const response = await interaction.reply({ embeds: [embed], components: [row] });

        // Store conversion data
        const conversionData = {
            userId: interaction.user.id,
            attachmentUrl: attachment.url,
            originalName: attachment.name,
            inputExt: inputExt
        };

        // Listen for menu selection
        const filter = i => i.customId.startsWith('convert_') && i.user.id === interaction.user.id;
        const collector = response.createMessageComponentCollector({
            filter,
            time: 300000, // 5 minutes
            max: 1
        });

        collector.on('collect', async i => {
            await i.deferUpdate();

            const outputFormat = i.values[0];
            const timestamp = Date.now();
            const inputPath = path.join(TEMP_DIR, `input_${timestamp}.${inputExt}`);
            const outputPath = path.join(TEMP_DIR, `output_${timestamp}.${outputFormat}`);

            try {
                // UI: Processing State
                const processingEmbed = new EmbedBuilder()
                    .setTitle('<a:loading_1310498088724729876:1342443735039868989> Converting Media...')
                    .setDescription(`**Processing:** \`${attachment.name}\`\n**Target:** \`.${outputFormat.toUpperCase()}\`\n\n*This might take a few seconds depending on file size.*`)
                    .setColor(0xFEE75C);

                await i.editReply({ embeds: [processingEmbed], components: [] });

                // Download file
                await downloadFile(conversionData.attachmentUrl, inputPath);

                // Convert file using modern spawn approach
                await convertFile(inputPath, outputPath, outputFormat);

                // Check output size
                const stats = fs.statSync(outputPath);
                if (stats.size > 25 * 1024 * 1024) {
                    throw new Error(`Output too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB (Discord limit: 25MB)`);
                }

                // Send converted file
                const outputFilename = conversionData.originalName.replace(/\.[^/.]+$/, '') + '.' + outputFormat;
                const fileAttachment = new AttachmentBuilder(outputPath, { name: outputFilename });

                const successEmbed = new EmbedBuilder()
                    .setTitle('<a:verified:1342443653825826846> Conversion Complete!')
                    .setDescription(`Successfully converted to **${outputFormat.toUpperCase()}**`)
                    .addFields(
                        { name: 'Input', value: `\`${attachment.name}\`\n${(attachment.size / 1024 / 1024).toFixed(2)} MB`, inline: true },
                        { name: 'Output', value: `\`${outputFilename}\`\n${(stats.size / 1024 / 1024).toFixed(2)} MB`, inline: true }
                    )
                    .setColor(0x57F287)
                    .setTimestamp();

                await i.editReply({
                    embeds: [successEmbed],
                    files: [fileAttachment],
                    components: []
                });

            } catch (error) {
                console.error('Conversion error:', error);

                const errorEmbed = new EmbedBuilder()
                    .setTitle('<a:Warning:1326464273467179130> Conversion Failed')
                    .setDescription(`**Error:** ${error.message}\n\nThis format combination may not be supported or the file may be corrupted.`)
                    .setColor(0xED4245);

                try {
                    await i.editReply({ embeds: [errorEmbed], components: [] });
                } catch (e) { }

            } finally {
                // Cleanup files
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                const timeoutEmbed = new EmbedBuilder()
                    .setTitle('⏱ NUuuuuu Interaction Timed Out')
                    .setDescription('You didn\'t select a format in time.')
                    .setColor(0x2B2D31);

                interaction.editReply({ embeds: [timeoutEmbed], components: [] }).catch(() => { });
            }
        });
    },
};
