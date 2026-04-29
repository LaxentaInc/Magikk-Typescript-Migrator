const { EmbedBuilder } = require('discord.js');
const { CUSTOM_ICON } = require('./embeds');

/**
 * Create a "dumb" error embed for user mistakes (e.g. Album links)
 */
function createDumbErrorEmbed(type, user) {
    const embed = new EmbedBuilder()
        .setAuthor({
            name: 'Unsupported Link Type',
            iconURL: CUSTOM_ICON
        })
        .setTimestamp();

    if (type === 'album') {
        embed.setDescription(`**Hey ${user}, are you dumb?**\n\nI cannot play **Spotify Albums** directly because they are not playable sources.\n\n**Solution:**\n- Create a **Playlist** instead of an Album.\n- Share the **Playlist Link**.\n- Use a supported format.`)
            .setFooter({ text: 'Album links ≠ Playlist links • Please learn the difference' });
    } else if (type === 'artist') {
        embed.setDescription(`**Hey ${user}, are you dumb?**\n\nI cannot play **Spotify Artists** Like, do you even see yourself mate??.\n\n**Solution:**\n- Share a specific **Track** or **Playlist**.\n- Don't send Artist profiles.\n- Use a supported format idiot.`)
            .setFooter({ text: 'Artist profiles are not playable • Please learn how this works' });
    } else {
        embed.setDescription(`**Hey ${user}, that link is invalid.**\nPlease provide a valid link supported by the bot.`);
    }

    return embed;
}

/**
 * Create error embed for unsupported domains
 */
function createDomainErrorEmbed(domain, user) {
    return new EmbedBuilder()
        .setAuthor({
            name: 'Unsupported Domain',
            iconURL: CUSTOM_ICON
        })
        .setDescription(`**Hey ${user}, that domain is not allowed.**\n\nI only support links from:\n- <a:VinylRecord_1338415159672307806:1342442912746704998> **Spotify**\n- <a:VinylRecord_1338415159672307806:1342442912746704998> **YouTube**\n- <a:VinylRecord_1338415159672307806:1342442912746704998> **SoundCloud**\n\n**${domain}** is not supported.`)
        .setFooter({ text: 'Please use a supported music source' })
        .setTimestamp();
}

/**
 * Create generic error embed without color
 */
function createSafeErrorEmbed(title, description) {
    return new EmbedBuilder()
        .setAuthor({ name: `❌ ${title}`, iconURL: CUSTOM_ICON })
        .setDescription(description)
        .setTimestamp();
}

/**
 * Create error embed for private Spotify playlists
 */
function createPrivatePlaylistErrorEmbed(user) {
    return new EmbedBuilder()
        .setAuthor({
            name: 'Private Playlist Detected',
            iconURL: CUSTOM_ICON
        })
        .setDescription(`**Hey ${user}, are you dumb?**\n\nThis playlist is **PRIVATE**. I can't access private playlists because, you know, they're **PRIVATE**.\n\n**Solution:**\n- Go to Spotify and make the playlist **PUBLIC**\n- Right-click playlist → Make public\n- Then share the link again\n\nOr, you know, just keep it private and expect magic to happen. Your choice.`)
        .setFooter({ text: 'Private ≠ Public • Amazing discovery, right?' })
        .setTimestamp();
}

module.exports = {
    createDumbErrorEmbed,
    createDomainErrorEmbed,
    createSafeErrorEmbed,
    createPrivatePlaylistErrorEmbed
};