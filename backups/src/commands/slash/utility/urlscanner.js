const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const { logger } = require('../../../utils/logger');

// Environment variables
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;

// Rate limiting
const scanRateLimit = new Map();
const RATE_LIMIT_DURATION = 60000;
const MAX_SCANS_PER_USER = 5;

// Status emojis
const statusEmojis = {
  scanning: '🔄',
  analyzing: '🔍',
  processing: '<a:lol:1326464173361856524>',
  complete: '✅',
  error: '❌',
  warning: '<a:warning:1326464281260068946>'
};

// Threat verdict styling
const threatVerdicts = {
  safe: { 
    emoji: '✅', 
    color: '#00D26A', 
    label: 'SAFE',
    description: 'No malicious activity detected',
    style: '🛡️ **Verdict:** ✅ Analyzed & Clean'
  },
  suspicious: { 
    emoji: '⚠️', 
    color: '#FFA116', 
    label: 'SUSPICIOUS',
    description: 'Potentially harmful content detected',
    style: '⚠️ **WARNING:** Suspicious Activity Detected'
  },
  malicious: { 
    emoji: '🚨', 
    color: '#F92F60', 
    label: 'MALICIOUS',
    description: 'Confirmed malware or phishing',
    style: '❌ **DANGER:** Malicious Content Confirmed'
  },
  unknown: { 
    emoji: '❓', 
    color: '#8B92A5', 
    label: 'UNKNOWN',
    description: 'Unable to determine threat level',
    style: '❓ **Status:** Analysis Incomplete'
  }
};

// Country flags mapping
const countryFlags = {
  'US': '🇺🇸', 'GB': '🇬🇧', 'CA': '🇨🇦', 'AU': '🇦🇺', 'DE': '🇩🇪', 
  'FR': '🇫🇷', 'JP': '🇯🇵', 'CN': '🇨🇳', 'IN': '🇮🇳', 'BR': '🇧🇷',
  'RU': '🇷🇺', 'KR': '🇰🇷', 'MX': '🇲🇽', 'IT': '🇮🇹', 'ES': '🇪🇸',
  'NL': '🇳🇱', 'SE': '🇸🇪', 'NO': '🇳🇴', 'DK': '🇩🇰', 'FI': '🇫🇮',
  'PL': '🇵🇱', 'UA': '🇺🇦', 'AR': '🇦🇷', 'CL': '🇨🇱', 'CO': '🇨🇴'
};

// CDN/Service detection
const knownServices = {
  'jsdelivr.net': 'CDN',
  'cdnjs.cloudflare.com': 'CDN',
  'unpkg.com': 'CDN',
  'googleapis.com': 'Google API',
  'googletagmanager.com': 'Analytics',
  'google-analytics.com': 'Analytics',
  'facebook.com': 'Social',
  'twitter.com': 'Social',
  'doubleclick.net': 'Advertising',
  'googlesyndication.com': 'Advertising',
  'cloudflareinsights.com': 'Analytics',
  'fontawesome.com': 'Assets',
  'fonts.googleapis.com': 'Fonts'
};

// Suspicious TLD detection
const suspiciousTLDs = ['.tk', '.ml', '.ga', '.cf', '.xyz', '.top', '.click', '.download', '.ru', '.cn'];

// Loading messages
const loadingMessages = [
  '<a:terminal:1310498098107387974> Booting up scanner protocols...',
  '🧬 Decoding URL...',
  '🛰️ Analyzing domain coordinates...',
  '<a:scanpulse:1310498088724729876> Cross-referencing threat DB...',
  '🔐 Validating SSL/TLS handshake...',
  '🧠 Mapping behavior footprint...',
  '🕵️‍♂️ Inspecting embedded scripts...',
  '📡 Fetching resource intel...',
  '<a:corepulse:1326464273467179130> Identifying tech stacks...',
  '🎯 Finalizing assessment...'
];

