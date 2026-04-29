const https = require('https');
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');

// Cache URLs to avoid hitting the "Top" lists every time
// 1hr TTL is plenty
const animeCache = new NodeCache({ stdTTL: 3600 });
const LIST_CACHE_KEY = 'cached_mal_urls';

// Custom HTTPS Agent to avoid SSL fingerprinting issues (ECONNRESET/EPROTO)
const agent = new https.Agent({
    keepAlive: true,
    minVersion: 'TLSv1.2',
    ciphers: 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384'
});

// we need to mimic a real browser
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
};

async function getSourceUrl() {
    let urls = animeCache.get(LIST_CACHE_KEY) || [];

    // If cache is empty or low, fetch more
    if (urls.length === 0) {
        try {
            // User requested to stick to Anime only (Manga pages often lack character info or have "shyt" results)
            const type = 'topanime.php';

            // Random limit: Top 5000 is usually safe for having characters
            // Going too deep (e.g. 10000) often hits obscure entries with 0 characters
            const limit = Math.floor(Math.random() * 100) * 50;

            const url = `https://myanimelist.net/${type}?limit=${limit}`;

            // Use custom agent and headers
            const response = await axios.get(url, {
                headers: HEADERS,
                timeout: 8000,
                httpsAgent: agent,
                decompress: true // Handle gzip
            });
            const $ = cheerio.load(response.data);

            // Scrape ALL detail links on this page
            // Anime links: https://myanimelist.net/anime/12345/Name
            // Manga links: https://myanimelist.net/manga/12345/Name
            $('a.hoverinfo_trigger').each((i, el) => {
                const href = $(el).attr('href');
                if (href) urls.push(href);
            });

            if (urls.length > 0) {
                // Cache for 1 hour
                animeCache.set(LIST_CACHE_KEY, urls);
            }
        } catch (error) {
            console.error("Error fetching MAL list:", error.message);
            // If specific SSL error, log it clearly
            if (error.code === 'EPROTO') {
                console.error("SSL Error detected. Converting agent...");
            }
            return null;
        }
    }

    if (urls.length === 0) return null;

    // Return random one
    return urls[Math.floor(Math.random() * urls.length)];
}

async function getCharacterData(mode = 'waifu') {
    // 1. Get Source URL (Anime or Manga)
    const sourceUrl = await getSourceUrl();
    if (!sourceUrl) throw new Error("Failed to find any anime or manga.");

    // 2. Fetch Source Page
    const sourceRes = await axios.get(sourceUrl, {
        headers: HEADERS,
        timeout: 5000,
        httpsAgent: agent
    });
    const $source = cheerio.load(sourceRes.data);

    // Try to get title from anime or manga page structure
    const title = $source('h1.title-name').text().trim() || $source('div.h1-title').text().trim() || $source('span[itemprop="name"]').first().text().trim();
    console.log(`[Scraper] Fetching characters for: ${title} (${sourceUrl})`);

    // Find characters
    // Modified to work for both Anime and Manga pages
    // We look for any link containing "/character/" that has text (name) and NO image children
    let charLinks = [];
    $source('a[href*="/character/"]').each((i, el) => {
        const url = $source(el).attr('href');
        const name = $source(el).text().trim();
        // Ignore links that wrap images (thumbnails) or have no name
        if (url && name && $source(el).find('img').length === 0) {
            // Avoid duplicates (MAL sometimes lists same char twice or desktop/mobile views)
            if (!charLinks.some(c => c.url === url)) {
                charLinks.push({ name, url });
            }
        }
    });

    if (charLinks.length === 0) {
        console.warn(`[Scraper] No characters found on page: ${sourceUrl}`);
        throw new Error("No characters found for this series.");
    }

    // Shuffle characters to try random ones
    charLinks = charLinks.sort(() => Math.random() - 0.5);

    // Try up to 5 characters to find a match for the requested mode
    // If we run out of retries, we just return the last one we found.
    const maxRetries = 5;
    let lastCharData = null;

    for (let i = 0; i < Math.min(charLinks.length, maxRetries); i++) {
        const charInfo = charLinks[i];

        try {
            // 3. Fetch Character Page
            const charRes = await axios.get(charInfo.url, {
                headers: HEADERS,
                timeout: 3000,
                httpsAgent: agent
            });
            const $char = cheerio.load(charRes.data);

            // Image
            const image = $char('td.borderClass img').attr('data-src') || $char('td.borderClass img').attr('src');

            // Japanese Name
            let jpName = null;
            const smallText = $char('h2.normal_header span small').text().trim();
            if (smallText) jpName = smallText;

            // BIO SCRAPING & GENDER DETECTION
            const bio = $char('div.content-container').text() || "";
            // The bio is often just in the main content div or following the header.
            // A more robust selector for MAL character bio is often text nodes under the content wrapper 
            // excluding specific divs. 
            // But counting pronouns in the whole body usually works fine for gender guess since 
            // the bio is the main text.
            const fullText = $char.text();

            const heCount = (fullText.match(/\bhe\b/gi) || []).length + (fullText.match(/\bhim\b/gi) || []).length;
            const sheCount = (fullText.match(/\bshe\b/gi) || []).length + (fullText.match(/\bher\b/gi) || []).length;

            let gender = 'Unknown';
            if (sheCount > heCount) gender = 'Female';
            if (heCount > sheCount) gender = 'Male';

            // Ensure we have valid data
            if (!image || !charInfo.name) continue;

            const isMatch = (mode === 'waifu' && gender === 'Female') ||
                (mode === 'husbando' && gender === 'Male') ||
                mode === 'all';

            if (isMatch) {
                console.log(`[Scraper] Match found: ${charInfo.name} (${gender})`);
            } else {
                // debug log (optional, maybe comment out for prod)
                // console.log(`[Scraper] Skipped ${charInfo.name} (${gender}) - Mode: ${mode}`);
            }

            lastCharData = {
                CharacterName: charInfo.name,
                CharacterImage: image,
                AnimeName: title,
                CharacterJapaneseName: jpName,
                OtherCharacterList: charLinks.map(c => c.name).filter(n => n !== charInfo.name),
                SourceUrl: charInfo.url,
                Gender: gender,
                BioSnippet: bio.substring(0, 100) // Debug info
            };

            // Filter Check
            if (mode === 'waifu' && gender === 'Female') return lastCharData;
            if (mode === 'husbando' && gender === 'Male') return lastCharData;
            if (mode === 'all') return lastCharData;

            // If we are here, gender didn't match. Loop continues to try next char.

        } catch (charErr) {
            console.warn(`Failed to fetch char ${charInfo.name}:`, charErr.message);
            continue;
        }
    }

    // If we exhausted retries or list, return the last valid one we found
    if (lastCharData) return lastCharData;

    throw new Error("Failed to find valid character data after retries.");
}

module.exports = {
    getCharacterData
};
