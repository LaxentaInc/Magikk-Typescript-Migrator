const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'poll',
    aliases: ['vote'],
    description: 'Create a poll with up to 10 options',
    usage: 'poll <question> | <option1> | <option2> | ...',
    
    async execute(message, args) {
        // Check if user provided arguments
        if (!args || args.length === 0) {
            return message.reply({
                content: '❌ **Usage:** `!poll <question> | <option1> | <option2> | ...`\n**Example:** `!poll What\'s your favorite color? | Red | Blue | Green`'
            });
        }
        
        // Join all arguments and split by |
        const fullArgs = args.join(' ');
        const splitArgs = fullArgs.split('|').map(arg => arg.trim());
        
        // Need at least a question and 2 options
        if (splitArgs.length < 3) {
            return message.reply({
                content: '❌ **You need at least a question and 2 options!**\n**Usage:** `!poll <question> | <option1> | <option2> | ...`\n**Example:** `!poll What\'s your favorite color? | Red | Blue | Green`'
            });
        }
        
        const question = splitArgs[0];
        const options = splitArgs.slice(1);
        
        // Validation
        if (options.length > 10) {
            return message.reply({
                content: '❌ **Maximum 10 options allowed!**'
            });
        }
        
        if (question.length > 256) {
            return message.reply({
                content: '❌ **Question too long! Keep it under 256 characters.**'
            });
        }
        
        // Check if any option is too long
        const longOption = options.find(opt => opt.length > 100);
        if (longOption) {
            return message.reply({
                content: '❌ **Option too long! Keep options under 100 characters each.**'
            });
        }
        
        // Number emojis for reactions
        const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        
        // Create embed
        const embed = new EmbedBuilder()
            .setTitle('📊 ' + question)
            .setColor(0x5865F2)
            .setTimestamp()
            .setFooter({ 
                text: `Poll by ${message.author.username}`,
                iconURL: message.author.displayAvatarURL({ dynamic: true })
            });
        
        // Add options to embed description
        let description = '';
        for (let i = 0; i < options.length; i++) {
            description += `${numberEmojis[i]} ${options[i]}\n`;
        }
        embed.setDescription(description);
        
        try {
            // Send the poll
            const pollMessage = await message.reply({ embeds: [embed] });
            
            // Add reactions
            for (let i = 0; i < options.length; i++) {
                await pollMessage.react(numberEmojis[i]);
            }
            
        } catch (error) {
            console.error('Error creating poll:', error);
            return message.reply({
                content: '❌ **Something went wrong creating the poll!**'
            });
        }
    }
};