class URLScanner {
  constructor() {
    if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
      throw new Error('Cloudflare credentials not configured');
    }
    
    this.baseURL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/urlscanner/v2`;
    this.headers = {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    };
  }

  async submitScan(url, options = {}) {
    try {
      const response = await axios.post(`${this.baseURL}/scan`, {
        url,
        screenshotsResolutions: options.screenshots || ['desktop', 'mobile'],
        visibility: options.visibility || 'unlisted',
        ...options
      }, { 
        headers: this.headers,
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      logger.error('Scan submission error:', error.response?.data || error.message);
      throw new Error(`Failed to submit scan: ${error.response?.data?.errors?.[0]?.message || error.message}`);
    }
  }

  async getScanResult(scanId, onProgress = null) {
    const maxAttempts = 30;
    const interval = 5000;
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await axios.get(`${this.baseURL}/result/${scanId}`, { 
          headers: this.headers,
          timeout: 10000
        });
        
        if (response.status === 200) {
          return response.data;
        }
      } catch (error) {
        if (error.response?.status !== 404) {
          throw new Error(`Failed to get scan result: ${error.message}`);
        }
      }
      
      if (onProgress) {
        await onProgress(i, maxAttempts);
      }
      
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    throw new Error('Scan timeout - analysis took too long');
  }

  async getScreenshot(scanId, resolution = 'desktop') {
    return `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/urlscanner/v2/screenshots/${scanId}.png?resolution=${resolution}`;
  }

  async searchScans(query, limit = 10) {
    try {
      const response = await axios.get(`${this.baseURL}/search`, {
        headers: this.headers,
        params: { q: query, size: limit },
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      logger.error('Search error:', error.response?.data || error.message);
      throw new Error(`Search failed: ${error.response?.data?.errors?.[0]?.message || error.message}`);
    }
  }
}

// Protocol selection handler - FIXED FOR DMs
async function handleProtocolSelection(interaction, url, visibility = null) {
  const protocolEmbed = new EmbedBuilder()
    .setTitle('🔗 Protocol Selection Required')
    .setDescription(`The URL **\`${url}\`** needs a protocol.\n\nPlease select the appropriate protocol:`)
    .setColor('#5865F2')
    .addFields({
      name: '💡 How to Choose',
      value: '• Most websites use **HTTPS** (secure)\n• Only select **HTTP** if you\'re sure the site doesn\'t support HTTPS',
      inline: false
    })
    .setFooter({ text: 'Click a button below to continue the scan' });

  const protocolRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`protocol_https_${url}`)
        .setLabel('HTTPS (Recommended)')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`protocol_http_${url}`)
        .setLabel('HTTP')
        .setEmoji('🔓')
        .setStyle(ButtonStyle.Primary)
    );

  const response = await interaction.reply({ 
    embeds: [protocolEmbed], 
    components: [protocolRow], 
    ephemeral: visibility === 'unlisted',
    fetchReply: true 
  });

  try {
    const collector = response.createMessageComponentCollector({ 
      filter: i => i.user.id === interaction.user.id,
      time: 30000,
      max: 1
    });

    collector.on('collect', async i => {
      try {
        // CRITICAL FIX: Defer immediately to prevent timeout
        await i.deferUpdate();
        
        const [, protocol] = i.customId.split('_');
        const fullUrl = `${protocol}://${url}`;
        
        const scanner = new URLScanner();
        checkRateLimit(i.user.id);
        
        let loadingEmbed = createProgressEmbed(
          'scanning',
          `${statusEmojis.scanning} **Initiating Security Scan**\n\n` +
          `🔗 **Target:** \`${fullUrl}\`\n` +
          `👤 **Requested by:** ${i.user.tag}\n` +
          `🔒 **Protocol:** ${protocol.toUpperCase()}`
        );
        
        await i.editReply({ 
          embeds: [loadingEmbed],
          components: [],
          ephemeral: visibility === 'unlisted'
        });

        const submission = await scanner.submitScan(fullUrl, { visibility: 'unlisted' });
        logger.info(`URL scan submitted: ${submission.uuid} by ${i.user.tag}`);
        
        loadingEmbed = createProgressEmbed(
          'analyzing',
          `${statusEmojis.analyzing} **Scan Initiated Successfully!**\n\n` +
          `📋 **Scan ID:** \`${submission.uuid}\`\n` +
          `⏱️ **Status:** Analysis in progress...\n` +
          `🔍 **Type:** Deep security scan`
        );
        await i.editReply({ embeds: [loadingEmbed] });

        let messageIndex = 0;
        let progressCounter = 0;

        const result = await scanner.getScanResult(submission.uuid, async (current, total) => {
          const message = loadingMessages[messageIndex % loadingMessages.length];
          messageIndex++;
          
          loadingEmbed = createProgressEmbed(
            'processing',
            `${message}\n\n` +
            `📋 **Scan ID:** \`${submission.uuid}\`\n` +
            `⏱️ **Elapsed:** ${progressCounter * 5} seconds`,
            { current: progressCounter, total }
          );
          
          progressCounter++;
          await i.editReply({ embeds: [loadingEmbed] }).catch(() => {});
        });

        const screenshotUrl = await scanner.getScreenshot(submission.uuid, 'desktop');
        const resultEmbed = buildScanResultEmbed(result, screenshotUrl);
        
        const buttons = [
          new ButtonBuilder()
            .setLabel('Full Report')
            .setURL(`https://radar.cloudflare.com/scan/${submission.uuid}`)
            .setStyle(ButtonStyle.Link)
            .setEmoji('📊'),
          new ButtonBuilder()
            .setLabel('Screenshot')
            .setURL(screenshotUrl)
            .setStyle(ButtonStyle.Link)
            .setEmoji('📸'),
          new ButtonBuilder()
            .setLabel('Mobile View')
            .setURL(await scanner.getScreenshot(submission.uuid, 'mobile'))
            .setStyle(ButtonStyle.Link)
            .setEmoji('📱')
        ];
        
        const row = new ActionRowBuilder().addComponents(buttons);

        await i.editReply({ 
          embeds: [resultEmbed], 
          components: [row],
          ephemeral: visibility === 'unlisted'
        });

      } catch (error) {
        logger.error(`Protocol scan error: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
          .setTitle(`${statusEmojis.error} Scan Failed`)
          .setDescription(`**Error:** ${error.message}`)
          .setColor('#F92F60')
          .setTimestamp();
          
        await i.editReply({ embeds: [errorEmbed], components: [] }).catch(() => {});
      }
    });

    collector.on('end', collected => {
      if (collected.size === 0) {
        const timeoutEmbed = new EmbedBuilder()
          .setTitle('⏰ Selection Timed Out')
          .setDescription('Protocol selection timed out. Please run the scan command again.')
          .setColor('#F92F60');
        
        interaction.editReply({ 
          embeds: [timeoutEmbed], 
          components: [] 
        }).catch(() => {});
      }
    });
  } catch (error) {
    logger.error('Protocol selection error:', error);
    throw error;
  }
}

// Helper functions
function validateURL(urlString) {
  try {
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      return { needsProtocol: true, domain: urlString };
    }
    
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are supported');
    }
    return { valid: true, url: url };
  } catch (error) {
    throw new Error('Invalid URL format');
  }
}

function getCountryFlag(countryCode) {
  return countryFlags[countryCode] || '🌍';
}

function getThreatVerdict(verdicts) {
  if (!verdicts?.overall) return threatVerdicts.unknown;
  if (verdicts.overall.malicious) return threatVerdicts.malicious;
  if (verdicts.overall.phishing) return threatVerdicts.malicious;
  if (verdicts.overall.categories?.includes('phishing')) return threatVerdicts.malicious;
  if (verdicts.overall.categories?.includes('malware')) return threatVerdicts.malicious;
  if (verdicts.overall.suspicious) return threatVerdicts.suspicious;
  return threatVerdicts.safe;
}

function formatLoadTime(perf) {
  if (!perf) return { full: 'Unavailable', dom: 'Unavailable' };
  
  const loadTime = perf.loadEventEnd - perf.fetchStart;
  const domReady = perf.domContentLoadedEventEnd - perf.fetchStart;
  
  const formatMs = (ms) => {
    if (ms == null || isNaN(ms)) return 'Unavailable';
    return `${Math.round(ms)}ms`;
  };
  
  return {
    full: formatMs(loadTime),
    dom: formatMs(domReady)
  };
}

function formatLocation(page) {
  if (!page) return 'Unknown Location';
  
  const flag = getCountryFlag(page.country);
  const country = page.country || 'Unknown';
  const city = page.city || 'Unknown City';
  
  if (city === 'Unknown City' && country === 'Unknown') {
    return '❓ Unknown – Could not resolve location';
  }
  
  return `${flag} ${country}${city !== 'Unknown City' ? ` (${city})` : ''}`;
}

function formatDomainList(domains, limit = 8) {
  if (!domains || !Array.isArray(domains) || domains.length === 0) {
    return 'No external resources detected';
  }
  
  const domainMap = new Map();
  
  domains.forEach(d => {
    const domain = typeof d === 'string' ? d : (d.name || d.domain || d);
    if (domain) {
      const service = knownServices[domain] || '';
      const isSuspicious = suspiciousTLDs.some(tld => domain.endsWith(tld));
      
      if (!domainMap.has(domain)) {
        domainMap.set(domain, { domain, service, isSuspicious, count: 1 });
      } else {
        domainMap.get(domain).count++;
      }
    }
  });
  
  const sortedDomains = Array.from(domainMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  
  const formatted = sortedDomains.map(({ domain, service, isSuspicious, count }) => {
    let line = `• ${domain}`;
    if (service) line += ` *(${service})*`;
    if (isSuspicious) line += ' ⚠️';
    if (count > 1) line += ` (${count}x)`;
    return line;
  }).join('\n');
  
  const remaining = domainMap.size - limit;
  if (remaining > 0) {
    return formatted + `\n*+${remaining} more domains...*`;
  }
  
  return formatted;
}

function formatCategories(categories) {
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return '*Uncategorized*';
  }
  
  return categories.map(cat => {
    if (typeof cat === 'string') return cat;
    return cat.name || 'Unknown';
  }).join(', ');
}

function createProgressEmbed(stage, message, progress = null) {
  const embed = new EmbedBuilder()
    .setTitle(`${statusEmojis[stage]} Advanced URL Security Analysis`)
    .setDescription(message)
    .setColor('#5865F2')
    .setTimestamp();

  if (progress) {
    const elapsedSeconds = progress.current * 4.3;
    const targetTime = 10;
    
    let percentage;
    if (progress.current === 0) {
      percentage = 1;
    } else if (elapsedSeconds < targetTime) {
      percentage = Math.min(Math.round((elapsedSeconds / targetTime) * 99), 99);
    } else {
      percentage = 99;
    }
    
    const filled = Math.round(percentage / 5);
    const empty = 20 - filled;
    const progressBar = '█'.repeat(filled) + '░'.repeat(empty);

    embed.addFields({
      name: '⚡ Analysis Progress',
      value: `\`${progressBar}\` **${percentage}%**`,
      inline: false
    });
  }

  return embed;
}

function buildScanResultEmbed(scan, screenshotUrl) {
  const verdict = getThreatVerdict(scan.verdicts);
  const embed = new EmbedBuilder()
    .setTitle(`<a:computer6:1333357940341735464> Security Scan Complete`)
    .setURL(scan.page?.url || scan.task?.url)
    .setColor(verdict.color)
    .setTimestamp();

  embed.addFields({
    name: '🎯 Security Analysis Result',
    value: `${verdict.style}\n*${verdict.description}*`,
    inline: false
  });

  const urlInfo = [];
  if (scan.task?.url) {
    urlInfo.push(`**Scanned:**\n\`\`\`${scan.task.url || 'Unknown'}\`\`\``);
  }
  if (scan.page?.url && scan.page.url !== scan.task?.url) {
    urlInfo.push(`**Redirected to:** \`${scan.page.url}\``);
  }
  if (scan.page?.title) {
    urlInfo.push(`**Page Title:** ${scan.page.title}`);
  }
  
  embed.addFields({
    name: '<a:settings_1310498098107387974:1342443716979327007> URL Information',
    value: urlInfo.join('\n') || 'No URL information available',
    inline: false
  });

  if (scan.page) {
    const location = formatLocation(scan.page);
    const serverInfo = [];
    
    serverInfo.push(`**Location:** ${location}`);
    if (scan.page.ip) serverInfo.push(`**IP Address:** \`${scan.page.ip}\``);
    if (scan.page.asn) serverInfo.push(`**ASN:** AS${scan.page.asn} ${scan.page.asnname ? `(${scan.page.asnname})` : ''}`);
    if (scan.page.server) serverInfo.push(`**Server:** ${scan.page.server}`);
    
    embed.addFields({
      name: '<a:ohost_server98_13112028459740734:1342443585869447178> Infrastructure',
      value: serverInfo.join('\n'),
      inline: false
    });
  }

  if (scan.data?.performance) {
    const times = formatLoadTime(scan.data.performance);
    
    embed.addFields({
      name: '<a:loading:1333357988953460807> Performance Metrics',
      value: [
        `<a:minute_count_down:1333356390978158594> **Load Times:**`,
        `• DOM Ready: ${times.dom}`,
        `• Full Page Load: ${times.full}`,
        `• Resources Used: ${scan.data?.requests?.length || 0} requests`
      ].join('\n'),
      inline: true
    });
  }

  const securityInfo = [];
  if (scan.page?.tlsIssuer) {
    securityInfo.push(`🔒 **SSL/TLS:** Yes (${scan.page.tlsIssuer})`);
  } else {
    securityInfo.push(`🔓 **SSL/TLS:** Not detected`);
  }
  
  if (scan.meta?.processors?.radarRank?.data?.[0]?.rank) {
    const rank = scan.meta.processors.radarRank.data[0].rank;
    securityInfo.push(`📊 **Popularity:** #${rank.toLocaleString()} globally`);
  }
  
  if (scan.stats?.securePercentage !== undefined) {
    securityInfo.push(`🛡️ **Secure Requests:** ${Math.round(scan.stats.securePercentage)}%`);
  }
  
  if (securityInfo.length > 0) {
    embed.addFields({
      name: '<a:onekiss_HypesquadShiny_132798296:1342442832631431258> Security Analysis',
      value: securityInfo.join('\n'),
      inline: true
    });
  }

  if (scan.meta?.processors?.domainCategories?.data) {
    embed.addFields({
      name: '📂 Website Categories',
      value: formatCategories(scan.meta.processors.domainCategories.data),
      inline: false
    });
  }

  if (scan.meta?.processors?.phishing?.data && scan.meta.processors.phishing.data.length > 0) {
    embed.addFields({
      name: '🎣 ⚠️ PHISHING ALERT',
      value: `**Target Brands:** ${scan.meta.processors.phishing.data.join(', ')}\n⚠️ This site appears to be impersonating legitimate services!`,
      inline: false
    });
  }

  if (scan.lists?.domains && scan.lists.domains.length > 0) {
    embed.addFields({
      name: `🌐 External Domains (${scan.lists.domains.length} total)`,
      value: formatDomainList(scan.lists.domains),
      inline: false
    });
  }

  if (scan.stats) {
    const netStats = [];
    if (scan.stats.uniqCountries) netStats.push(`🌍 Countries: ${scan.stats.uniqCountries}`);
    if (scan.stats.uniqIPs) netStats.push(`📍 Unique IPs: ${scan.stats.uniqIPs}`);
    if (scan.stats.totalLinks) netStats.push(`🔗 Total Links: ${scan.stats.totalLinks}`);
    
    if (netStats.length > 0) {
      embed.addFields({
        name: '📊 Network Statistics',
        value: netStats.join(' • '),
        inline: false
      });
    }
  }

  if (screenshotUrl) {
    embed.setImage(screenshotUrl);
  }

  embed.setFooter({ 
    text: `Scan ID: ${scan.task?.uuid || 'Unknown'} • ${scan.task?.visibility || 'unlisted'} • Powered by Cloudflare` 
  });

  return embed;
}

function buildSearchResultsEmbed(results, query) {
  const embed = new EmbedBuilder()
    .setTitle(`🔍 Search Results`)
    .setDescription(`**Query:** \`${query}\``)
    .setColor('#5865F2')
    .setTimestamp();

  if (!results.results || !Array.isArray(results.results) || results.results.length === 0) {
    embed.addFields({
      name: '💭 No Results Found',
      value: 'No scan results match your search query.',
      inline: false
    });
    return embed;
  }

  const totalResults = results.results.length;
  embed.setFooter({ text: `Showing ${Math.min(5, totalResults)} of ${totalResults} results` });

  results.results.slice(0, 5).forEach((scan, index) => {
    const isMalicious = scan.verdicts?.malicious || false;
    const threatEmoji = isMalicious ? '⚠️' : '✅';
    const date = scan.task?.time ? new Date(scan.task.time).toLocaleDateString() : 'Unknown date';
    const flag = getCountryFlag(scan.page?.country);
    
    embed.addFields({
      name: `${index + 1}. ${threatEmoji} ${scan.page?.url || scan.task?.url || 'Unknown URL'}`,
      value: [
        `**Status:** ${isMalicious ? '⚠️ Malicious' : '✅ Safe'}`,
        `**Location:** ${flag} ${scan.page?.country || 'Unknown'}`,
        `**Date:** ${date}`,
        `**Stats:** ${scan.stats?.requests || 0} requests • ${scan.stats?.uniqIPs || 0} IPs`,
        `**ID:** \`${scan.task?.uuid || scan._id || 'Unknown'}\``,
        `[View Report](https://radar.cloudflare.com/scan/${scan.task?.uuid || scan._id})`
      ].join('\n'),
      inline: false
    });
  });

  return embed;
}

function checkRateLimit(userId) {
  const userScans = scanRateLimit.get(userId) || [];
  const now = Date.now();
  
  const recentScans = userScans.filter(time => now - time < RATE_LIMIT_DURATION);
  
  if (recentScans.length >= MAX_SCANS_PER_USER) {
    const oldestScan = Math.min(...recentScans);
    const timeRemaining = Math.ceil((RATE_LIMIT_DURATION - (now - oldestScan)) / 1000);
    throw new Error(`⏳ Rate limit reached. Please wait ${timeRemaining} seconds before your next scan.`);
  }
  
  recentScans.push(now);
  scanRateLimit.set(userId, recentScans);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('urlscan')
    .setDescription('URL security scanner with advanced threat detection')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addSubcommand(subcommand =>
      subcommand
        .setName('scan')
        .setDescription('Deep scan a URL for threats, malware, and phishing')
        .addStringOption(option =>
          option.setName('url')
            .setDescription('The URL to scan (can be with or without http/https)')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('visibility')
            .setDescription('Scan visibility level')
            .setRequired(false)
            .addChoices(
              { name: '🌐 Public - Visible to everyone', value: 'public' },
              { name: '🔒 Unlisted - Only accessible with link', value: 'unlisted' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('search')
        .setDescription('Search through previous URL scans')
        .addStringOption(option =>
          option.setName('query')
            .setDescription('Search query (e.g., domain:example.com, verdicts.malicious:true)')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName('limit')
            .setDescription('Number of results to show (1-10)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(10)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('help')
        .setDescription('Show advanced search syntax and examples')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('🎓 URL Scanner - Advanced Guide')
        .setColor('#5865F2')
        .setDescription('**Threat detection powered by Cloudflare\'s security intelligence**')
        .addFields(
          {
            name: '🔍 Advanced Search Syntax',
            value: [
              '`domain:example.com` - Scans of specific domain',
              '`page.country:US` - Scans from US servers',
              '`verdicts.malicious:true` - Find malicious sites',
              '`meta.processors.phishing.data:*` - Phishing sites',
              '`page.asn:AS13335` - Sites on Cloudflare',
              '`stats.requests:>100` - Heavy resource sites',
              '`date:>now-7d` - Recent scans (last 7 days)'
            ].join('\n'),
            inline: false
          },
          {
            name: '💡 Pro Tips',
            value: [
              '• Use quotes for exact matches: `"example.com"`',
              '• Combine with AND/OR: `domain:google AND country:US`',
              '• Wildcards: `domain:microsoft*`',
              '• Exclude: `NOT domain:microsoft.com`'
            ].join('\n'),
            inline: false
          },
          {
            name: '🛡️ Threat Indicators',
            value: [
              '✅ **Safe** - No threats detected',
              '⚠️ **Suspicious** - Potential risks found',
              '🚨 **Malicious** - Confirmed threats',
              '🎣 **Phishing** - Impersonation detected'
            ].join('\n'),
            inline: false
          }
        )
        .setFooter({ text: 'Stay safe online • Powered by Cloudflare' });

      return interaction.reply({ embeds: [helpEmbed] });
    }

    try {
      if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
        throw new Error('🔧 URL Scanner is not configured. Please contact the administrator.');
      }

      const scanner = new URLScanner();

      if (subcommand === 'scan') {
        checkRateLimit(interaction.user.id);
        
        const url = interaction.options.getString('url');
        const visibility = interaction.options.getString('visibility') || 'public';

        try {
          const urlValidation = validateURL(url);
          
          if (urlValidation.needsProtocol) {
            await handleProtocolSelection(interaction, urlValidation.domain, visibility);
            return;
          }

          await interaction.deferReply({
            ephemeral: visibility === 'unlisted'
          });
          
          let loadingEmbed = createProgressEmbed(
            'scanning',
            `${statusEmojis.scanning} **Initiating Security Scan**\n\n` +
            `🔗 **Target:** \`${url}\`\n` +
            `👤 **Requested by:** ${interaction.user.tag}\n` +
            `🔒 **Visibility:** ${visibility}`
          );
          
          await interaction.editReply({ embeds: [loadingEmbed] });

          const submission = await scanner.submitScan(url, { 
            visibility,
            screenshotsResolutions: ['desktop', 'mobile']
          });
          
          logger.info(`URL scan submitted: ${submission.uuid} by ${interaction.user.tag}`);
          
          loadingEmbed = createProgressEmbed(
            'analyzing',
            `${statusEmojis.analyzing} **Scan Initiated Successfully!**\n\n` +
            `📋 **Scan ID:** \`${submission.uuid}\`\n` +
            `⏱️ **Status:** Analysis in progress...\n` +
            `🔍 **Type:** Deep security scan`
          );
          await interaction.editReply({ embeds: [loadingEmbed] });

          let messageIndex = 0;
          let progressCounter = 0;

          const result = await scanner.getScanResult(submission.uuid, async (current, total) => {
            const message = loadingMessages[messageIndex % loadingMessages.length];
            messageIndex++;
            
            loadingEmbed = createProgressEmbed(
              'processing',
              `${message}\n\n` +
              `📋 **Scan ID:** \`${submission.uuid}\`\n` +
              `⏱️ **Elapsed:** ${progressCounter * 5} seconds`,
              { current: progressCounter, total }
            );
            
            progressCounter++;
            await interaction.editReply({ embeds: [loadingEmbed] }).catch(() => {});
          });
          
          const screenshotUrl = await scanner.getScreenshot(submission.uuid, 'desktop');
          const resultEmbed = buildScanResultEmbed(result, screenshotUrl);
          
          const buttons = [
            new ButtonBuilder()
              .setLabel('Full Report')
              .setURL(`https://radar.cloudflare.com/scan/${submission.uuid}`)
              .setStyle(ButtonStyle.Link)
              .setEmoji('📊'),
            new ButtonBuilder()
              .setLabel('Screenshot')
              .setURL(screenshotUrl)
              .setStyle(ButtonStyle.Link)
              .setEmoji('📸'),
            new ButtonBuilder()
              .setLabel('Mobile View')
              .setURL(await scanner.getScreenshot(submission.uuid, 'mobile'))
              .setStyle(ButtonStyle.Link)
              .setEmoji('📱')
          ];
          
          const row = new ActionRowBuilder().addComponents(buttons);

          await interaction.editReply({ 
            embeds: [resultEmbed], 
            components: [row],
            ephemeral: visibility === 'unlisted'
          });

        } catch (error) {
          logger.error(`URL scan error: ${error.message}`);
          
          const errorEmbed = new EmbedBuilder()
            .setTitle(`${statusEmojis.error} Scan Failed`)
            .setDescription(`**Error:** ${error.message}`)
            .setColor('#F92F60')
            .addFields({
              name: '💡 Troubleshooting',
              value: [
                '• Ensure URL is valid (e.g., example.com or https://example.com)',
                '• Check if the website is publicly accessible',
                '• Try without specific paths (just domain)',
                '• Some sites block automated scans'
              ].join('\n')
            })
            .setTimestamp();
            
          if (interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed], components: [] });
          } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
          }
        }
        
      } else if (subcommand === 'search') {
        await interaction.deferReply();
        
        const query = interaction.options.getString('query');
        const limit = interaction.options.getInteger('limit') || 5;

        try {
          const searchingEmbed = createProgressEmbed(
            'scanning',
            `${statusEmojis.scanning} **Searching scan database...**\n\n` +
            `🔍 **Query:** \`${query}\`\n` +
            `📊 **Limit:** ${limit} results`
          );
          await interaction.editReply({ embeds: [searchingEmbed] });

          const results = await scanner.searchScans(query, limit);
          const resultsEmbed = buildSearchResultsEmbed(results, query);
          
          await interaction.editReply({ embeds: [resultsEmbed] });

        } catch (error) {
          logger.error(`URL search error: ${error.message}`);
          
          const errorEmbed = new EmbedBuilder()
            .setTitle(`${statusEmojis.error} Search Failed`)
            .setDescription(error.message)
            .setColor('#F92F60')
            .addFields({
              name: '💡 Search Tips',
              value: [
                '• Check your query syntax',
                '• Use simpler search terms',
                '• Try: `domain:example.com`',
                '• See `/urlscan help` for syntax'
              ].join('\n')
            })
            .setTimestamp();
            
          await interaction.editReply({ embeds: [errorEmbed] });
        }
      }
    } catch (error) {
      logger.error(`URL scanner command error: ${error.message}`);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle(`${statusEmojis.error} Command Error`)
        .setDescription(error.message)
        .setColor('#F92F60')
        .setTimestamp();
        
      if (interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
  },
  
  // Button handler - REMOVED protocol handling (now in handleProtocolSelection)
  async handleButton(interaction) {
    // This function is kept for compatibility but protocol buttons 
    // are now handled directly in handleProtocolSelection collector
    return;
  }
};