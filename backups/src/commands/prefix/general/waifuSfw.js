const axios = require("axios");

module.exports = {
  name: "waifu",
  description: "Sends a random SFW anime image.",
  usage: "!waifu",
  async execute(message, args) {
    try {
      const response = await axios.get("https://api.waifu.pics/sfw/waifu");
      const imageUrl = response.data.url;
      await message.channel.send(imageUrl);
     // console.log("executed successfully.");
    } catch (error) {
      console.error("Error:", error);
      message.reply(
        "Please try again later.",
      );
    }
  },
};
