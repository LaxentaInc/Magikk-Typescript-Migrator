// prefix urlscan command — standalone implementation matching the slash command's output

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const axios = require('axios');
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/urlscanner/v2`;
const HEADERS = {
    'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
    'Content-Type': 'application/json'
};

// country flags for display
const countryFlags = {
    'US': '🇺🇸', 'GB': '🇬🇧', 'DE': '🇩🇪', 'FR': '🇫🇷', 'JP': '🇯🇵',
    'CN': '🇨🇳', 'RU': '🇷🇺', 'BR': '🇧🇷', 'IN': '🇮🇳', 'CA': '🇨🇦',
    'AU': '🇦🇺', 'KR': '🇰🇷', 'IT': '🇮🇹', 'ES': '🇪🇸', 'MX': '🇲🇽',
    'NL': '🇳🇱', 'SE': '🇸🇪', 'SG': '🇸🇬', 'IE': '🇮🇪', 'FI': '🇫🇮',
};

module.exports = {
    name: 'urlscan',
    description: 'Scan a URL for threats, malware, and phishing.',
    aliases: ['scan', 'scanurl', 'checksafe', 'checkurl'],
    usage: '!urlscan <url>',
    async execute(message, args) {
        if (!args[0]) {
            return message.reply('please provide a URL to scan! example: `!urlscan https://example.com`');
        }

        if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
            return message.reply('❌ cloudflare credentials are not configured.');
        }

        let url = args[0];
        // auto-add https if no protocol
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

        // basic url validation
        try { new URL(url); } catch {
            return message.reply('❌ that doesn\'t look like a valid URL.');
        }

        const statusMsg = await message.reply({
            embeds: [new EmbedBuilder()
                .setTitle('🔄 Advanced URL Security Analysis')
                .setDescription(`🔍 **initiating security scan**\n\n🔗 **target:** \`${url}\`\n👤 **requested by:** ${message.author.tag}`)
                .setColor('#5865F2')
                .setTimestamp()]
        });

        try {
            // step 1: submit the scan via v2 api
            const submitRes = await axios.post(`${BASE_URL}/scan`, {
                url,
                screenshotsResolutions: ['desktop', 'mobile'],
                visibility: 'unlisted',
            }, { headers: HEADERS, timeout: 10000 });

            const scanId = submitRes.data?.uuid;
            if (!scanId) {
                return statusMsg.edit({ embeds: [new EmbedBuilder().setDescription('❌ failed to submit scan.').setColor(0xff4747)] });
            }

            // step 2: update status
            await statusMsg.edit({
                embeds: [new EmbedBuilder()
                    .setTitle('🔍 Advanced URL Security Analysis')
                    .setDescription(`📋 **scan ID:** \`${scanId}\`\n⏱️ **status:** analysis in progress...\n🔍 **type:** deep security scan`)
                    .setColor('#5865F2')
                    .setTimestamp()]
            }).catch(() => { });

            // step 3: poll for results (v2 api, max 60s)
            let result = null;
            for (let attempt = 0; attempt < 12; attempt++) {
                await new Promise(r => setTimeout(r, 5000));

                try {
                    const resultRes = await axios.get(`${BASE_URL}/result/${scanId}`, {
                        headers: HEADERS,
                        timeout: 10000
                    });

                    if (resultRes.status === 200) {
                        result = resultRes.data;
                        break;
                    }
                } catch (err) {
                    if (err.response?.status !== 404) throw err;
                    // 404 = not ready yet, keep polling
                }

                // progress update
                await statusMsg.edit({
                    embeds: [new EmbedBuilder()
                        .setTitle('🔍 Advanced URL Security Analysis')
                        .setDescription(`📋 **scan ID:** \`${scanId}\`\n⏱️ **elapsed:** ${(attempt + 1) * 5} seconds\n🔍 analyzing page content...`)
                        .setColor('#5865F2')
                        .setTimestamp()]
                }).catch(() => { });
            }

            if (!result) {
                return statusMsg.edit({
                    embeds: [new EmbedBuilder().setDescription('⏰ scan timed out.').setColor(0xffa500)]
                });
            }

            // step 4: build rich result embed (matching slash command output)
            const scan = result;
            const verdict = getVerdict(scan.verdicts);
            const embed = new EmbedBuilder()
                .setTitle('🖥️ Security Scan Complete')
                .setURL(scan.page?.url || scan.task?.url || url)
                .setColor(verdict.color)
                .setTimestamp();

            // verdict
            embed.addFields({
                name: '🎯 Security Analysis Result',
                value: `${verdict.style}\n*${verdict.description}*`,
                inline: false
            });

            // url info
            const urlInfo = [];
            if (scan.task?.url) urlInfo.push(`**scanned:**\n\`\`\`${scan.task.url}\`\`\``);
            if (scan.page?.url && scan.page.url !== scan.task?.url) urlInfo.push(`**redirected to:** \`${scan.page.url}\``);
            if (scan.page?.title) urlInfo.push(`**page title:** ${scan.page.title}`);
            if (urlInfo.length > 0) {
                embed.addFields({ name: '🔗 URL Information', value: urlInfo.join('\n'), inline: false });
            }

            // infrastructure
            if (scan.page) {
                const serverInfo = [];
                const flag = countryFlags[scan.page.country] || '🌍';
                const country = scan.page.country || 'unknown';
                const city = scan.page.city || '';
                serverInfo.push(`**location:** ${flag} ${country}${city ? ` (${city})` : ''}`);
                if (scan.page.ip) serverInfo.push(`**IP address:** \`${scan.page.ip}\``);
                if (scan.page.asn) serverInfo.push(`**ASN:** AS${scan.page.asn}${scan.page.asnname ? ` (${scan.page.asnname})` : ''}`);
                if (scan.page.server) serverInfo.push(`**server:** ${scan.page.server}`);
                embed.addFields({ name: '🖧 Infrastructure', value: serverInfo.join('\n'), inline: false });
            }

            // security analysis
            const securityInfo = [];
            if (scan.page?.tlsIssuer) {
                securityInfo.push(`🔒 **SSL/TLS:** yes (${scan.page.tlsIssuer})`);
            } else {
                securityInfo.push(`🔓 **SSL/TLS:** not detected`);
            }
            if (scan.meta?.processors?.radarRank?.data?.[0]?.rank) {
                securityInfo.push(`📊 **popularity:** #${scan.meta.processors.radarRank.data[0].rank.toLocaleString()} globally`);
            }
            if (scan.stats?.securePercentage !== undefined) {
                securityInfo.push(`🛡️ **secure requests:** ${Math.round(scan.stats.securePercentage)}%`);
            }
            if (securityInfo.length > 0) {
                embed.addFields({ name: '🔐 Security Analysis', value: securityInfo.join('\n'), inline: true });
            }

            // performance
            if (scan.data?.performance) {
                const perf = scan.data.performance;
                const loadTime = perf.loadEventEnd - perf.fetchStart;
                const domReady = perf.domContentLoadedEventEnd - perf.fetchStart;
                const fmtMs = (ms) => (ms == null || isNaN(ms)) ? 'n/a' : `${Math.round(ms)}ms`;
                embed.addFields({
                    name: '⚡ Performance',
                    value: `• DOM ready: ${fmtMs(domReady)}\n• full load: ${fmtMs(loadTime)}\n• resources: ${scan.data?.requests?.length || 0} requests`,
                    inline: true
                });
            }

            // categories
            if (scan.meta?.processors?.domainCategories?.data) {
                const cats = scan.meta.processors.domainCategories.data;
                const catStr = cats.map(c => typeof c === 'string' ? c : c.name || 'unknown').join(', ');
                if (catStr) embed.addFields({ name: '📂 Categories', value: catStr, inline: false });
            }

            // phishing alert
            if (scan.meta?.processors?.phishing?.data?.length > 0) {
                embed.addFields({
                    name: '🎣 ⚠️ PHISHING ALERT',
                    value: `**target brands:** ${scan.meta.processors.phishing.data.join(', ')}\n⚠️ this site appears to be impersonating legitimate services!`,
                    inline: false
                });
            }

            // external domains
            if (scan.lists?.domains?.length > 0) {
                const domains = scan.lists.domains.slice(0, 8).map(d => {
                    const name = typeof d === 'string' ? d : (d.name || d.domain || d);
                    return `• ${name}`;
                }).join('\n');
                const remaining = scan.lists.domains.length - 8;
                embed.addFields({
                    name: `🌐 External Domains (${scan.lists.domains.length} total)`,
                    value: domains + (remaining > 0 ? `\n*+${remaining} more...*` : ''),
                    inline: false
                });
            }

            // network stats
            if (scan.stats) {
                const netStats = [];
                if (scan.stats.uniqCountries) netStats.push(`🌍 countries: ${scan.stats.uniqCountries}`);
                if (scan.stats.uniqIPs) netStats.push(`📍 unique IPs: ${scan.stats.uniqIPs}`);
                if (scan.stats.totalLinks) netStats.push(`🔗 total links: ${scan.stats.totalLinks}`);
                if (netStats.length > 0) {
                    embed.addFields({ name: '📊 Network Statistics', value: netStats.join(' • '), inline: false });
                }
            }

            embed.setFooter({ text: `scan ID: ${scanId} • unlisted • powered by cloudflare` });

            // try to set screenshot
            const screenshotUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/urlscanner/v2/screenshots/${scanId}.png?resolution=desktop`;
            embed.setImage(screenshotUrl);

            // action row with links
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Full Report')
                    .setURL(`https://radar.cloudflare.com/scan/${scanId}`)
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('📊'),
                new ButtonBuilder()
                    .setLabel('Screenshot')
                    .setURL(screenshotUrl)
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('📸'),
                new ButtonBuilder()
                    .setLabel('Mobile View')
                    .setURL(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/urlscanner/v2/screenshots/${scanId}.png?resolution=mobile`)
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('📱')
            );

            await statusMsg.edit({ embeds: [embed], components: [row] });

        } catch (error) {
            console.error('[urlscan] error:', error.message);
            let errMsg = 'scan failed.';
            if (error.response?.status === 429) errMsg = 'rate limited! try again in a minute.';
            else if (error.response?.status === 400) errMsg = 'invalid URL or scan request.';
            await statusMsg.edit({
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Scan Failed')
                    .setDescription(errMsg)
                    .setColor('#F92F60')
                    .addFields({ name: '💡 troubleshooting', value: '• ensure URL is valid\n• check if the site is publicly accessible\n• try just the domain without paths\n• some sites block automated scans' })
                    .setTimestamp()]
            }).catch(() => { });
        }
    },
};

// verdict logic matching the slash command exactly
function getVerdict(verdicts) {
    if (!verdicts?.overall) return { style: '❓ **UNKNOWN**', description: 'could not determine verdict', color: '#808080' };
    if (verdicts.overall.malicious) return { style: '🚨 **MALICIOUS**', description: 'confirmed threats detected — do NOT visit this site', color: '#FF0000' };
    if (verdicts.overall.phishing) return { style: '🎣 **PHISHING**', description: 'this site is impersonating a legitimate service', color: '#FF0000' };
    if (verdicts.overall.categories?.includes('phishing')) return { style: '🎣 **PHISHING**', description: 'phishing activity detected', color: '#FF0000' };
    if (verdicts.overall.categories?.includes('malware')) return { style: '🚨 **MALWARE**', description: 'malware distribution detected', color: '#FF0000' };
    if (verdicts.overall.suspicious) return { style: '⚠️ **SUSPICIOUS**', description: 'potential risks found — proceed with caution', color: '#FFA500' };
    return { style: '🛡️ **Verdict:** ✅ Analyzed & Clean', description: 'no malicious activity detected', color: '#00D26A' };
}
