
module.exports = {
  name: 'ping',
  description: 'Pings the bot and shows latency.',
  async execute(message) {
    const sentMessage = await message.reply('<a:ping:1327965210295930910> checking latency...');
    const latency = sentMessage.createdTimestamp - message.createdTimestamp; // Time it took to reply
    const apiLatency = Math.round(message.client.ws.ping); // Discord API latency

    await sentMessage.edit(`<a:ping:1327965210295930910> Pong!\nBot Latency: ${apiLatency}ms\nRound Trip: ${latency}ms`);
  },
};
