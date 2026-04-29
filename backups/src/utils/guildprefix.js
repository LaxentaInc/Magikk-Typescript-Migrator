require('dotenv').config(); // Load .env file
const mongoose = require('mongoose');
const { MONGO_URI } = process.env;

// Check if the model is already compiled
module.exports = mongoose.models.GuildPrefix || mongoose.model('GuildPrefix', new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, required: true },
}));
