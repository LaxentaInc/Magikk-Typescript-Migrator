const axios = require("axios");

const getMeme = async () => {
  try {
    const response = await axios.get("https://meme-api.com/gimme");
    const memeUrl = response.data.url;
    return memeUrl;
  } catch (error) {
    console.error("Error fetching meme:", error);
    return "Failed to fetch a meme :(";
  }
};

module.exports = {
  name: "meme",
  description: "Sends a random meme.",
  async execute(message, args) {
    try {
      const memeUrl = await getMeme();

      if (memeUrl.startsWith("http")) {
        await message.channel.send(memeUrl); 
        //console.log("Meme command executed successfully.");
      } else {
        message.reply(memeUrl); //fetching failed ;cc
      }
    } catch (error) {
      console.error("Error executing the meme command:", error);
      message.reply("There was an error executing that command.");
    }
  },
};
