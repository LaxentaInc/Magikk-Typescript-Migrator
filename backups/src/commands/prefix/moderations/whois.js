const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'whois',
    description: 'Get detailed information about a user.',
    aliases: ['userinfo', 'who', 'ui'],
    usage: '!whois [@user]',
    async execute(message, args) {
        let target;

        // resolve target user from mention, id, or default to author
        const mention = message.mentions.users.first();
        if (mention) {
            target = mention;
        } else if (args[0]) {
            try {
                target = await message.client.users.fetch(args[0].replace(/[<@!>]/g, ''));
            } catch {
                return message.reply('could not find that user.');
            }
        } else {
            target = message.author;
        }

        const member = await message.guild.members.fetch(target.id).catch(() => null);

        const embed = new EmbedBuilder()
            .setAuthor({
                name: target.tag || target.username,
                iconURL: target.displayAvatarURL({ dynamic: true })
            })
            .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setColor('#7289DA')
            .addFields([
                {
                    name: 'Account Information',
                    value: [
                        `ID: ${target.id}`,
                        `Created: <t:${Math.floor(target.createdTimestamp / 1000)}:R>`,
                        `Bot: ${target.bot ? 'Yes' : 'No'}`,
                        member ? `Joined Server: <t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '',
                    ].filter(Boolean).join('\n'),
                    inline: false
                }
            ]);

        if (member && member.roles.cache.size > 1) {
            const roles = member.roles.cache
                .sort((a, b) => b.position - a.position)
                .filter(r => r.id !== message.guild.id)
                .map(r => r.toString());

            const truncatedRoles = roles.length > 15
                ? roles.slice(0, 15).join(', ') + ` (+${roles.length - 15} more)`
                : roles.join(', ');

            if (truncatedRoles) {
                embed.addFields({
                    name: `Roles (${roles.length})`,
                    value: truncatedRoles.substring(0, 1024),
                    inline: false
                });
            }
        }

        if (member?.presence) {
            const status = {
                online: 'Online',
                idle: 'Idle',
                dnd: 'Do Not Disturb',
                offline: 'Offline'
            };

            const activities = member.presence.activities
                .filter(a => a.type !== 4)
                .map(activity => {
                    let value = `${activity.name}`;
                    if (activity.details) value += `\n${activity.details}`;
                    return value;
                })
                .slice(0, 2);

            if (activities.length > 0) {
                embed.addFields({
                    name: 'Activity',
                    value: activities.join('\n').substring(0, 1024),
                    inline: false
                });
            }

            embed.addFields({
                name: 'Status',
                value: status[member.presence.status] || 'Offline',
                inline: true
            });
        }

        const acknowledgements = [];
        if (member) {
            if (message.guild.ownerId === member.id) acknowledgements.push('Server Owner');
            if (member.permissions.has('Administrator')) acknowledgements.push('Server Administrator');
            if (member.permissions.has('ManageGuild')) acknowledgements.push('Server Manager');
            if (member.permissions.has('ModerateMembers')) acknowledgements.push('Moderator');
        }

        if (acknowledgements.length > 0) {
            embed.addFields({
                name: 'Acknowledgements',
                value: acknowledgements.join(', '),
                inline: false
            });
        }

        await message.reply({ embeds: [embed] });
    },
};
