const axios = require('axios');
const { EmbedBuilder, Collection } = require('discord.js');

// --- authorized users who can talk to the ai agent ---
const AUTHORIZED_USER_IDS = [
    '1246380709124378674',
    '1444822340864315475 ',
    '993196090654457898',
    '1331145720216158208',
];

const API_KEY = process.env.APEXIFY_API_KEY || 'no_api_here';

// cooldown to prevent spam (5 seconds)
const cooldowns = new Map();
const COOLDOWN_MS = 5000;

// ============================================================================
//  DEBUG LOGGER — shows the entire ai pipeline in console
// ============================================================================
const DEBUG = true;
const LOG_PREFIX = '\x1b[35m[AI-AGENT]\x1b[0m';
const LOG_FUZZY = '\x1b[36m[FUZZY]\x1b[0m';
const LOG_EXEC = '\x1b[33m[EXEC]\x1b[0m';
const LOG_LLM = '\x1b[32m[LLM]\x1b[0m';
const LOG_ERR = '\x1b[31m[ERROR]\x1b[0m';
const LOG_SLASH = '\x1b[34m[SLASH]\x1b[0m';

function dbg(...args) { if (DEBUG) console.log(LOG_PREFIX, ...args); }
function dbgFuzzy(...args) { if (DEBUG) console.log(LOG_FUZZY, ...args); }
function dbgExec(...args) { if (DEBUG) console.log(LOG_EXEC, ...args); }
function dbgLLM(...args) { if (DEBUG) console.log(LOG_LLM, ...args); }
function dbgSlash(...args) { if (DEBUG) console.log(LOG_SLASH, ...args); }
function dbgErr(...args) { console.error(LOG_ERR, ...args); }

// ============================================================================
//  FUZZY MATCHING ENGINE — 7 strategies layered together
// ============================================================================

