const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");
const axios = require("axios");

// Cache for video details (keyed by baseId)
const videoCache = new Map();
// Per-user cache to track shown video IDs with more aggressive tracking
const userShownVideos = new Map();
// Cache for tag suggestions to reduce API calls
const tagSuggestionsCache = new Map();

function setUserCacheTimeout(userId) {
  if (userShownVideos.has(userId)) {
    const entry = userShownVideos.get(userId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => userShownVideos.delete(userId), 5 * 60 * 1000); // 5 minutes timeout
  } else {
    const timer = setTimeout(() => userShownVideos.delete(userId), 5 * 60 * 1000);
    userShownVideos.set(userId, { videos: new Set(), timer });
  }
}

async function getAuthToken() {
  try {
    const res = await axios.get("https://api.redgifs.com/v2/auth/temporary");
    return res.data.token;
  } catch (error) {
    console.error("Couldn't grab the token:", error);
    return null;
  }
}

async function fetchMedia(tag) {
  const token = await getAuthToken();
  if (!token) return null;
  try {
    const res = await axios.get("https://api.redgifs.com/v2/gifs/search", {
      headers: { Authorization: `Bearer ${token}` },
      params: { search_text: tag, count: 100, order: "trending" }
    });
    const gifs = res.data.gifs;
    if (!gifs || gifs.length === 0) return null;
    return gifs;
  } catch (error) {
    console.error("Error fetching media:", error);
    return null;
  }
}

async function updateReply(interaction, data) {
  if (interaction.guild) {
    return await interaction.editReply(data).then(res => res);
  } else {
    const reply = await interaction.fetchReply();
    return await interaction.webhook.editMessage(reply.id, data);
  }
}

/**
 * Get the best matching tag from suggestions or return the original if no match
 */
async function getBestMatchingTag(userInput) {
  const suggestions = await getTagSuggestions(userInput, 25);
  if (suggestions.length === 0) return userInput;

  // Find exact match first
  const exactMatch = suggestions.find(tag => tag.toLowerCase() === userInput.toLowerCase());
  if (exactMatch) return exactMatch;

  // Find closest match (starts with user input)
  const startsWith = suggestions.find(tag => tag.toLowerCase().startsWith(userInput.toLowerCase()));
  if (startsWith) return startsWith;

  // Find contains match
  const contains = suggestions.find(tag => tag.toLowerCase().includes(userInput.toLowerCase()));
  if (contains) return contains;

  // Return most popular suggestion or original input
  return suggestions[0] || userInput;
}

/**
 * Aggressive randomization - ensures no repeats for same user
 */
function selectRandomVideo(videos, userId) {
  const userEntry = userShownVideos.get(userId) || { videos: new Set() };

  // Filter out already shown videos
  let available = videos.filter(video => !userEntry.videos.has(video.id));

  // If all videos have been shown, reset the cache for this user
  if (available.length === 0) {
    console.log(`Resetting video cache for user ${userId} - all videos seen`);
    userEntry.videos.clear();
    available = [...videos]; // Reset to all videos
  }

  // Shuffle the available videos for better randomness
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  // Select random video from shuffled array
  const selectedVideo = available[Math.floor(Math.random() * available.length)];

  // Add to user's seen videos
  userEntry.videos.add(selectedVideo.id);
  userShownVideos.set(userId, userEntry);

  return selectedVideo;
}

/**
 * Get video category/tags for display
 */
function getVideoCategory(video) {
  if (video.tags && video.tags.length > 0) {
    // Capitalize first tag as category
    return video.tags[0].charAt(0).toUpperCase() + video.tags[0].slice(1);
  }
  return "General";
}

/**
 * Sends (or updates) the reply with the video link and interactive buttons.
 * Now includes category and requested by information.
 */
