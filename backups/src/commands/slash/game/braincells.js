"use strict";
const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");
const API_KEY = process.env.APEXIFY_API_KEY || "no_api_here";
async function callLLM(systemInstruction, userMessage) {
  const conversation = [
    { role: "system", content: systemInstruction },
    { role: "user", content: userMessage }
  ];
  try {
    const response = await axios.post(
      "https://api.electronhub.ai/v1/chat/completions",
      {
        model: "llama-3.1-lumimaid-8b",
        messages: conversation,
        //limit: 15
      },
      {
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data.choices[0]?.message?.content;
  } catch (error) {
    console.error("LLM API call error in braincells command:", error);
    throw error;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("braincells")
    .setDescription("Check how many brain cells you or someone else has left")
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addUserOption(option =>
      option.setName("target")
        .setDescription("The user to check (defaults to you)")
        .setRequired(false)
    ),
  async execute(interaction) {
    const target = interaction.options.getUser("target") || interaction.user;
    const systemInstruction = "Provide witty remarks and randomly guess a user brain cells. give humorous count keep it under 1-2 sentences short asf, Provide a humorous remark on the brain cells count of the given user, like - '@user has 2 brain cells left which are fighting each other btw'";
    const userMessage = `How many brain cells does ${target.username} have left?`;

    try {
//defer
      await interaction.deferReply();
      await interaction.editReply("**counting braincells..** ");

      const reply = await callLLM(systemInstruction, userMessage);
      await interaction.editReply(reply || "Couldn't determine brain cells count. Looks like they all took a coffee break!");
    } catch (error) {
      await interaction.editReply("..brain cells are too distracted to respond.");
    }
  }
};