function levenshteinDistance(a, b) {
    const la = a.length, lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;
    let prev = Array.from({ length: lb + 1 }, (_, i) => i);
    let curr = new Array(lb + 1);
    for (let i = 1; i <= la; i++) {
        curr[0] = i;
        for (let j = 1; j <= lb; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[lb];
}

function levenshteinSimilarity(a, b) {
    if (a === b) return 1.0;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    return 1.0 - (levenshteinDistance(a, b) / maxLen);
}

function damerauLevenshteinDistance(a, b) {
    const la = a.length, lb = b.length;
    const d = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
    for (let i = 0; i <= la; i++) d[i][0] = i;
    for (let j = 0; j <= lb; j++) d[0][j] = j;
    for (let i = 1; i <= la; i++) {
        for (let j = 1; j <= lb; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
            }
        }
    }
    return d[la][lb];
}

function damerauSimilarity(a, b) {
    if (a === b) return 1.0;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    return 1.0 - (damerauLevenshteinDistance(a, b) / maxLen);
}

function jaroSimilarity(s1, s2) {
    if (s1 === s2) return 1.0;
    const len1 = s1.length, len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0.0;
    const matchWindow = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);
    let matches = 0, transpositions = 0;
    for (let i = 0; i < len1; i++) {
        const start = Math.max(0, i - matchWindow);
        const end = Math.min(i + matchWindow + 1, len2);
        for (let j = start; j < end; j++) {
            if (s2Matches[j] || s1[i] !== s2[j]) continue;
            s1Matches[i] = true; s2Matches[j] = true; matches++; break;
        }
    }
    if (matches === 0) return 0.0;
    let k = 0;
    for (let i = 0; i < len1; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }
    return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinklerSimilarity(s1, s2) {
    const jaroScore = jaroSimilarity(s1, s2);
    let prefixLen = 0;
    for (let i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
        if (s1[i] === s2[i]) prefixLen++;
        else break;
    }
    return jaroScore + (prefixLen * 0.1 * (1 - jaroScore));
}

function getNGrams(str, n = 2) {
    const grams = new Set();
    const padded = `$${str}$`;
    for (let i = 0; i <= padded.length - n; i++) grams.add(padded.substring(i, i + n));
    return grams;
}

function ngramSimilarity(a, b, n = 2) {
    const gramsA = getNGrams(a, n), gramsB = getNGrams(b, n);
    let intersection = 0;
    for (const gram of gramsA) if (gramsB.has(gram)) intersection++;
    const union = gramsA.size + gramsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

function isSubsequence(sub, str) {
    let si = 0;
    for (let i = 0; i < str.length && si < sub.length; i++) if (sub[si] === str[i]) si++;
    return si === sub.length;
}

function subsequenceScore(input, target) {
    return isSubsequence(input, target) ? Math.min(1.0, input.length / target.length) : 0;
}

function prefixScore(input, target) {
    return target.startsWith(input) ? 0.7 + (0.3 * (input.length / target.length)) : 0;
}

function containsScore(input, target) {
    if (target.includes(input)) return 0.5 + (0.3 * (input.length / target.length));
    if (input.includes(target)) return 0.4 + (0.2 * (target.length / input.length));
    return 0;
}

// --- semantic synonyms ---
const SEMANTIC_SYNONYMS = {
    // moderation
    'delete': 'clear', 'purge': 'clear', 'clean': 'clear', 'prune': 'clear', 'erase': 'clear', 'wipe': 'clear',
    'mute': 'timeout', 'silence': 'timeout', 'shutup': 'timeout', 'stfu': 'timeout', 'hush': 'timeout',
    'unmute': 'untimeout', 'unsilence': 'untimeout',
    'banish': 'ban', 'exile': 'ban', 'permaban': 'ban', 'hammer': 'ban',
    'boot': 'kick', 'yeet': 'kick', 'eject': 'kick',
    'pardon': 'unban', 'forgive': 'unban', 'unexile': 'unban',
    'strike': 'warn', 'warning': 'warn', 'caution': 'warn',
    'freeze': 'lock', 'lockdown': 'lock',
    'unfreeze': 'unlock', 'open': 'unlock',

    // economy
    'money': 'balance', 'bal': 'balance', 'coins': 'balance', 'wallet': 'balance', 'cash': 'balance',
    'gamble': 'cf', 'coinflip': 'cf', 'flip': 'cf', 'bet': 'cf',
    'slot': 'slots', 'slotmachine': 'slots', 'spin': 'slots',
    'give': 'pay', 'send': 'pay', 'transfer': 'pay', 'donate': 'pay',
    'job': 'work', 'grind': 'work', 'earn': 'work',
    'claim': 'daily', 'reward': 'daily',
    'lb': 'leaderboard', 'top': 'leaderboard', 'ranking': 'leaderboard',
    'marry': 'wife', 'propose': 'wife', 'waifu': 'wife',

    // general
    'pfp': 'avatar', 'profilepic': 'avatar', 'dp': 'avatar', 'pic': 'avatar',
    'latency': 'ping', 'pong': 'ping', 'speed': 'ping',
    'commands': 'help', 'cmds': 'help', 'menu': 'help',
    'botinfo': 'info', 'about': 'info', 'stats': 'info',
    'link': 'invite', 'addbot': 'invite',
    'funny': 'meme', 'joke': 'meme', 'reddit': 'meme',
    'speak': 'say', 'echo': 'say', 'repeat': 'say',
    'vote': 'poll', 'survey': 'poll',
    'love': 'ship', 'match': 'ship', 'compatibility': 'ship',
    'brb': 'afk', 'away': 'afk', 'busy': 'afk',

    // whois / userinfo
    'userinfo': 'whois', 'who': 'whois', 'ui': 'whois', 'lookup': 'whois', 'profile': 'whois',
    // tempban
    'tban': 'tempban', 'temporaryban': 'tempban', 'timeban': 'tempban',
    // server info
    'serverinfo': 'server', 'si': 'server', 'guild': 'server', 'guildinfo': 'server',
    // suggest
    'suggestion': 'suggest', 'feedback': 'suggest', 'report': 'suggest', 'idea': 'suggest',
    // prefix
    'prefix': 'setprefix', 'changeprefix': 'setprefix',

    // music (mapped to slash:music subcommands)
    'play': 'slash:music:play', 'song': 'slash:music:play', 'listen': 'slash:music:play', 'stream': 'slash:music:play',
    'queue': 'slash:music:queue', 'q': 'slash:music:queue', 'playlist': 'slash:music:queue',
    'skip': 'slash:music:skip', 'next': 'slash:music:skip', 'skipsong': 'slash:music:skip',
    'stop': 'slash:music:stop', 'stopmusic': 'slash:music:stop', 'stopsong': 'slash:music:stop',
    'nowplaying': 'slash:music:nowplaying', 'np': 'slash:music:nowplaying', 'current': 'slash:music:nowplaying', 'playing': 'slash:music:nowplaying',
    'loop': 'slash:music:loop', 'repeat': 'slash:music:loop',
    'disconnect': 'slash:music:disconnect', 'dc': 'slash:music:disconnect', 'leave': 'slash:music:disconnect', 'fuckoff': 'slash:music:disconnect',
    'clearqueue': 'slash:music:clear',

    // antiraid (mapped to slash:antiraid subcommands)
    'antiraid': 'slash:antiraid:status', 'raid': 'slash:antiraid:status', 'raidstatus': 'slash:antiraid:status',
    'antiraidtoggle': 'slash:antiraid:toggle', 'raidtoggle': 'slash:antiraid:toggle',
    'emergencydisable': 'slash:antiraid:emergency', 'emergencyoff': 'slash:antiraid:emergency', 'panicmode': 'slash:antiraid:emergency',
    'raidstats': 'slash:antiraid:stats',

    // urlscan
    'scan': 'urlscan', 'scanurl': 'urlscan', 'checksafe': 'urlscan', 'checkurl': 'urlscan', 'urlcheck': 'urlscan', 'linkscan': 'urlscan',

    // compound commands
    'purgemessages': 'clear', 'delmsg': 'clear', 'delmessages': 'clear',
    'clearmsg': 'clear', 'deletemsg': 'clear', 'clearmsgs': 'clear',
    'userpurge': 'purgeuser', 'userclear': 'purgeuser',
    'addrole': 'roleall', 'giverole': 'roleall', 'massrole': 'roleall',
    'addmoney': 'eco', 'removemoney': 'eco', 'setbalance': 'eco',
};

// ============================================================================
//  COMPOSITE FUZZY RESOLVER
// ============================================================================
function fuzzyResolveCommand(input, prefixCommands, slashCommands) {
    const inputLower = input.toLowerCase().trim();
    const startTime = Date.now();

    dbgFuzzy(`┌─── fuzzy resolve: "${inputLower}"`);
    dbgFuzzy(`│ available: prefix=${prefixCommands.size}, slash=${slashCommands?.size || 0}`);

    // phase 0: check for slash:command:subcommand format (from llm)
    if (inputLower.startsWith('slash:')) {
        const parts = inputLower.split(':');
        if (parts.length >= 3) {
            const cmdName = parts[1];
            const subName = parts[2];
            const slashCmd = slashCommands?.get(cmdName);
            if (slashCmd) {
                dbgFuzzy(`│ ✅ SLASH match: "${cmdName}" subcommand="${subName}"`);
                dbgFuzzy(`└─── resolved in ${Date.now() - startTime}ms`);
                return { command: slashCmd, name: cmdName, subcommand: subName, confidence: 1.0, method: 'slash-exact', isSlash: true };
            }
        }
    }

    // phase 1: exact prefix match — always preferred over slash
    if (prefixCommands.has(inputLower)) {
        dbgFuzzy(`│ ✅ EXACT prefix: "${inputLower}"`);
        dbgFuzzy(`└─── resolved in ${Date.now() - startTime}ms`);
        return { command: prefixCommands.get(inputLower), name: inputLower, confidence: 1.0, method: 'exact' };
    }

    // phase 2: semantic synonym lookup
    const synonym = SEMANTIC_SYNONYMS[inputLower];
    if (synonym) {
        // check if synonym points to a slash command
        if (synonym.startsWith('slash:')) {
            const parts = synonym.split(':');
            const cmdName = parts[1], subName = parts[2];
            const slashCmd = slashCommands?.get(cmdName);
            if (slashCmd) {
                dbgFuzzy(`│ ✅ SYNONYM→SLASH: "${inputLower}" → "${cmdName}:${subName}"`);
                dbgFuzzy(`└─── resolved in ${Date.now() - startTime}ms`);
                return { command: slashCmd, name: cmdName, subcommand: subName, confidence: 0.95, method: 'synonym-slash', isSlash: true };
            }
        }
        if (prefixCommands.has(synonym)) {
            dbgFuzzy(`│ ✅ SYNONYM: "${inputLower}" → "${synonym}"`);
            dbgFuzzy(`└─── resolved in ${Date.now() - startTime}ms`);
            return { command: prefixCommands.get(synonym), name: synonym, confidence: 0.95, method: 'synonym' };
        }
    }

    // phase 3: compound synonym (no spaces)
    const inputNoSpaces = inputLower.replace(/\s+/g, '');
    const synonymNS = SEMANTIC_SYNONYMS[inputNoSpaces];
    if (synonymNS) {
        if (synonymNS.startsWith('slash:')) {
            const parts = synonymNS.split(':');
            const slashCmd = slashCommands?.get(parts[1]);
            if (slashCmd) {
                dbgFuzzy(`│ ✅ COMPOUND→SLASH: "${inputLower}" → "${parts[1]}:${parts[2]}"`);
                dbgFuzzy(`└─── resolved in ${Date.now() - startTime}ms`);
                return { command: slashCmd, name: parts[1], subcommand: parts[2], confidence: 0.93, method: 'compound-slash', isSlash: true };
            }
        }
        if (prefixCommands.has(synonymNS)) {
            dbgFuzzy(`│ ✅ COMPOUND: "${inputLower}" → "${synonymNS}"`);
            dbgFuzzy(`└─── resolved in ${Date.now() - startTime}ms`);
            return { command: prefixCommands.get(synonymNS), name: synonymNS, confidence: 0.93, method: 'compound-synonym' };
        }
    }

    // phase 4: check slash commands by name — only if prefix doesn't have it
    if (slashCommands?.has(inputLower) && !prefixCommands.has(inputLower)) {
        dbgFuzzy(`│ ✅ SLASH EXACT: "${inputLower}"`);
        dbgFuzzy(`└─── resolved in ${Date.now() - startTime}ms`);
        return { command: slashCommands.get(inputLower), name: inputLower, confidence: 0.98, method: 'slash-name', isSlash: true };
    }

    // phase 5: full fuzzy scoring on prefix commands
    const candidates = [];
    for (const [name, cmd] of prefixCommands) {
        const nameLower = name.toLowerCase();
        const scores = {
            levenshtein: levenshteinSimilarity(inputLower, nameLower),
            damerau: damerauSimilarity(inputLower, nameLower),
            jaroWinkler: jaroWinklerSimilarity(inputLower, nameLower),
            ngram: ngramSimilarity(inputLower, nameLower, 2),
            trigram: ngramSimilarity(inputLower, nameLower, 3),
            subsequence: subsequenceScore(inputLower, nameLower),
            prefix: prefixScore(inputLower, nameLower),
            contains: containsScore(inputLower, nameLower),
        };

        let compositeScore = scores.levenshtein * 0.15 + scores.damerau * 0.15 + scores.jaroWinkler * 0.20 +
            scores.ngram * 0.10 + scores.trigram * 0.10 + scores.subsequence * 0.10 +
            scores.prefix * 0.10 + scores.contains * 0.10;

        if (nameLower.startsWith(inputLower) && inputLower.length >= 2) compositeScore = Math.min(1.0, compositeScore + 0.15);
        if ((cmd.description || '').toLowerCase().includes(inputLower) && inputLower.length >= 3) compositeScore = Math.min(1.0, compositeScore + 0.08);

        if (Array.isArray(cmd.aliases)) {
            for (const alias of cmd.aliases) {
                if (alias.toLowerCase() === inputLower) { compositeScore = 1.0; break; }
                const aliasSim = Math.max(levenshteinSimilarity(inputLower, alias.toLowerCase()), jaroWinklerSimilarity(inputLower, alias.toLowerCase()));
                if (aliasSim > compositeScore) compositeScore = Math.min(1.0, aliasSim + 0.05);
            }
        }

        candidates.push({ name: nameLower, command: cmd, compositeScore, scores });
    }

    candidates.sort((a, b) => b.compositeScore - a.compositeScore);

    dbgFuzzy(`│ ┌─── top 3:`);
    for (let i = 0; i < Math.min(3, candidates.length); i++) {
        const c = candidates[i];
        const bar = '█'.repeat(Math.round(c.compositeScore * 20)).padEnd(20, '░');
        dbgFuzzy(`│ │ ${i + 1}. "${c.name}" [${bar}] ${(c.compositeScore * 100).toFixed(1)}%`);
    }
    dbgFuzzy(`│ └───`);

    const best = candidates[0];
    if (!best || best.compositeScore < 0.35) {
        dbgFuzzy(`│ ❌ no match above threshold`);
        dbgFuzzy(`└─── resolved in ${Date.now() - startTime}ms`);
        return null;
    }

    dbgFuzzy(`│ ✅ FUZZY: "${inputLower}" → "${best.name}" (${(best.compositeScore * 100).toFixed(1)}%)`);
    dbgFuzzy(`└─── resolved in ${Date.now() - startTime}ms`);

    return {
        command: best.command, name: best.name, confidence: best.compositeScore,
        method: best.compositeScore >= 0.8 ? 'fuzzy-high' : best.compositeScore >= 0.5 ? 'fuzzy-medium' : 'fuzzy-low',
        autocorrected: inputLower !== best.name,
    };
}

// ============================================================================
//  FAKE INTERACTION ADAPTER — lets slash commands run from a message context
//  translates all interaction.reply/editReply/deferReply/options to message ops
// ============================================================================
function createFakeInteraction(message, client, subcommand, options = {}) {
    let replyMsg = null;
    let deferred = false;
    let replied = false;

    const fakeInteraction = {
        // core properties
        user: message.author,
        member: message.member,
        guild: message.guild,
        guildId: message.guild?.id || null,
        channel: message.channel,
        channelId: message.channel.id,
        client: client,
        id: message.id,
        memberPermissions: message.member?.permissions || null,

        // state tracking
        get deferred() { return deferred; },
        get replied() { return replied; },

        // options adapter — returns values from the options map
        options: {
            getSubcommand: () => subcommand,
            getString: (name) => options[name] || null,
            getBoolean: (name) => options[name] !== undefined ? options[name] : null,
            getUser: (name) => options[name] || null,
            getInteger: (name) => options[name] !== undefined ? parseInt(options[name]) : null,
            getNumber: (name) => options[name] !== undefined ? parseFloat(options[name]) : null,
        },

        // reply methods
        deferReply: async (opts) => {
            deferred = true;
            dbgSlash(`deferReply called`);
            replyMsg = await message.reply({ content: '⏳ Processing...' }).catch(() => null);
        },

        reply: async (data) => {
            replied = true;
            dbgSlash(`reply called`);
            if (typeof data === 'string') data = { content: data };
            // strip ephemeral flag since we're using messages
            delete data.ephemeral;
            delete data.flags;
            if (replyMsg) {
                return await replyMsg.edit(data).catch(() => message.reply(data));
            }
            replyMsg = await message.reply(data).catch(() => null);
            return replyMsg;
        },

        editReply: async (data) => {
            dbgSlash(`editReply called`);
            if (typeof data === 'string') data = { content: data };
            delete data.ephemeral;
            delete data.flags;
            if (replyMsg) {
                return await replyMsg.edit(data).catch(() => message.channel.send(data));
            }
            replyMsg = await message.reply(data).catch(() => null);
            return replyMsg;
        },

        deleteReply: async () => {
            if (replyMsg) await replyMsg.delete().catch(() => { });
        },

        followUp: async (data) => {
            if (typeof data === 'string') data = { content: data };
            delete data.ephemeral;
            return await message.channel.send(data).catch(() => null);
        },

        fetchReply: async () => replyMsg,

        // for music: voice channel resolution uses interaction.user.id
        // and interaction.guild.members.cache.get(interaction.user.id)
    };

    return fakeInteraction;
}

// ============================================================================
//  ARG AUTOCORRECTOR
// ============================================================================
function autocorrectArgs(commandName, args, message) {
    const corrected = [...args];
    const mentionedUsers = [...message.mentions.users.values()].filter(u => u.id !== message.client.user.id);

    dbgExec(`│ ┌─── autocorrect args for "${commandName}"`);
    dbgExec(`│ │ raw args: [${corrected.map(a => `"${a}"`).join(', ')}]`);

    const needsUserFirst = ['ban', 'kick', 'timeout', 'untimeout', 'warn', 'purgeuser', 'pay', 'wife', 'avatar', 'ship', 'whois', 'tempban'];
    if (needsUserFirst.includes(commandName) && corrected.length > 0) {
        const firstArg = corrected[0];
        const isMention = /^<@!?\d+>$/.test(firstArg);
        if (!isMention && mentionedUsers.length > 0) {
            const matchedUser = mentionedUsers.find(u => {
                const lower = firstArg.toLowerCase().replace(/^@/, '');
                return u.username.toLowerCase() === lower || u.tag?.toLowerCase() === lower || u.displayName?.toLowerCase() === lower;
            });
            if (matchedUser) corrected[0] = `<@${matchedUser.id}>`;
            else if (mentionedUsers.length === 1) corrected[0] = `<@${mentionedUsers[0].id}>`;
        }
    }

    const needsNumber = ['clear', 'slots', 'cf'];
    if (needsNumber.includes(commandName) && corrected.length > 0) {
        for (let i = 0; i < corrected.length; i++) {
            const numMatch = corrected[i].match(/\d+/);
            if (numMatch && corrected[i] !== numMatch[0]) corrected[i] = numMatch[0];
        }
    }

    if (commandName === 'timeout') {
        for (let i = 0; i < corrected.length; i++) {
            const durMatch = corrected[i].match(/^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|day|days?)$/i);
            if (durMatch) {
                const unitMap = { s: 's', sec: 's', second: 's', seconds: 's', m: 'm', min: 'm', minute: 'm', minutes: 'm', h: 'h', hr: 'h', hour: 'h', hours: 'h', d: 'd', day: 'd', days: 'd' };
                corrected[i] = `${durMatch[1]}${unitMap[durMatch[2].toLowerCase()] || 'm'}`;
            }
        }
    }

    dbgExec(`│ │ final args: [${corrected.map(a => `"${a}"`).join(', ')}]`);
    dbgExec(`│ └───`);
    return corrected;
}

// ============================================================================
//  LLM INTERFACE
// ============================================================================
function buildSystemPrompt(client) {
    const seen = new Set();
    const names = [];
    for (const [name] of client.prefixCommands) {
        if (seen.has(name)) continue;
        seen.add(name);
        names.push(name);
    }

    return `you are a command parser for a discord bot. return ONLY a json array. no markdown, no text, no code blocks.
each element: {"command":"name","args":["arg1"]}
for slash commands with subcommands use: {"command":"slash:commandname:subcommand","args":["arg1"]}
chat: [{"chat":"response"}] | error: [{"error":"msg"}]
pass user mentions as-is (e.g. <@123>). durations: 5m,1h,1d.

IMPORTANT: ALWAYS try to map the user's request to a command. never respond with chat or error if a command could handle the request. if someone asks about a user, use whois. if they ask about the server, use server. you are a command executor, not an assistant.

prefix commands: ${names.join(',')}

slash commands with subcommands:
- music: play <query>, queue, nowplaying, skip, stop, loop [mode], clear, disconnect
- antiraid: status, toggle <true/false>, emergency, stats

note: urlscan is a prefix command. use {"command":"urlscan","args":["url"]}.

examples:
"who is <@123>"→[{"command":"whois","args":["<@123>"]}]
"who is this <@123> guy"→[{"command":"whois","args":["<@123>"]}]
"check <@123>'s info"→[{"command":"whois","args":["<@123>"]}]
"tell me about <@123>"→[{"command":"whois","args":["<@123>"]}]
"play despacito"→[{"command":"slash:music:play","args":["despacito"]}]
"skip the song"→[{"command":"slash:music:skip","args":[]}]
"stop music"→[{"command":"slash:music:stop","args":[]}]
"whats playing"→[{"command":"slash:music:nowplaying","args":[]}]
"disconnect from vc"→[{"command":"slash:music:disconnect","args":[]}]
"loop track"→[{"command":"slash:music:loop","args":["track"]}]
"antiraid status"→[{"command":"slash:antiraid:status","args":[]}]
"enable antiraid"→[{"command":"slash:antiraid:toggle","args":["true"]}]
"emergency disable"→[{"command":"slash:antiraid:emergency","args":[]}]
"scan this url https://example.com"→[{"command":"urlscan","args":["https://example.com"]}]
"set a timer for 5 minutes to check oven"→[{"command":"timer","args":["5","minutes","check oven"]}]
"remind me in 1 hour about meeting"→[{"command":"timer","args":["1","hours","meeting"]}]
"ban @user spam"→[{"command":"ban","args":["@user","spam"]}]
"kick @a and clear 20"→[{"command":"kick","args":["@a"]},{"command":"clear","args":["20"]}]
"server info"→[{"command":"server","args":[]}]
"hey"→[{"chat":"hey! what command do you need?"}]`;
}

async function callLLM(userMessage, client) {
    const systemPrompt = buildSystemPrompt(client);
    const conversation = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
    ];

    dbgLLM(`sending request...`);
    dbgLLM(`user message: "${userMessage}"`);
    const startTime = Date.now();

    const response = await axios.post(
        'https://api.electronhub.ai/v1/chat/completions',
        { model: 'gpt-4.1-nano', messages: conversation, temperature: 0.1 },
        { headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    const result = response.data.choices[0]?.message?.content;
    dbgLLM(`response (${Date.now() - startTime}ms): ${result}`);
    dbgLLM(`tokens: prompt=${response.data.usage?.prompt_tokens || '?'}, completion=${response.data.usage?.completion_tokens || '?'}`);
    return result;
}

function parseLLMResponse(raw) {
    if (!raw) return null;
    let cleaned = raw.trim();

    // strip markdown code blocks
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

    // try direct parse first (works for most responses)
    try {
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        // parse failed, try to extract
    }

    // extract the first complete json array using bracket counting
    const arrStart = cleaned.indexOf('[');
    if (arrStart === -1) {
        dbgErr(`failed to parse llm response (no array found): ${cleaned}`);
        return null;
    }

    let depth = 0;
    let arrEnd = -1;
    for (let i = arrStart; i < cleaned.length; i++) {
        if (cleaned[i] === '[') depth++;
        else if (cleaned[i] === ']') {
            depth--;
            if (depth === 0) { arrEnd = i; break; }
        }
    }

    if (arrEnd === -1) {
        dbgErr(`failed to parse llm response (incomplete array): ${cleaned}`);
        return null;
    }

    const extracted = cleaned.substring(arrStart, arrEnd + 1);
    if (extracted !== cleaned) dbgLLM(`extracted first json array from noisy response`);

    try {
        const parsed = JSON.parse(extracted);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        dbgErr(`failed to parse llm response: ${extracted}`);
        return null;
    }
}

// ============================================================================
//  USER MENTION RESOLVER
// ============================================================================
function resolveUserMentions(argStr, message) {
    const mentionedUsers = message.mentions.users;
    if (mentionedUsers.size === 0) return argStr;
    for (const [id, user] of mentionedUsers) {
        if (id === message.client.user.id) continue;
        for (const pattern of [user.username, user.tag, user.displayName].filter(Boolean)) {
            if (argStr.toLowerCase().includes(pattern.toLowerCase())) {
                argStr = argStr.replace(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), `<@${id}>`);
            }
        }
    }
    return argStr;
}

// ============================================================================
//  GENERIC SLASH OPTIONS MAPPER
//  reads option definitions from command.data and maps positional args
// ============================================================================
function buildSlashOptionsMap(command, resolvedName, subcommand, args) {
    const optionsMap = {};

    // explicit overrides for commands where we know the semantics
    if (resolvedName === 'music') {
        if (subcommand === 'play') { optionsMap.query = args.join(' ') || null; optionsMap.source = null; }
        if (subcommand === 'loop') optionsMap.mode = args[0] || null;
        return optionsMap;
    }
    if (resolvedName === 'antiraid') {
        if (subcommand === 'toggle') {
            const val = (args[0] || '').toLowerCase();
            optionsMap.enabled = val === 'true' || val === 'on' || val === 'enable' || val === 'yes';
        }
        return optionsMap;
    }

    // generic auto-mapping: read option definitions from command.data
    try {
        const cmdData = command.data;
        if (!cmdData) return optionsMap;

        let optionDefs = [];

        // check if this is a subcommand-based command
        if (subcommand && cmdData.options) {
            // find the subcommand definition
            // discord.js option types: 1=SUB_COMMAND, 2=SUB_COMMAND_GROUP, 3=STRING, 4=INTEGER, 5=BOOLEAN, 6=USER, 7=CHANNEL, 8=ROLE, 10=NUMBER
            const subCmd = cmdData.options.find(o => (o.type === 1) && o.name === subcommand);
            if (subCmd && subCmd.options) optionDefs = subCmd.options;
        } else if (cmdData.options) {
            // top-level options (no subcommands)
            optionDefs = cmdData.options.filter(o => o.type !== 1 && o.type !== 2);
        }

        if (optionDefs.length === 0) return optionsMap;

        dbgSlash(`auto-mapping ${args.length} arg(s) to ${optionDefs.length} option def(s): [${optionDefs.map(o => o.name).join(', ')}]`);

        // map positional args to option defs in order
        for (let i = 0; i < optionDefs.length && i < args.length; i++) {
            const opt = optionDefs[i];
            const rawVal = args[i];

            switch (opt.type) {
                case 4: // INTEGER
                case 10: // NUMBER
                    optionsMap[opt.name] = parseFloat(rawVal);
                    break;
                case 5: // BOOLEAN
                    const boolVal = rawVal.toLowerCase();
                    optionsMap[opt.name] = boolVal === 'true' || boolVal === 'on' || boolVal === 'yes' || boolVal === 'enable';
                    break;
                case 3: // STRING
                default:
                    // if it's the last option def and there are remaining args, join them
                    if (i === optionDefs.length - 1 && args.length > optionDefs.length) {
                        optionsMap[opt.name] = args.slice(i).join(' ');
                    } else {
                        optionsMap[opt.name] = rawVal;
                    }
                    break;
            }
        }

        dbgSlash(`mapped options: ${JSON.stringify(optionsMap)}`);
    } catch (err) {
        dbgErr(`options auto-map error: ${err.message}`);
    }

    return optionsMap;
}

// ============================================================================
//  MAIN HANDLER
// ============================================================================
async function handleAgentMessage(message, client) {
    if (!AUTHORIZED_USER_IDS.includes(message.author.id)) return false;

    const botMentionRegex = new RegExp(`<@!?${client.user.id}>`);
    if (!botMentionRegex.test(message.content)) return false;

    const userRequest = message.content.replace(botMentionRegex, '').trim();
    if (!userRequest) {
        await message.reply({
            embeds: [new EmbedBuilder()
                .setDescription('<a:eh:1342443037371928627> hey! tell me what you need and i\'ll run the commands for you~')
                .setColor(0x5865f2)]
        });
        return true;
    }

    const now = Date.now();
    if (cooldowns.has(message.author.id)) {
        if (now < cooldowns.get(message.author.id)) return true;
    }
    cooldowns.set(message.author.id, now + COOLDOWN_MS);

    await message.channel.sendTyping();

    const pipelineStart = Date.now();
    dbg(`╔══════════════════════════════════════════════════════════════`);
    dbg(`║ 🧠 AI AGENT PIPELINE STARTED`);
    dbg(`║ user: ${message.author.tag} (${message.author.id})`);
    dbg(`║ guild: ${message.guild.name} | #${message.channel.name}`);
    dbg(`║ input: "${userRequest}"`);
    dbg(`║ mentions: [${message.mentions.users.filter(u => u.id !== client.user.id).map(u => u.tag).join(', ')}]`);
    dbg(`╠══════════════════════════════════════════════════════════════`);

    try {
        dbg(`║ 📡 step 1: calling llm...`);
        const rawResponse = await callLLM(userRequest, client);
        const actions = parseLLMResponse(rawResponse);

        if (!actions || !Array.isArray(actions) || actions.length === 0) {
            dbg(`║ ❌ no valid actions`);
            dbg(`╚══════════════════════════════════════════════════════════════`);
            await message.reply({ embeds: [new EmbedBuilder().setDescription('❌ couldn\'t understand that.').setColor(0xff4747)] });
            return true;
        }

        dbg(`║ 📋 step 2: parsed ${actions.length} action(s)`);
        actions.forEach((a, i) => dbg(`║   [${i}] ${JSON.stringify(a)}`));

        if (actions.length === 1 && actions[0].chat) {
            dbg(`║ 💬 chat response`);
            dbg(`╚══════════════════════════════════════════════════════════════`);
            await message.reply({ embeds: [new EmbedBuilder().setDescription(actions[0].chat).setColor(0x5865f2)] });
            return true;
        }
        if (actions.length === 1 && actions[0].error) {
            dbg(`║ ⚠️  ai error: ${actions[0].error}`);
            dbg(`╚══════════════════════════════════════════════════════════════`);
            await message.reply({ embeds: [new EmbedBuilder().setDescription(`⚠️ ${actions[0].error}`).setColor(0xffa500)] });
            return true;
        }

        dbg(`║ 🔍 step 3: resolve & execute`);
        const results = [];
        let commandsRun = 0;

        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            if (!action.command) continue;

            const rawName = action.command.toLowerCase();
            dbg(`║ ─── command ${i + 1}: "${rawName}"`);

            const resolved = fuzzyResolveCommand(rawName, client.prefixCommands, client.slashCommands);

            if (!resolved) {
                dbgErr(`no match for "${rawName}"`);
                results.push(`❌ \`${rawName}\` — not found`);
                continue;
            }

            const { command, name: resolvedName, subcommand, confidence, method, autocorrected, isSlash } = resolved;

            if (autocorrected) dbg(`║ ✏️  autocorrected: "${rawName}" → "${resolvedName}" (${method})`);
            if (confidence < 0.5) dbg(`║ ⚠️  low confidence: ${(confidence * 100).toFixed(1)}%`);

            let args = (action.args || []).map(arg => resolveUserMentions(String(arg), message));

            try {
                const execStart = Date.now();

                if (isSlash) {
                    // ===== SLASH COMMAND EXECUTION VIA FAKE INTERACTION =====
                    dbgSlash(`executing slash "${resolvedName}" subcommand="${subcommand}" args: [${args.join(', ')}]`);

                    // build options map from args based on the subcommand
                    const optionsMap = buildSlashOptionsMap(command, resolvedName, subcommand, args);

                    const fakeInteraction = createFakeInteraction(message, client, subcommand, optionsMap);
                    await command.execute(fakeInteraction);

                    commandsRun++;
                    const acLabel = autocorrected ? ` (from "${rawName}")` : '';
                    results.push(`✅ \`${resolvedName}${subcommand ? ':' + subcommand : ''}\`${acLabel} — ${Date.now() - execStart}ms`);
                    dbgSlash(`✅ completed in ${Date.now() - execStart}ms`);

                } else {
                    // ===== PREFIX COMMAND EXECUTION =====
                    args = autocorrectArgs(resolvedName, args, message);
                    dbgExec(`executing "${resolvedName}" with args: [${args.join(', ')}]`);

                    const fakeMessage = Object.create(message);
                    const guildPrefix = client.prefixCache?.get(message.guild.id) || '!';
                    fakeMessage.content = `${guildPrefix}${resolvedName} ${args.join(' ')}`.trim();

                    // filter bot from mentions
                    const botId = client.user.id;
                    const cleanMentions = Object.create(message.mentions);
                    const filteredUsers = new Collection([...message.mentions.users.entries()].filter(([id]) => id !== botId));
                    Object.defineProperty(cleanMentions, 'users', { value: filteredUsers, writable: true });
                    if (message.mentions.members) {
                        const filteredMembers = new Collection([...message.mentions.members.entries()].filter(([id]) => id !== botId));
                        Object.defineProperty(cleanMentions, 'members', { value: filteredMembers, writable: true });
                    }
                    fakeMessage.mentions = cleanMentions;

                    await command.execute(fakeMessage, args, client);
                    commandsRun++;
                    const acLabel = autocorrected ? ` (from "${rawName}")` : '';
                    results.push(`✅ \`${resolvedName}\`${acLabel} — ${Date.now() - execStart}ms`);
                    dbgExec(`✅ completed in ${Date.now() - execStart}ms`);
                }

            } catch (error) {
                dbgErr(`execution failed for "${resolvedName}":`, error.message);
                results.push(`❌ \`${resolvedName}\` — ${error.message}`);
            }
        }

        const commandActions = actions.filter(a => a.command);
        if (commandActions.length > 1) {
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('<a:eh:1342443037371928627> Agent Results')
                    .setDescription(results.join('\n'))
                    .setColor(commandsRun > 0 ? 0x57f287 : 0xff4747)
                    .setFooter({ text: `${commandsRun}/${commandActions.length} commands executed` })]
            });
        }

        dbg(`╠══════════════════════════════════════════════════════════════`);
        dbg(`║ ✅ PIPELINE COMPLETE: ${commandsRun}/${commandActions.length} | ${Date.now() - pipelineStart}ms`);
        dbg(`╚══════════════════════════════════════════════════════════════`);
        return true;

    } catch (error) {
        dbgErr(`pipeline error:`, error.message);
        dbg(`╚══════════════════════════════════════════════════════════════`);
        await message.reply({ embeds: [new EmbedBuilder().setDescription('❌ ai agent error. try again!').setColor(0xff4747)] });
        return true;
    }
}

module.exports = { handleAgentMessage };