async function sendMedia(interaction, tag, isPublic) {
  // Update cache for this user
  setUserCacheTimeout(interaction.user.id);

  // Get best matching tag
  const bestTag = await getBestMatchingTag(tag);
  const videos = await fetchMedia(bestTag);

  if (!videos) {
    await interaction.followUp({
      content: `Oops! Couldn't find any results for "${tag}". Try something simpler or check the autocomplete suggestions.`,
      ephemeral: !isPublic
    });
    return null;
  }

  // Use aggressive randomization
  const selectedVideo = selectRandomVideo(videos, interaction.user.id);

  // Pick HD if available, else SD.
  const videoUrl = selectedVideo.urls.hd || selectedVideo.urls.sd;
  const baseId = `${bestTag}_${interaction.id}_${Date.now()}`;
  videoCache.set(baseId, { ...selectedVideo, searchTag: bestTag });

  // Get category for display
  const category = getVideoCategory(selectedVideo);

  // Format content with category and requested by info
  const content = `**Category:** \`${category}\`\n[<a:ehh:1342442813648011266>](${videoUrl})\n-# *Requested by:* \`${interaction.user.username}\``;

  // Create our buttons: Next, Details, Share, and Delete.
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`next_${baseId}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`details_${baseId}`)
      .setLabel("Details")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`share_${baseId}`)
      .setLabel("Share")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`delete_${baseId}`)
      .setLabel("Delete")
      .setStyle(ButtonStyle.Danger)
  );

  await updateReply(interaction, { content, components: [buttons] });
  return await interaction.fetchReply();
}

/**
 * Registers a collector for the interactive buttons.
 * Handles Next, Details, Delete, and Share with custom logic.
 */
function registerButtonHandlers(interaction, tag, message, isPublic) {
  const baseId = `${tag}_${interaction.id}`;
  const filter = (i) =>
    (i.customId.includes(`next_`) ||
      i.customId.includes(`details_`) ||
      i.customId.includes(`share_`) ||
      i.customId.includes(`delete_`)) &&
    i.user.id === interaction.user.id;

  const collector = message.createMessageComponentCollector({ filter, time: 300000 }); // 5 minutes

  collector.on("collect", async (i) => {
    const buttonBaseId = i.customId.split('_').slice(1).join('_');

    if (i.customId.startsWith("delete_")) {
      await i.deferUpdate();
      try {
        if (!isPublic) {
          await interaction.deleteReply();
        } else {
          await message.delete();
        }
      } catch (err) {
        console.error("Error deleting message:", err);
      }
      collector.stop("delete");
    } else if (i.customId.startsWith("share_")) {
      await i.deferUpdate();
      const video = videoCache.get(buttonBaseId);
      if (video) {
        const videoUrl = video.urls.hd || video.urls.sd;
        const category = getVideoCategory(video);
        const formattedLink = `**Category:** \`${category}\`\n[<a:ehh:1342442813648011266>](${videoUrl})\n-# *Shared by:* \`${interaction.user.username}\``;

        if (isPublic) {
          // NSFW channel: share directly with a public follow-up.
          await interaction.followUp({ content: formattedLink, ephemeral: false });
        } else {
          // Non-NSFW: send a public warning embed with a "View Content" button.
          const warningEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('Content Warning')
            .setDescription("Umm this shared content won't be auto-embedded in here.\nSo whoever is interested- click below to view it :3\nON your own risk btw :3")
            .setFooter({ text: `Shared by ${interaction.user.username}` });

          const viewButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`view_${buttonBaseId}`)
              .setLabel("View Content")
              .setStyle(ButtonStyle.Primary)
          );
          const warningMessage = await interaction.followUp({
            embeds: [warningEmbed],
            components: [viewButton],
            ephemeral: false
          });

          // Set up collector for the "View Content" button (allowing any user to click).
          const viewFilter = (btn) => btn.customId === `view_${buttonBaseId}`;
          const viewCollector = warningMessage.createMessageComponentCollector({ filter: viewFilter, time: 300000 });

          viewCollector.on("collect", async (btn) => {
            try {
              await btn.reply({ content: formattedLink, ephemeral: true });
            } catch (err) {
              console.error("Error replying to view button click:", err);
            }
          });

          viewCollector.on("end", async () => {
            const disabledViewButton = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`view_${buttonBaseId}`)
                .setLabel("View Content")
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true)
            );
            try {
              await warningMessage.edit({ components: [disabledViewButton] });
            } catch (err) {
              console.error("Error disabling view button on end:", err);
            }
          });
        }
      }
    } else if (i.customId.startsWith("details_")) {
      await i.deferUpdate();
      const video = videoCache.get(buttonBaseId);
      if (video) {
        const category = getVideoCategory(video);
        const tags = video.tags ? video.tags.slice(0, 5).join(', ') : 'None';
        const details = `**Video Details:**\n**ID:** ${video.id}\n**Resolution:** ${video.urls.hd ? "HD" : "SD"}\n**Category:** ${category}\n**Tags:** ${tags}\n**Search Term:** ${video.searchTag || tag}`;
        await interaction.followUp({ content: details, ephemeral: true });
      }
    } else if (i.customId.startsWith("next_")) {
      await i.deferUpdate();
      const newMessage = await sendMedia(interaction, tag, isPublic);
      if (newMessage) registerButtonHandlers(interaction, tag, newMessage, isPublic);
      collector.stop("next");
    }
  });

  collector.on("end", async (_collected, reason) => {
    if (reason !== "next" && reason !== "delete") {
      const disabledButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("disabled_next")
          .setLabel("Next")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("disabled_details")
          .setLabel("Details")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("disabled_share")
          .setLabel("Share")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("disabled_delete")
          .setLabel("Delete")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true)
      );
      try {
        await updateReply(interaction, { components: [disabledButtons] });
      } catch (err) {
        console.error("Error disabling buttons:", err);
      }
    }
  });
}

