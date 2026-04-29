const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: "roleall",
    description: "Assign or remove a role for all members in the server.",
    async execute(message, args) {
        // Check if the user has admin permissions
        if (!message.member.permissions.has("Administrator")) {
            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Permission Denied")
                        .setDescription("You need `Administrator` permission to use this command.")
                        .setColor(0xff0000),
                ],
            });
        }

        // Ensure a role and action are provided
        const action = args[0]?.toLowerCase();
        const roleName = args.slice(1).join(" ");
        if (!action || !["add", "remove"].includes(action)) {
            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Invalid Command Usage")
                        .setDescription("Usage: `!roleall <add/remove> <role name>`")
                        .setColor(0xffa500),
                ],
            });
        }
        if (!roleName) {
            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Role Missing")
                        .setDescription("Please specify the role name.")
                        .setColor(0xffa500),
                ],
            });
        }

        // Get the role by name
        const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (!role) {
            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Role Not Found")
                        .setDescription(`Could not find a role with the name **${roleName}**.`)
                        .setColor(0xff0000),
                ],
            });
        }

        // Get all members in the server
        const members = message.guild.members.cache.filter(member => !member.user.bot); // Exclude bots
        if (!members.size) {
            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("No Members Found")
                        .setDescription("There are no members in this server to modify.")
                        .setColor(0xffa500),
                ],
            });
        }

        // Confirmation and progress message
        const confirmationEmbed = new EmbedBuilder()
            .setTitle("Processing Role Changes")
            .setDescription(`**Action:** ${action === "add" ? "Adding" : "Removing"} role **${role.name}** for ${members.size} members.`)
            .setColor(0x00ff00);
        const progressMessage = await message.channel.send({ embeds: [confirmationEmbed] });

        // Process members in bulk
        let successCount = 0;
        let failCount = 0;

        for (const member of members.values()) {
            try {
                if (action === "add") {
                    await member.roles.add(role);
                } else {
                    await member.roles.remove(role);
                }
                successCount++;
            } catch (e) {
                console.error(`Failed to modify role for member ${member.user.tag}: ${e.message}`);
                failCount++;
            }
        }

        // Send a completion summary
        const summaryEmbed = new EmbedBuilder()
            .setTitle("Role Changes Complete")
            .setDescription(`**Role:** ${role.name}\n**Action:** ${action === "add" ? "Added to" : "Removed from"} members.`)
            .addFields(
                { name: "Success", value: `${successCount} members`, inline: true },
                { name: "Failed", value: `${failCount} members`, inline: true }
            )
            .setColor(0x00ff00);
        progressMessage.edit({ embeds: [summaryEmbed] });
    },
};