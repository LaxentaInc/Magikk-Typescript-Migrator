const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');

// ========== GLOBAL CACHE (SHARED ACROSS ALL USERS) ==========
const scrapedImagesCache = {
  images: [],
  lastFetch: 0,
  isLoading: false, // Prevent multiple simultaneous scrapes
  CACHE_DURATION: 1000 * 60 * 120 // 2 hours FOR NOW

};

// Per-user cache ONLY to avoid showing same image twice to same user
const userRecentImages = new Map();
const USER_CACHE_SIZE = 50;

// ========== 4KWALLPAPERS SCRAPER ==========
async function scrape4kWallpapers() {
  const now = Date.now();

  // Return cached images if still valid (INSTANT)
  if (scrapedImagesCache.images.length > 0 &&
    now - scrapedImagesCache.lastFetch < scrapedImagesCache.CACHE_DURATION) {
    return scrapedImagesCache.images;
  }

  // If cache expired but scraping already in progress, return empty (will use fallback)
  if (scrapedImagesCache.isLoading) {
    return scrapedImagesCache.images; // Return old cache or empty
  }

  // Start background scraping (non-blocking)
  startBackgroundScrape();

  // Return whatever we have (old cache or empty) - user gets instant response
  return scrapedImagesCache.images;
}

// Background scraper - runs asynchronously without blocking commands
function startBackgroundScrape() {
  scrapedImagesCache.isLoading = true;

  console.log('[4kwallpapers] 🔄 Starting background scrape (non-blocking)...');

  // Fire and forget - don't await
  (async () => {
    const images = [];
    const startTime = Date.now();

    try {
      // Scrape 50 random pages
      const randomPages = [];
      while (randomPages.length < 50) {
        const page = Math.floor(Math.random() * 100) + 1;
        if (!randomPages.includes(page)) randomPages.push(page);
      }

      for (const pageNum of randomPages) {
        try {
          const url = pageNum === 1
            ? 'https://4kwallpapers.com/waifu-wallpapers/'
            : `https://4kwallpapers.com/waifu-wallpapers/?page=${pageNum}`;

          const { data } = await axios.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html',
              'Referer': 'https://4kwallpapers.com/'
            },
            timeout: 8000
          });

          const $ = cheerio.load(data);

          $('link[itemprop="contentUrl"]').each((i, elem) => {
            const imageUrl = $(elem).attr('href');
            if (imageUrl && imageUrl.includes('4kwallpapers.com/images/wallpapers/')) {
              images.push(imageUrl);
            }
          });
        } catch (e) {
          // Silent fail for individual pages
        }

        // Minimal delay
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Update global cache
      scrapedImagesCache.images = images;
      scrapedImagesCache.lastFetch = Date.now();

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[4kwallpapers] ✅ Background scrape complete: ${images.length} images cached for 2 hours (took ${duration}s)`);

    } catch (error) {
      console.error('[4kwallpapers] Background scrape failed:', error.message);
    } finally {
      scrapedImagesCache.isLoading = false;
    }
  })(); // Immediately invoked async function
}

// ========== WAIFU.PICS API ==========
async function getWaifuPicsImage() {
  const endpoints = ['waifu', 'neko', 'shinobu', 'megumin', 'awoo', 'cute'];
  const randomEndpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

  try {
    const response = await axios.get(`https://api.waifu.pics/sfw/${randomEndpoint}`, { timeout: 3000 });
    return response.data.url;
  } catch {
    return null;
  }
}

// ========== COMMAND ==========
module.exports = {
  data: new SlashCommandBuilder()
    .setName('waifu')
    .setDescription('Sends a random SFW anime waifu')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const userId = interaction.user.id;

      // Get user's recent images (or empty array)
      const userRecent = userRecentImages.get(userId) || [];

      let imageUrl = null;

      // 70% chance 4kwallpapers, 30% waifu.pics
      if (Math.random() < 0.7) {
        // Get from global cache (instant - doesn't block even if scraping)
        const cachedImages = await scrape4kWallpapers();

        if (cachedImages.length > 0) {
          // Filter out user's recent images
          const available = cachedImages.filter(url => !userRecent.includes(url));

          if (available.length > 0) {
            imageUrl = available[Math.floor(Math.random() * available.length)];
          } else {
            // User has seen too many, just pick random
            imageUrl = cachedImages[Math.floor(Math.random() * cachedImages.length)];
          }
        }
        // If cachedImages is empty, imageUrl stays null and we fall through to waifu.pics
      }

      // Fallback to waifu.pics if no image yet
      if (!imageUrl) {
        imageUrl = await getWaifuPicsImage();
      }

      // Final fallback
      if (!imageUrl) {
        const response = await axios.get('https://api.waifu.pics/sfw/waifu', { timeout: 3000 });
        imageUrl = response.data.url;
      }

      // Update user's recent images
      if (imageUrl) {
        userRecent.push(imageUrl);
        if (userRecent.length > USER_CACHE_SIZE) {
          userRecent.shift();
        }
        userRecentImages.set(userId, userRecent);

        await interaction.editReply(imageUrl);
      } else {
        await interaction.editReply('💥 All sources failed! Try again!');
      }

    } catch (error) {
      console.error('[waifu] Error:', error.message);
      await interaction.editReply('🔥 Something went wrong! Please try again!');
    }
  },
};