/**
 * Get tag suggestions from RedGIFs using the /v2/tags/suggest endpoint.
 * Now with caching to reduce API calls.
 */
async function getTagSuggestions(query, count = 25) {
  // Check cache first
  const cacheKey = `${query.toLowerCase()}_${count}`;
  if (tagSuggestionsCache.has(cacheKey)) {
    const cached = tagSuggestionsCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 300000) { // 5 minute cache
      return cached.data;
    }
  }

  const token = await getAuthToken();
  if (!token) {
    console.error("Couldn't get auth token for tag suggestions.");
    return [];
  }

  try {
    const res = await axios.get("https://api.redgifs.com/v2/tags/suggest", {
      headers: { Authorization: `Bearer ${token}` },
      params: { query, count }
    });

    // Cache the results
    tagSuggestionsCache.set(cacheKey, {
      data: res.data,
      timestamp: Date.now()
    });

    return res.data;
  } catch (error) {
    console.error("Error fetching tag suggestions:", error);
    return [];
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("realp")
    .setDescription("View random curated media from RedGifs")
    .addStringOption(option =>
      option.setName("tag")
        .setDescription("Enter search query (use autocomplete for best results)")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2),
  async execute(interaction) {
    const tag = interaction.options.getString("tag");
    const isPublic = interaction.channel && interaction.channel.nsfw;

    // NSFW channels: public reply; non-NSFW: ephemeral reply.
    await interaction.deferReply({ ephemeral: !isPublic }).then(res => res);
    const message = await sendMedia(interaction, tag, isPublic);
    if (message) registerButtonHandlers(interaction, tag, message, isPublic);
  },
  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    if (!focusedValue || focusedValue.length < 1) {
      await interaction.respond([]);
      return;
    }

    const suggestions = await getTagSuggestions(focusedValue, 25);
    const choices = suggestions
      .filter(tag => tag.toLowerCase().includes(focusedValue.toLowerCase()))
      .slice(0, 25)
      .map(tag => ({ name: tag, value: tag }));

    await interaction.respond(choices);
  }
};