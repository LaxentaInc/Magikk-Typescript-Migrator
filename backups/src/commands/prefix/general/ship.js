const { EmbedBuilder } = require('discord.js');

// Function to generate a deterministic compatibility score
function generateCompatibilityScore(name1, name2) {
    let score = 0;
    const combinedString = name1 + name2;
    for (let char of combinedString) {
        score += char.charCodeAt(0);
    }
    return score % 101; // Compatibility score between 0 and 100
}

// Function to merge names
function mergeNames(name1, name2) {
    const halfLength1 = Math.floor(name1.length / 2);
    const halfLength2 = Math.floor(name2.length / 2);
    return name1.slice(0, halfLength1) + name2.slice(halfLength2);
}

module.exports = {
    name: 'ship',
    description: 'Ships two users or texts and shows their compatibility.',
    usage: '!ship [user1] [user2]',
    async execute(message, args) {
        try {
            if (args.length < 1) {
                return message.reply('Please provide at least one name or mention to ship.');
            }

            let firstPart, secondPart;
            let user1, user2;

            // Determine whether the inputs are mentions or plain text
            if (args.length === 1) {
                user1 = message.author;
                user2 = message.mentions.users.first() || args[0];
            } else {
                user1 = message.mentions.users.first() || args[0];
                user2 = message.mentions.users.last() || args[1];
            }

            // Get correct usernames for merging
            firstPart = user1.username || user1;
            secondPart = user2.username || user2;

            // Generate compatibility score
            const compatibility = generateCompatibilityScore(firstPart, secondPart);

            // Progress bar generation using custom emoji and dots
            const filledBars = Math.floor(compatibility / 10);
            const emptyBars = 10 - filledBars;
            const progressBar = '<:bar_pink:1269165098430234688>'.repeat(filledBars) + '<:empty:1269173912504369262>'.repeat(emptyBars);

            // Merge names
            const mergedName = mergeNames(firstPart, secondPart);

            let description;
            if (compatibility === 100) {
                description = 'OH MY GOD!! <a:OMG:1296717153827033119> Perfect!! <a:Dam:1296717156481761321>';
            } else if (compatibility > 75) {
                description = 'Great <a:good:1138688901515587614>';
            } else if (compatibility > 50) {
                description = 'Pretty Good <:maybe:1260500272002633829>';
            } else if (compatibility > 25) {
                description = 'Could Work Out <:nah:1249690739558846515>';
            } else {
                description = 'Worse Than Average <:nah:1260497185095684158>';
            }

            const embed = new EmbedBuilder()
                .setColor('#ff69b4') // Pink color
                .setTitle(' <a:hmm:1138688928216522832> Matching!! ')
                .addFields(
                    { name: '<a:b:1140133458606309386>', value: `**${firstPart}**`, inline: true },
                    { name: '<a:a:1140133458606309386>', value: `**${secondPart}**`, inline: true },
                    { name: '<:hmm:1260496728973643776>', value: mergedName },
                    { name: 'Compatibility', value: `${compatibility}% ${progressBar} ${description}` }
                )
        .setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL() })
.setTimestamp();
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error executing ship command:', error);
            message.reply('There was an error trying to ship the users. Please try again later.');
        }
    },
};
