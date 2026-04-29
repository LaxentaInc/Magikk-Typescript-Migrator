// events/birthdays.js - Fixed Birthday Event Handler
const cron = require('node-cron');
const moment = require('moment-timezone');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

let Birthday;
try {
  Birthday = require('../commands/slash/General/birthdays').Birthday;
} catch (error) {
  console.error('❌ Could not import Birthday model:', error.message);
}

class BirthdayChecker {
  constructor() {
    this.isRunning = false;
  }

  init(client) {
    console.log('🎂 Birthday event system starting...');

    // Check every minute
    cron.schedule('* * * * *', async () => {
      if (this.isRunning) {
        console.log('⏭️ Birthday check already running, skipping...');
        return;
      }

      this.isRunning = true;
      try {
        await this.checkBirthdays(client);
      } catch (error) {
        console.error('❌ Birthday check error:', error);
      } finally {
        this.isRunning = false;
      }
    });

    console.log('✅ Birthday checker initialized (runs every minute)');
  }

  async checkBirthdays(client) {
    if (!Birthday) {
      console.error('❌ Birthday model not available');
      return;
    }

    try {
      const now = moment.utc();
      const today = { month: now.month() + 1, day: now.date() };

      //console.log(`🔍 Checking birthdays: ${now.format('YYYY-MM-DD HH:mm')} UTC`);

      // Find ALL birthdays for today
      const todaysBirthdays = await Birthday.find({
        month: today.month,
        day: today.day
      });

      if (todaysBirthdays.length === 0) {
        return; // No birthdays today
      }



      for (const birthday of todaysBirthdays) {
        // Check if already sent today (UTC day comparison)
        if (this.wasNotifiedToday(birthday)) {
          continue;
        }



        try {
          const birthdayUser = await client.users.fetch(birthday.userId);
          if (!birthdayUser) {
            console.log(`⚠️ User ${birthday.username} not found`);
            continue;
          }

          // Try to send birthday DM
          let dmSuccess = false;
          try {
            await this.sendBirthdayDM(birthdayUser, birthday);
            dmSuccess = true;
          } catch (dmError) {
            if (dmError.code === 50007) {
              console.log(`⚠️ ${birthdayUser.username} has DMs disabled, proceeding with followers...`);
            } else {
              console.error(`❌ Failed to DM ${birthdayUser.username}:`, dmError.message);
            }
          }

          // Send follower notifications regardless of DM success
          if (birthday.followers && birthday.followers.length > 0) {
            try {
              await this.sendFollowerNotifications(client, birthdayUser, birthday);
            } catch (followerError) {
              console.error(`❌ Failed to send follower notifications:`, followerError.message);
            }
          }

          // Mark as sent for today (always mark as done regardless of DM success)
          await Birthday.findByIdAndUpdate(birthday._id, {
            $set: { lastNotificationSent: new Date() }
          });


          // Delay between users to avoid rate limits
          await this.delay(2000);

        } catch (error) {
          console.error(`❌ Failed to process birthday for ${birthday.username}:`, error.message);
          // Don't mark as sent if processing failed - will retry next minute
        }
      }

    } catch (error) {
      console.error('❌ Birthday check failed:', error);
    }
  }

  wasNotifiedToday(birthday) {
    if (!birthday.lastNotificationSent) return false;

    const lastSent = moment.utc(birthday.lastNotificationSent);
    const now = moment.utc();

    // Check if last notification was sent today (UTC)
    return lastSent.isSame(now, 'day');
  }

  async sendBirthdayDM(user, birthdayData) {
    const age = birthdayData.year ? moment().year() - birthdayData.year : null;

    const embed = new EmbedBuilder()
      .setColor('#FF69B4')
      .setTitle('<a:zzapinkheartexclam_1327982490144:1342442561297711175> HAPPY BIRTHDAY!')
      .setDescription(`**${user.globalName || user.username}**, it's your special day!\n\nWishing you an absolutely amazing birthday filled with joy, laughter, and wonderful memories! <a:HeheAnimated_1327983123924783155:1342442846887608404>`)
      .addFields(
        { name: '<a:kittycat:1333358006720794624> Today', value: moment().format('MMMM Do, YYYY'), inline: true },
        { name: '<:fack_u_1328708369175023707:1332327403867078738> Age', value: age ? `You're ${age} today!` : 'Another year of awesome!', inline: true },
        { name: '<a:pats_1327965154998095973:1332327251253133383> Followers', value: `${birthdayData.followers?.length || 0} people are celebrating with you!`, inline: true }
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setImage('https://cdn.discordapp.com/attachments/1413870900612304898/1421120307565166808/elden_1.webm?ex=68d7e0ec&is=68d68f6c&hm=2f2d84d833aa9ca1c124603e436fceac08a0b761bb28dabc392060f8906766fc&')
      .setFooter({ text: 'Happy bday to you, BY the developer of this app @me_straight 🌟' })
      .setTimestamp();

    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`birthday_thanks_${user.id}`)
          .setLabel('Thank You!')
          .setStyle(ButtonStyle.Success)
          .setEmoji('<a:HeheAnimated_1327983123924783155:1342442846887608404>'),
        new ButtonBuilder()
          .setCustomId(`view_my_wishes_${user.id}`)
          .setLabel('View Wishes')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('<a:angryping_1327965156579217439:1332327335201869884>')
      );

