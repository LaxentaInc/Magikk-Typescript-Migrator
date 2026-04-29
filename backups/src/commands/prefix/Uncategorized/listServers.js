const { EmbedBuilder } = require("discord.js");

module.exports = {
    name: "listservers",
    description: "Lists all servers the bot is in. (Restricted)",
    usage: "!listservers",
    async execute(message) {
        const ownerId = "1246380709124378674";  // my main ;c  953527567808356404

        // Check if the user is the bot owner
        if (message.author.id !== ownerId) {
            return message
                .reply("Only the owner of me can use this command @laxenta <a:e:1310498098107387974>")
                .then((reply) => {
                    setTimeout(() => {
                        message.delete().catch(() => { });
                        reply.delete().catch(() => { });
                    }, 3000);
                });
        }

        try {
            const guilds = message.client.guilds.cache;

            if (guilds.size === 0) {
                return message.reply("I'm not in any servers!");
            }

            // Create an array of server information with invite links
            const serverListPromises = guilds.map(async (guild, index) => {
                let inviteLink = "No invite available";
                let ownerInfo = "Unknown";

                try {
                    // Try to create an invite from the first available text channel
                    const channel = guild.channels.cache.find(
                        (ch) => ch.isTextBased() &&
                            ch.permissionsFor(guild.members.me).has("CreateInstantInvite")
                    );

                    if (channel) {
                        const invite = await channel.createInvite({
                            maxAge: 0, // Never expires
                            maxUses: 0, // Unlimited uses
                            reason: "Server list command"
                        });
                        inviteLink = `https://discord.gg/${invite.code}`;
                    }
                } catch (error) {
                    console.error(`Failed to create invite for ${guild.name}:`, error.message);
                }

                try {
                    // Fetch the guild owner
                    const owner = await guild.fetchOwner();
                    ownerInfo = `${owner.user.username} (<@${owner.user.id}>) | ID: \`${owner.user.id}\``;
                } catch (error) {
                    console.error(`Failed to fetch owner for ${guild.name}:`, error.message);
                    ownerInfo = `ID: \`${guild.ownerId}\``;
                }

                return `**${index + 1}.** ${guild.name}\n` +
                    `   └ ID: \`${guild.id}\` | Members: ${guild.memberCount}\n` +
                    `   └ Owner: ${ownerInfo}\n` +
                    `   └ Invite: ${inviteLink}`;
            });

            const serverList = await Promise.all(serverListPromises);

            // Split into chunks if there are too many servers (Discord embed limit)
            const chunkSize = 10;
            const chunks = [];

            for (let i = 0; i < serverList.length; i += chunkSize) {
                chunks.push(serverList.slice(i, i + chunkSize));
            }

            // Send embeds for each chunk
            for (let i = 0; i < chunks.length; i++) {
                const embed = new EmbedBuilder()
                    .setTitle(`📋 Server List (${i + 1}/${chunks.length})`)
                    .setDescription(chunks[i].join("\n\n"))
                    .setColor(0x5865F2)
                    .setFooter({
                        text: `Total Servers: ${guilds.size} | Page ${i + 1} of ${chunks.length}`
                    })
                    .setTimestamp();

                await message.channel.send({ embeds: [embed] });
            }

            // Delete the command message after a delay
            setTimeout(() => message.delete().catch(() => { }), 5000);

        } catch (error) {
            console.error("Error listing servers:", error);
            const errorMessage = await message.reply(
                "There was an error trying to list the servers. Please try again later."
            );
            setTimeout(() => {
                message.delete().catch(() => { });
                errorMessage.delete().catch(() => { });
            }, 3000);
        }
    },
};
