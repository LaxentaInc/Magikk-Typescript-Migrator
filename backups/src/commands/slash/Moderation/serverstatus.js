const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

// Fetch server status from the API
async function fetchServerStatus(serverAddress) {
  try {
    const response = await axios.get(`https://api.mcsrvstat.us/3/${serverAddress}`, {
      headers: {
        'User-Agent': 'laxentaio/1.0'
      }
    });
    // If the server is offline or lacks a version, simulate offline data
    if (!response.data.online || !response.data.version) {
      return { online: false };
    }
    return response.data;
  } catch (error) {
    console.error(`Error fetching server status: ${error}`);
    return null;
  }
}

// Create a status message based on the fetched data
function createServerStatusMessage(data, serverAddress) {
  // Determine if the server is offline
  const isServerOffline =
    !data.version ||
    (typeof data.version === 'string' && data.version.toLowerCase() === 'offline');

  if (isServerOffline) {
    let errorMessage = `Server ${serverAddress} is **offline**.`;
    if (data.debug && data.debug.error) {
      const errorDetails = [];
      if (data.debug.error.ping) errorDetails.push(`Ping error: ${data.debug.error.ping}`);
      if (data.debug.error.query) errorDetails.push(`Query error: ${data.debug.error.query}`);
      errorMessage += `\n**Errors**:\n${errorDetails.join('\n')}`;
    }
    return `<a:load:1342443908189257728> ${errorMessage}\n` +
           `<a:server:1342443908189257728> **Server IP**: ${serverAddress}\n` +
           `<a:mc:1342443908189257728> **Version**: Offline\n` +
           `⚡ **Players**: N/A\n⚡ **Ping**: N/A ms`;
  }

  // Format online server data
  const playersOnline = data.players && data.players.online ? data.players.online : 0;
  const playersMax = data.players && data.players.max ? data.players.max : 'N/A';
  const playersInfo = `<a:player:1342443460556361768> Players: ${playersOnline}/${playersMax}`;
  const pingInfo = `⚡ Ping: ${data.ping || 'N/A'} ms`;
  let motd = 'N/A';
  if (data.motd && data.motd.clean) {
    motd = Array.isArray(data.motd.clean) ? data.motd.clean.join(' ') : data.motd.clean;
  }
  const software = data.software || 'Unknown';

  return `<a:server:1342443585869447178> **Server IP**: ${serverAddress}\n` +
         `<a:mc:1342443908189257728> **Version**: ${data.version || 'N/A'}\n` +
         `<a:motd:1342443376842248282> **MOTD**: ${motd}\n` +
         `<a:software:1342443908189257728> **Software**: ${software}\n` +
         `**${playersInfo}**\n**${pingInfo}**`;
}

// Handle errors and send an appropriate response
function handleError(error, interaction) {
  console.error('Error in serverstatus command:', error);
  if (error.message && error.message.includes('timeout')) {
    return interaction.editReply('⏳ Connection timeout occurred. Please try again later.');
  } else {
    return interaction.editReply('💥 An error occurred while executing this command. Please try again.');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mcstatus')
    .setDescription('Fetches the status (online/offline, players, etc.) of a Minecraft server')
    .addStringOption(option =>
      option
        .setName('server')
        .setDescription('The server address (e.g. hypixel.net)')
        .setRequired(true)
    ),
  async execute(interaction) {
    const serverAddress = interaction.options.getString('server');
    try {
      await interaction.deferReply();
      const data = await fetchServerStatus(serverAddress);
      if (!data) {
        return interaction.editReply('❌ Failed to retrieve server status.');
      }
      const statusMessage = createServerStatusMessage(data, serverAddress);
      return interaction.editReply(statusMessage);
    } catch (error) {
      return handleError(error, interaction);
    }
  }
};