    await user.send({ embeds: [embed], components: [buttons] });
  }

  async sendFollowerNotifications(client, birthdayUser, birthdayData) {
    const age = birthdayData.year ? moment().year() - birthdayData.year : null;

    for (const follower of birthdayData.followers) {
      try {
        const followerUser = await client.users.fetch(follower.userId);
        if (!followerUser) {
          console.log(`⚠️ Follower user not found: ${follower.username}`);
          continue;
        }

        const embed = new EmbedBuilder()
          .setColor('#00CED1')
          .setTitle('<a:kill94:1333357926202474526> Birthday reminder AAAAA!!!!!')
          .setDescription(`**${birthdayUser.globalName || birthdayUser.username}'s** birthday is today! <a:ayayasip_1327965158361792548:1333353760545833073>\n\nDon't forget to wish them a happy birthday!`)
          .addFields(
            { name: '<a:zzapinkheartexclam_1327982490144:1342442561297711175> Birthday Person', value: `${birthdayUser}`, inline: true },
            { name: '<a:Mariposas_Kawaii:1333359136037011568> Age', value: age ? `${age}` : 'Celebrating!', inline: true },
            { name: 'Date', value: moment().format('MMMM Do'), inline: true }
          )
          .setThumbnail(birthdayUser.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: `You're following ${birthdayUser.username}'s birthday` })
          .setTimestamp();

        const buttons = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`send_wish_${birthdayUser.id}_${followerUser.id}`)
              .setLabel('Send Birthday Wish')
              .setStyle(ButtonStyle.Success)
              .setEmoji('<a:zzapinkheartexclam_1327982490144:1342442561297711175>'),
            new ButtonBuilder()
              .setCustomId(`unfollow_birthday_${birthdayUser.id}_${followerUser.id}`)
              .setLabel('Unfollow')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('🔕')
          );

        await followerUser.send({ embeds: [embed], components: [buttons] });

        await this.delay(1000);

      } catch (error) {
        if (error.code === 50007) {
          console.log(`⚠️ Follower ${follower.username} has DMs disabled`);
        } else {
          console.error(`❌ Failed to notify follower ${follower.username}:`, error.message);
        }
      }
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export the checker instance and functions for testing
const birthdayChecker = new BirthdayChecker();

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    console.log('🎂 Birthday system starting...');
    birthdayChecker.init(client);
    setupInteractionHandlers(client);
  },
  // Export for manual testing
  sendBirthdayDM: (user, birthdayData) => birthdayChecker.sendBirthdayDM(user, birthdayData),
  sendFollowerNotifications: (client, user, birthdayData) => birthdayChecker.sendFollowerNotifications(client, user, birthdayData)
};

// SEPARATE INTERACTION HANDLER - This prevents conflicts
// NOTE: This registers its own listener to handle DM interactions specifically
// since main interactionCreate.js skips DM buttons not in the persistent handler registry
function setupInteractionHandlers(client) {
  // Use a more efficient check - only process birthday-related DM interactions
  client.on('interactionCreate', async interaction => {
    // Early exit for non-button/modal interactions
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    // Early exit for guild interactions (handled by main interactionCreate.js)
    if (interaction.guildId !== null) return;

    // Early exit for non-birthday related interactions
    const birthdayPrefixes = ['birthday_thanks_', 'view_my_wishes_', 'send_wish_', 'unfollow_birthday_', 'birthday_wish_modal_'];
    if (!birthdayPrefixes.some(prefix => interaction.customId.startsWith(prefix))) return;

    try {
      // Handle button interactions
      if (interaction.isButton()) {
        await handleDMButtonInteraction(interaction, client);
      }

      // Handle modal submissions
      if (interaction.isModalSubmit()) {
        await handleDMModalSubmission(interaction, client);
      }

    } catch (error) {
      console.error('❌ DM interaction error:', error);

      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: '❌ Something went wrong. Please try again.',
            ephemeral: true
          });
        } catch (replyError) {
          // Silently fail - interaction may have expired
        }
      }
    }
  });

  console.log('✅ Birthday DM interaction handlers initialized');
}

