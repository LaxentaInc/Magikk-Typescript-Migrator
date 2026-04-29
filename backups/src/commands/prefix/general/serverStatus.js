const axios = require('axios');

module.exports = {
    name: 'serverstatus',
    description: 'Fetches the status `online or offline, players etc.` of a Minecraft server',
    usage: '<serveraddress>',
    aliases: ['mcsrv'],
    async execute(message, args) {
        try {
            if (!args.length) {
                return message.reply('⚠️ Please provide the server address `ex - hypixel.net` to show status ;-;.');
            }

            const serverAddress = args.join(' ');
            const data = await fetchServerStatus(serverAddress);

            if (!data) {
                return message.reply('❌ Failed to retrieve server status.');
            }

            const statusMessage = createServerStatusMessage(data, serverAddress);
            
            // Reply with the formatted status message
            await message.reply(statusMessage);
        } catch (error) {
            handleError(error, message);
        }
    },
};

// Function to fetch server status using the API
async function fetchServerStatus(serverAddress) {
    try {
        const response = await axios.get(`https://api.mcsrvstat.us/3/${serverAddress}`);
        // Return null if the server is not online or lacks a version
        if (!response.data.online || !response.data.version) {
            return { online: false }; // Simulate offline data
        }
        return response.data;
    } catch (error) {
        console.error(`Error fetching server status: ${error}`);
        return null;
    }
}
function createServerStatusMessage(data, serverAddress) {
    // Determine if the server should be displayed as offline based on `version` or lack thereof
    const isServerOffline = !data.version || data.version.toLowerCase() === 'offline'; // Only checking `version`

    if (isServerOffline) {
        let errorMessage = `Server ${serverAddress} is **offline**.`;

        // Include specific error messages if available
        if (data.debug && data.debug.error) {
            const errorDetails = [];
            if (data.debug.error.ping) errorDetails.push(`Ping error: ${data.debug.error.ping}`);
            if (data.debug.error.query) errorDetails.push(`Query error: ${data.debug.error.query}`);
            errorMessage += `\n**Errors**:\n${errorDetails.join("\n")}`;
        }

        return `<a:load:1138688918573817876> ${errorMessage}\n` +
               `<a:server:1140133458606309386> **Server IP**: ${serverAddress}\n` +
               `<a:mc:1084349788402765894> **Version**: Offline\n` +
               `⚡ **Players**: N/A\n⚡ **Ping**: N/A ms`;
    }

    // Construct the message without the status field for an online server
    const playersInfo = `<a:player:1138688992724918342> Players: ${data.players.online || 0}/${data.players.max || 'N/A'}`;
    const pingInfo = `⚡ Ping: ${data.ping || 'N/A'} ms`;
    const motd = data.motd ? data.motd.clean.join(' ') : 'N/A'; // Clean MOTD if available
    const software = data.software || 'Unknown'; // Server software if available

    return `<a:server:1140133458606309386> **Server IP**: ${serverAddress}\n` +
           `<a:mc:1084349788402765894> **Version**: ${data.version || 'N/A'}\n` +
           `<a:motd:1296717153827033119> **MOTD**: ${motd}\n` +
           `<a:software:1140133458606309386> **Software**: ${software}\n` +
           `**${playersInfo}**\n**${pingInfo}**`;
}

function handleError(error, message) {
    if (error.message.includes('timeout')) {
        message.reply('⏳ Connection timeout occurred. Please try again later. <a:player:1138688904384479312> ');
    } else {
        message.reply('💥 An error occurred while executing this command. <a:player:1138688904384479312> Please try again.');
    }
    console.error('Error in serverstatus command:', error);
}