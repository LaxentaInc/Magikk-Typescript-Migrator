const { EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');

const TimerSchema = new mongoose.Schema({
    userId: String,
    guildId: String,
    channelId: String,
    endTime: Date,
    duration: Number,
    reason: String,
    messageId: String
});

const Timer = mongoose.models.Timer || mongoose.model('Timer', TimerSchema);


async function restoreTimers(client) {
    try {
        const activeTimers = await Timer.find({});
        let restored = 0;
        let cleaned = 0;

        for (const timer of activeTimers) {
            const timeLeft = timer.endTime.getTime() - Date.now();

            if (timeLeft <= 0) {
                // Timer expired while bot was offline
                try {
                    // Try to notify immediately if possible, or just clean up
                    // Ideally we notify "Hey I missed this"
                    // For now, let's process it as expired immediately
                    await handleTimerExpiration(client, timer, true);
                } catch (e) {
                    console.log(`Failed to process expired timer ${timer._id}:`, e.message);
                }

                await Timer.findByIdAndDelete(timer._id);
                cleaned++;
                continue;
            }

            // Reschedule active timer
            setTimeout(async () => {
                try {
                    await handleTimerExpiration(client, timer);
                    await Timer.findByIdAndDelete(timer._id);
                } catch (error) {
                    console.error('Timer expiration error:', error);
                }
            }, timeLeft);

            restored++;
        }

        console.log(`[TimerSystem] ⏰ Restored ${restored} timers, cleaned/processed ${cleaned} expired`);
    } catch (error) {
        console.error('Failed to restore timers:', error);
    }
}

async function handleTimerExpiration(client, timer, wasOffline = false) {
    const reminderEmbed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle(wasOffline ? '<a:hangingstarts13:1333359147655106581> Time\'s Up! (Missed while offline)' : '<a:hangingstarts13:1333359147655106581> Time\'s Up!')
        .setDescription(timer.reason || 'Your timer has finished!')
        .setTimestamp();

    let dmSent = false;
    try {
        const user = await client.users.fetch(timer.userId);
        await user.send({
            content: '# 🔔 Timer Finished!',
            embeds: [reminderEmbed]
        });
        dmSent = true;
    } catch (e) {
        // console.log(`Could not DM user ${timer.userId}`);
    }

    try {
        if (timer.channelId) {
            const channel = await client.channels.fetch(timer.channelId);
            if (channel) {
                if (dmSent) {
                    await channel.send({
                        content: `🔔 <@${timer.userId}> Your timer's done! (Check your DMs)`
                    });
                } else {
                    await channel.send({
                        content: `🔔 <@${timer.userId}> Your timer's up!`,
                        embeds: [reminderEmbed]
                    });
                }
            }
        }
    } catch (e) {
        // console.log(`Could not send to channel ${timer.channelId}`);
    }
}

module.exports = { restoreTimers, Timer };

// Fixed! i removed the redundant mongoose.connect() check from 
// timerRestore.js
// .

// The bot now:

// Connects to Mongoose normally via 
// messageCreate.js
//  (triggered by 
// loadEvents
//  which happens before ready).
// Calls 
// restoreTimers
//  in 
// index.js
// 's ready event.
// Successfully finds and restores timers using that existing connection.