async function handleDMButtonInteraction(interaction, client) {
  const customId = interaction.customId;

  // ONLY handle birthday-related buttons, ignore everything else
  const birthdayPrefixes = ['birthday_thanks_', 'view_my_wishes_', 'send_wish_', 'unfollow_birthday_'];
  if (!birthdayPrefixes.some(prefix => customId.startsWith(prefix))) {
    return; // Not a birthday button, skip it
  }

  // Birthday thanks button
  if (customId.startsWith('birthday_thanks_')) {
    await interaction.reply({
      content: '<a:welcome_1310498060950044712:1342444099449520188> You\'re so welcome! Hope your day is absolutely magical :3',
      ephemeral: true
    });
  }

  // View own wishes button
  else if (customId.startsWith('view_my_wishes_')) {
    if (!Birthday) {
      return interaction.reply({ content: '❌ Database not available', ephemeral: true });
    }

    const birthday = await Birthday.findOne({ userId: interaction.user.id });
    const todayWishes = birthday?.wishes?.filter(w =>
      moment(w.date).isSame(moment(), 'day')
    ) || [];

    if (todayWishes.length === 0) {
      return interaction.reply({
        content: '<:wink_1267065430531641416:1342443832960094270> No wishes yet today, but I\'m sure they\'ll come!',
        ephemeral: true
      });
    }

    const wishEmbed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('<:wink_1267065430531641416:1342443832960094270> Your Birthday Wishes')
      .setDescription(`tehe~~ You've received ${todayWishes.length} wishes today!`)
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }));

    todayWishes.slice(0, 5).forEach((wish, index) => {
      try {
        const wisher = client.users.cache.get(wish.from);
        const wisherName = wisher ? (wisher.globalName || wisher.username) : 'Someone';
        wishEmbed.addFields({
          name: `${index + 1}. From ${wisherName}`,
          value: `"${wish.message}"`,
          inline: false
        });
      } catch (e) {
        wishEmbed.addFields({
          name: `${index + 1}. Anonymous wish`,
          value: `"${wish.message}"`,
          inline: false
        });
      }
    });

    await interaction.reply({ embeds: [wishEmbed], ephemeral: true });
  }

  // Send wish button
  else if (customId.startsWith('send_wish_')) {
    const parts = customId.split('_');
    const targetUserId = parts[2];

    const modal = new ModalBuilder()
      .setCustomId(`birthday_wish_modal_${targetUserId}_${interaction.user.id}`)
      .setTitle('Send Birthday Wish');

    const wishInput = new TextInputBuilder()
      .setCustomId('wish_message')
      .setLabel('Your birthday message')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Happy birthday! Hope you have an amazing day!')
      .setRequired(true)
      .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(wishInput));
    await interaction.showModal(modal);
  }

  // Unfollow button
  else if (customId.startsWith('unfollow_birthday_')) {
    if (!Birthday) {
      return interaction.reply({ content: '❌ Database not available', ephemeral: true });
    }

    const parts = customId.split('_');
    const targetUserId = parts[2];

    await Birthday.findOneAndUpdate(
      { userId: targetUserId },
      { $pull: { followers: { userId: interaction.user.id } } }
    );

    let targetUserName = 'this person';
    try {
      const targetUser = await client.users.fetch(targetUserId);
      targetUserName = targetUser.globalName || targetUser.username;
    } catch (error) {
      console.log('Could not fetch target user for unfollow');
    }

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('🔕 Unfollowed')
        .setDescription(`You won't receive notifications for ${targetUserName}'s birthday anymore.`)
      ],
      components: []
    });
  }
}

async function handleDMModalSubmission(interaction, client) {
  if (!interaction.customId.startsWith('birthday_wish_modal_')) return;

  if (!Birthday) {
    return interaction.reply({ content: '❌ Database not available', ephemeral: true });
  }

  const parts = interaction.customId.split('_');
  const targetUserId = parts[3];
  const wishMessage = interaction.fields.getTextInputValue('wish_message');

  try {
    const targetUser = await client.users.fetch(targetUserId);

    // Save the wish
    await Birthday.findOneAndUpdate(
      { userId: targetUserId },
      {
        $push: {
          wishes: {
            from: interaction.user.id,
            fromUsername: interaction.user.username,
            message: wishMessage,
            date: new Date()
          }
        }
      }
    );

    // Send the wish to birthday person
    const wishEmbed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('<a:Flying_Hearts_Red_13264643023575:1342443415954001920> Birthday Wish Received!')
      .setDescription(`**From:** ${interaction.user}\n\n"${wishMessage}"`)
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'Someone is thinking of you on your special day!' })
      .setTimestamp();

    await targetUser.send({ embeds: [wishEmbed] }).catch(error => {
      console.log(`Could not deliver wish to ${targetUser.username}:`, error.message);
    });

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('<a:Flying_Hearts_Red_13264643023575:1342443415954001920> Wish Delivered!')
        .setDescription(`Your birthday wish has been sent to ${targetUser.username}!`)
        .setThumbnail(targetUser?.displayAvatarURL({ dynamic: true }) || null)
      ],
      ephemeral: true
    });

  } catch (error) {
    console.error('Wish modal error:', error);
    await interaction.reply({
      content: 'Failed to send your wish. Please try again.',
      ephemeral: true
    });
  }
}