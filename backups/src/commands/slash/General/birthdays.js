// commands/birthday.js - Fixed Birthday Command
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ComponentType
} = require('discord.js');
const mongoose = require('mongoose');
const moment = require('moment-timezone');

// Birthday Schema
const birthdaySchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  globalName: { type: String },
  day: { type: Number, required: true },
  month: { type: Number, required: true },
  year: { type: Number },
  timezone: { type: String, default: 'UTC' },
  lastNotificationSent: { type: Date },
  followers: [{
    userId: String,
    username: String,
    addedAt: { type: Date, default: Date.now }
  }],
  wishes: [{
    from: String,
    fromUsername: String,
    message: String,
    date: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

birthdaySchema.index({ month: 1, day: 1 });
birthdaySchema.index({ userId: 1 });
birthdaySchema.index({ 'followers.userId': 1 });

const Birthday = mongoose.models.Birthday || mongoose.model('Birthday', birthdaySchema);

// Constants
const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
  'Australia/Sydney', 'Pacific/Auckland', 'America/Toronto', 'Europe/Amsterdam'
];

const BIRTHDAY_GIFS = [
  'https://cdn.discordapp.com/attachments/1413870900612304898/1421120307565166808/elden_1.webm?ex=68d7e0ec&is=68d68f6c&hm=2f2d84d833aa9ca1c124603e436fceac08a0b761bb28dabc392060f8906766fc&',
];

// Utility Functions
function getRandomGif() {
  return BIRTHDAY_GIFS[Math.floor(Math.random() * BIRTHDAY_GIFS.length)];
}

function calculateAge(birthYear) {
  if (!birthYear) return null;
  const today = moment();
  return today.year() - birthYear;
}

function formatBirthdayDate(month, day, year = null) {
  const date = moment(`${moment().year()}-${month}-${day}`, 'YYYY-M-D');
  return date.format('MMMM Do') + (year ? `, ${year}` : '');
}

function getDaysUntilBirthday(month, day, timezone = 'UTC') {
  const now = moment.tz(timezone);
  const birthday = moment.tz(`${now.year()}-${month}-${day}`, 'YYYY-M-D', timezone);

  if (birthday.isBefore(now, 'day')) {
    birthday.add(1, 'year');
  }

  return birthday.diff(now, 'days');
}

// Command Handlers
async function setBirthday(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const day = interaction.options.getInteger('day');
  const month = interaction.options.getInteger('month');
  const year = interaction.options.getInteger('year');
  const timezone = interaction.options.getString('timezone') || 'UTC';

  // Validate date
  const testDate = moment(`${year || 2000}-${month}-${day}`, 'YYYY-M-D');
  if (!testDate.isValid()) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Invalid Date')
        .setDescription('Please enter a valid date.')
      ]
    });
  }

  try {
    // Save birthday
    await Birthday.findOneAndUpdate(
      { userId: interaction.user.id },
      {
        userId: interaction.user.id,
        username: interaction.user.username,
        globalName: interaction.user.globalName,
        day, month, year, timezone
      },
      { upsert: true }
    );

    const daysUntil = getDaysUntilBirthday(month, day, timezone);
    const age = calculateAge(year);

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('Birthday Set UWU!!!!')
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '<a:zzapinkheartexclam_1327982490144:1342442561297711175> Birthday', value: formatBirthdayDate(month, day, year), inline: true },
        { name: 'Timezone', value: timezone, inline: true },
        { name: '<a:kittycat:1333358006720794624> Days Until', value: daysUntil === 0 ? '**TODAY!** 🎉' : `${daysUntil} days`, inline: true }
      )
      .setFooter({ text: 'Others can follow your birthday to get notified!' });

    if (age) embed.addFields({ name: '🎈 Age', value: `Turning ${age + 1} next birthday`, inline: true });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Set birthday error:', error);
    await interaction.editReply({
      content: 'Failed to set birthday. Please try again.',
    });
  }
}

async function showUpcoming(interaction) {
  await interaction.deferReply();

  const days = interaction.options.getInteger('days') || 30;

  try {
    const birthdays = await Birthday.find({});

    const upcoming = birthdays.map(b => {
      const daysUntil = getDaysUntilBirthday(b.month, b.day, b.timezone);
      return { ...b.toObject(), daysUntil };
    })
      .filter(b => b.daysUntil <= days)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    if (upcoming.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('📅 No Upcoming Birthdays ;c')
          .setDescription(`No set birthdays in the next ${days} days.`)
        ]
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#FF69B4')
      .setTitle(`🎂 Upcoming Birthdays (Next ${days} Days)`)
      .setDescription(`Found ${upcoming.length} upcoming birthdays`)
      .setFooter({ text: 'Use the dropdown to follow someone!' });

    // Show up to 10 birthdays
    upcoming.slice(0, 10).forEach(b => {
      const user = interaction.client.users.cache.get(b.userId);
      const displayName = user ? (user.globalName || user.username) : b.username;
      const age = calculateAge(b.year);

      embed.addFields({
        name: `${b.daysUntil === 0 ? '🎉 ' : ''}${displayName}`,
        value: `<a:kittycat:1333358006720794624> ${formatBirthdayDate(b.month, b.day)}\n` +
          `<a:Love:1333357974751678524> ${b.daysUntil === 0 ? '**TODAY!**' : `In ${b.daysUntil} day${b.daysUntil !== 1 ? 's' : ''}`}` +
          (age ? `\n🎈 ${age} years old` : ''),
        inline: true
      });
    });

    // Add follow dropdown
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`follow_birthday_${interaction.user.id}`)
      .setPlaceholder('Select someone to follow...')
      .setOptions(
        upcoming.slice(0, 25).map(b => {
          const user = interaction.client.users.cache.get(b.userId);
          const displayName = user ? (user.globalName || user.username) : b.username;
          return {
            label: displayName,
            description: `${formatBirthdayDate(b.month, b.day)} • ${b.daysUntil === 0 ? 'Today!' : `${b.daysUntil} days`}`,
            value: b.userId,
            emoji: b.daysUntil === 0 ? '🎉' : '📅'
          };
        })
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const message = await interaction.editReply({ embeds: [embed], components: [row] });

    // Handle follow selection with proper collector
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id && i.customId.startsWith('follow_birthday_'),
      time: 300000 // 5 minutes
    });

    collector.on('collect', async i => {
      try {
        await i.deferReply({ ephemeral: true });

        const targetUserId = i.values[0];
        const birthday = await Birthday.findOne({ userId: targetUserId });

        if (!birthday) {
          return i.editReply({ content: '❌ Birthday not found!' });
        }

        // Check if already following
        const isFollowing = birthday.followers?.some(f => f.userId === i.user.id);
        if (isFollowing) {
          return i.editReply({
            content: '❌ You\'re already following this person\'s birthday!'
          });
        }

        // Add follower
        await Birthday.findByIdAndUpdate(birthday._id, {
          $push: { followers: { userId: i.user.id, username: i.user.username } }
        });

        const targetUser = interaction.client.users.cache.get(targetUserId);
        const displayName = targetUser ? (targetUser.globalName || targetUser.username) : birthday.username;

        await i.editReply({
          embeds: [new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('<a:flower_1326464255662489621:1342443388166869082> Now Following!')
            .setDescription(`U did it!! NOW You'll be notified when **${displayName}** has their birthday!`)
            .setThumbnail(targetUser?.displayAvatarURL({ dynamic: true }) || null)
          ]
        });
      } catch (error) {
        console.error('Follow selection error:', error);
        if (!i.replied && !i.deferred) {
          await i.reply({ content: 'Something went wrong!', ephemeral: true });
        } else if (i.deferred) {
          await i.editReply({ content: 'Something went wrong!' });
        }
      }
    });

    collector.on('end', () => {
      // Disable components when collector ends
      const disabledRow = new ActionRowBuilder()
        .addComponents(
          StringSelectMenuBuilder.from(selectMenu).setDisabled(true)
        );
      message.edit({ components: [disabledRow] }).catch(console.error);
    });

  } catch (error) {
    console.error('Show upcoming error:', error);
    await interaction.editReply({
      content: 'Failed to fetch upcoming birthdays. Please give up :3',
    });
  }
}

async function lookupBirthday(interaction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('user');

  try {
    const birthday = await Birthday.findOne({ userId: targetUser.id });

    if (!birthday) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('<a:flower_1326464255662489621:1342443388166869082> No Birthday Found')
          .setDescription(`${targetUser} hasn't set their birthday yet.`)
        ]
      });
    }

    const daysUntil = getDaysUntilBirthday(birthday.month, birthday.day, birthday.timezone);
    const age = calculateAge(birthday.year);
    const isFollowing = birthday.followers?.some(f => f.userId === interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(daysUntil === 0 ? '#FFD700' : '#FF69B4')
      .setTitle(`${daysUntil === 0 ? '🎉 ' : '🎂 '}${targetUser.globalName || targetUser.username}'s Birthday`)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '<:wink_1267065430531641416:1342443832960094270> Birthday', value: formatBirthdayDate(birthday.month, birthday.day, birthday.year), inline: true },
        { name: 'Timezone', value: birthday.timezone, inline: true },
        { name: 'When', value: daysUntil === 0 ? '**TODAY!** 🎉' : `In ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`, inline: true },
        { name: '<a:pats_1327965154998095973:1332327251253133383> Followers', value: `${birthday.followers?.length || 0} people`, inline: true },
        { name: '<a:flower_1326464255662489621:1342443388166869082> Wishes Today', value: `${birthday.wishes?.filter(w => moment(w.date).isSame(moment(), 'day')).length || 0}`, inline: true }
      );

    if (age && daysUntil === 0) {
      embed.addFields({ name: '🎈 Age', value: `${age} years old today!`, inline: true });
    }

    // Action buttons
    const buttons = [];

    if (!isFollowing && interaction.user.id !== targetUser.id) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`follow_user_${targetUser.id}_${interaction.user.id}`)
          .setLabel('Follow Birthday')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('<a:Q__1327982827844927552:1342443037371928627>')
      );
    }

    if (daysUntil === 0 && interaction.user.id !== targetUser.id) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`wish_user_${targetUser.id}_${interaction.user.id}`)
          .setLabel('Send Birthday Wish!')
          .setStyle(ButtonStyle.Success)
          .setEmoji('<a:flower_1326464255662489621:1342443388166869082>')
      );
    }

    if (daysUntil === 0 && birthday.wishes?.length > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`view_wishes_${targetUser.id}_${interaction.user.id}`)
          .setLabel('View Wishes')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('<a:flower_1326464255662489621:1342443388166869082>')
      );
    }

    const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons)] : [];
    const message = await interaction.editReply({ embeds: [embed], components });

    if (components.length > 0) {
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id,
        time: 600000 // 10 minutes
      });

      collector.on('collect', async i => {
        await handleLookupButtonInteraction(i, interaction, targetUser);
      });

      collector.on('end', () => {
        // Disable all buttons when collector ends
        const disabledComponents = components.map(row => {
          const newRow = new ActionRowBuilder();
          row.components.forEach(component => {
            if (component.data.type === 2) { // Button
              newRow.addComponents(ButtonBuilder.from(component).setDisabled(true));
            }
          });
          return newRow;
        });
        message.edit({ components: disabledComponents }).catch(console.error);
      });
    }

  } catch (error) {
    console.error('Lookup birthday error:', error);
    await interaction.editReply({
      content: 'Failed to lookup birthday. Please give up.',
    });
  }
}

async function handleLookupButtonInteraction(i, originalInteraction, targetUser) {
  try {
    if (i.customId.startsWith('follow_user_')) {
      await i.deferReply({ ephemeral: true });

      // Check if already following
      const birthday = await Birthday.findOne({ userId: targetUser.id });
      const isFollowing = birthday.followers?.some(f => f.userId === i.user.id);

      if (isFollowing) {
        return i.editReply({
          embeds: [new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('<a:angryping_1327965156579217439:1332327335201869884> Already Following!')
            .setDescription('You\'re already following their birthday! I\'ll still notify you when it comes <a:zzapinkheartexclam_1327982490144:1342442561297711175>')
          ]
        });
      }

      await Birthday.findOneAndUpdate(
        { userId: targetUser.id },
        { $push: { followers: { userId: i.user.id, username: i.user.username } } }
      );

      await i.editReply({
        embeds: [new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('<a:Flying_Hearts_Red_13264643023575:1342443415954001920> Now Following em!')
          .setDescription('You\'ll be notified when it\'s their birthday!')
        ]
      });
    }

    else if (i.customId.startsWith('wish_user_')) {
      const targetUserId = targetUser.id;

      const modal = new ModalBuilder()
        .setCustomId(`wish_modal_${targetUserId}_${i.user.id}`)
        .setTitle('Send Birthday Wish');

      const wishInput = new TextInputBuilder()
        .setCustomId('wish_message')
        .setLabel('Your birthday message')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Happy birthday tehe~~! Hope you have an amazing day!')
        .setRequired(true)
        .setMaxLength(500);

      modal.addComponents(new ActionRowBuilder().addComponents(wishInput));
      await i.showModal(modal);

      // Handle modal submission
      const modalFilter = (modalI) =>
        modalI.customId === `wish_modal_${targetUserId}_${i.user.id}` &&
        modalI.user.id === i.user.id;

      try {
        const modalInteraction = await i.awaitModalSubmit({
          filter: modalFilter,
          time: 300000
        });

        const message = modalInteraction.fields.getTextInputValue('wish_message');

        // Save wish
        await Birthday.findOneAndUpdate(
          { userId: targetUserId },
          {
            $push: {
              wishes: {
                from: modalInteraction.user.id,
                fromUsername: modalInteraction.user.username,
                message,
                date: new Date()
              }
            }
          }
        );

        // Send DM to birthday person
        const wishEmbed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('tehe~ Birthday Wish for you!')
          .setDescription(`**From:** ${modalInteraction.user}\n\n"${message}"`)
          .setThumbnail(modalInteraction.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Someone is thinking of you on your special day!!!' })
          .setTimestamp();

        await targetUser.send({ embeds: [wishEmbed] }).catch(() => {
          console.log(`Could not deliver wish to ${targetUser.username}`);
        });

        await modalInteraction.reply({
          embeds: [new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('tehe~ Wish Sent!')
            .setDescription('<a:zzapinkheartexclam_1327982490144:1342442561297711175> Your birthday wish has been delivered!')
          ],
          ephemeral: true
        });

      } catch (modalError) {
        console.error('Modal submission error:', modalError);
      }
    }

    else if (i.customId.startsWith('view_wishes_')) {
      await i.deferReply({ ephemeral: true });

      const birthdayData = await Birthday.findOne({ userId: targetUser.id });
      const todayWishes = birthdayData?.wishes?.filter(w =>
        moment(w.date).isSame(moment(), 'day')
      ) || [];

      if (todayWishes.length === 0) {
        return i.editReply({ content: '💌 No wishes yet today, but i, the developer wish you a happy birthday, ily man yr not alone' });
      }

      const wishEmbed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('Birthday Wishes.. :3')
        .setDescription(`${todayWishes.length} wishes today!`);

      todayWishes.slice(0, 5).forEach((wish, index) => {
        const wisher = originalInteraction.client.users.cache.get(wish.from);
        const wisherName = wisher ? (wisher.globalName || wisher.username) : wish.fromUsername || 'Someone';
        wishEmbed.addFields({
          name: `${index + 1}. From ${wisherName}`,
          value: `"${wish.message}"`,
          inline: false
        });
      });

      await i.editReply({ embeds: [wishEmbed] });
    }

  } catch (error) {
    console.error('Button interaction error:', error);
    if (!i.replied && !i.deferred) {
      await i.reply({ content: 'Everything went wrong :3', ephemeral: true }).catch(console.error);
    } else if (i.deferred) {
      await i.editReply({ content: 'Something went wrong!' }).catch(console.error);
    }
  }
}

async function showMyBirthday(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const birthday = await Birthday.findOne({ userId: interaction.user.id });

    if (!birthday) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('<a:kittycat:1333358006720794624> YOUR BIRTHDAY IS NOT SET ;c, set it to let your weebs get reminded the day to wish you!!')
          .setDescription('Use `/birthday set` to set your birthday first!')
        ]
      });
    }

    const daysUntil = getDaysUntilBirthday(birthday.month, birthday.day, birthday.timezone);
    const age = calculateAge(birthday.year);

    const embed = new EmbedBuilder()
      .setColor('#FF69B4')
      .setTitle('🎂 Your Birthday :3')
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '<a:zzapinkheartexclam_1327982490144:1342442561297711175> Birthday', value: formatBirthdayDate(birthday.month, birthday.day, birthday.year), inline: true },
        { name: 'Timezone', value: birthday.timezone, inline: true },
        { name: '<a:loading:1333357988953460807> Next Birthday', value: daysUntil === 0 ? '**TODAY!** 🎉' : `In ${daysUntil} days`, inline: true },
        { name: '<a:pats_1327965154998095973:1332327251253133383> Followers', value: `${birthday.followers?.length || 0} people`, inline: true },
        { name: '<a:angryping_1327965156579217439:1332327335201869884> Total Wishes', value: `${birthday.wishes?.length || 0}`, inline: true }
      );

    if (age && daysUntil === 0) {
      embed.addFields({ name: 'Ur Age Today', value: `${age} years old!`, inline: true });
    }

    const buttons = [
      new ButtonBuilder()
        .setCustomId(`remove_birthday_${interaction.user.id}`)
        .setLabel('Remove Birthday')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('<:friends_1328691822930690099:1332327471684517918>'),
      // new ButtonBuilder()
      //   .setCustomId(`test_notification_${interaction.user.id}`)
      //   .setLabel('Test Notification')
      //   .setStyle(ButtonStyle.Primary)
      //   .setEmoji('📧')
    ];

    const message = await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(buttons)]
    });

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: i => i.user.id === interaction.user.id,
      time: 60000
    });

    collector.on('collect', async i => {
      try {
        if (i.customId.startsWith('remove_birthday_')) {
          await i.deferReply({ ephemeral: true });

          await Birthday.findOneAndDelete({ userId: interaction.user.id });

          await i.editReply({
            embeds: [new EmbedBuilder()
              .setColor('#00FF00')
              .setTitle('Yea..Birthday Removed')
              .setDescription('Your birthday has been removed from the system, cya around buddy')
            ]
          });
        }

        else if (i.customId.startsWith('test_notification_')) {
          await i.deferReply({ ephemeral: true });

          try {
            // Import birthday event handler
            const BirthdayChecker = require('../../../events/birthdays');
            await BirthdayChecker.sendBirthdayDM(interaction.user, birthday);

            await i.editReply({
              content: '✅ Test notification sent! Check your DMs!'
            });
          } catch (error) {
            console.error('Test notification error:', error);
            await i.editReply({
              content: 'Failed to send test notification.'
            });
          }
        }
      } catch (error) {
        console.error('My birthday button error:', error);
        if (!i.replied && !i.deferred) {
          await i.reply({ content: 'Something went wrong!', ephemeral: true }).catch(console.error);
        } else if (i.deferred) {
          await i.editReply({ content: 'Something went wrong!' }).catch(console.error);
        }
      }
    });

    collector.on('end', () => {
      const disabledRow = new ActionRowBuilder()
        .addComponents(
          buttons.map(btn => ButtonBuilder.from(btn).setDisabled(true))
        );
      message.edit({ components: [disabledRow] }).catch(console.error);
    });

  } catch (error) {
    console.error('Show my birthday error:', error);
    await interaction.editReply({
      content: 'Failed to fetch your birthday ;c Please try again.',
    });
  }
}

async function showFollowing(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const following = await Birthday.find({ 'followers.userId': interaction.user.id });

    if (following.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('Sad... No Followed Birthdays ;< Lonely up here huh?')
          .setDescription('Use `/birthday upcoming` to find birthdays to follow!')
        ]
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#FF69B4')
      .setTitle('Birthdays You Follow')
      .setDescription(`Following <a:Mariposas_Kawaii:1333359136037011568> ${following.length} birthday${following.length !== 1 ? 's' : ''}`)
      .setFooter({ text: 'Select one to unfollow' });

    // Sort by upcoming
    const sorted = following.map(b => ({
      ...b.toObject(),
      daysUntil: getDaysUntilBirthday(b.month, b.day, b.timezone)
    })).sort((a, b) => a.daysUntil - b.daysUntil);

    sorted.slice(0, 10).forEach(b => {
      const user = interaction.client.users.cache.get(b.userId);
      const displayName = user ? (user.globalName || user.username) : b.username;

      embed.addFields({
        name: displayName,   //we DID SOME EMOJINESS HERE
        value: `<a:kittycat:1333358006720794624> ${formatBirthdayDate(b.month, b.day)}\n<a:Love:1333357974751678524> ${b.daysUntil === 0 ? '**Today!**' : `${b.daysUntil} days`}`,
        inline: true
      });
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`manage_following_${interaction.user.id}`)
      .setPlaceholder('Select a birthday to unfollow...')
      .setOptions(
        sorted.slice(0, 25).map(b => {
          const user = interaction.client.users.cache.get(b.userId);
          const displayName = user ? (user.globalName || user.username) : b.username;
          return {
            label: displayName,
            description: `${formatBirthdayDate(b.month, b.day)} • ${b.daysUntil === 0 ? 'Today!' : `${b.daysUntil} days`}`,
            value: b.userId,
            emoji: b.daysUntil === 0 ? '<a:Flying_Hearts_Red_13264643023575:1342443415954001920>' : '<a:marker_1326464173361856524:1342443432240746577>'
          };
        })
      );

    const message = await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(selectMenu)]
    });

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id && i.customId.startsWith('manage_following_'),
      time: 60000
    });

    collector.on('collect', async i => {
      try {
        await i.deferReply({ ephemeral: true });

        const targetUserId = i.values[0];

        await Birthday.findOneAndUpdate(
          { userId: targetUserId },
          { $pull: { followers: { userId: i.user.id } } }
        );

        const targetUser = interaction.client.users.cache.get(targetUserId);
        const displayName = targetUser ? (targetUser.globalName || targetUser.username) : 'this person';

        await i.editReply({
          embeds: [new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('Sadddd!! You Unfollowed them')
            .setDescription(`You won't receive notifications for ${displayName}'s birthday anymore :<`)
          ]
        });
      } catch (error) {
        console.error('Unfollow error:', error);
        if (!i.replied && !i.deferred) {
          await i.reply({ content: 'Something went wrong!', ephemeral: true }).catch(console.error);
        } else if (i.deferred) {
          await i.editReply({ content: 'Something went wrong!' }).catch(console.error);
        }
      }
    });

    collector.on('end', () => {
      const disabledRow = new ActionRowBuilder()
        .addComponents(
          StringSelectMenuBuilder.from(selectMenu).setDisabled(true)
        );
      message.edit({ components: [disabledRow] }).catch(console.error);
    });

  } catch (error) {
    console.error('following error:', error);
    await interaction.editReply({
      content: 'Failed. Please report with /report',
    });
  }
}

// test
async function testBirthday(interaction) {
  // Check if user has admin permissions
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'You need Administrator permissions to use this command.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user');

  try {
    const birthday = await Birthday.findOne({ userId: targetUser.id });

    if (!birthday) {
      return interaction.editReply({
        content: 'This user hasn\'t set their birthday yet, ask them to do it, so no one can forget the special day!!'
      });
    }

    // Import the BirthdayChecker from events
    const BirthdayChecker = require('../../../events/birthdays');

    // Send test birthday notification
    await BirthdayChecker.sendBirthdayDM(targetUser, birthday);

    // Send test follower notifications
    if (birthday.followers && birthday.followers.length > 0) {
      await BirthdayChecker.sendFollowerNotifications(interaction.client, targetUser, birthday);
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Test Notifications Sent!')
        .setDescription(`Birthday notification sent to ${targetUser}\nFollower notifications sent to ${birthday.followers?.length || 0} people`)
        .addFields(
          { name: 'Target User', value: `${targetUser}`, inline: true },
          { name: 'Birthday', value: formatBirthdayDate(birthday.month, birthday.day, birthday.year), inline: true },
          { name: 'Followers Notified', value: `${birthday.followers?.length || 0}`, inline: true }
        )
      ]
    });

  } catch (error) {
    console.error('Test birthday error:', error);
    await interaction.editReply({
      content: '❌ Failed to send test notifications. Check console for errors.'
    });
  }
}

// Slash Command Definition
module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Manage birthdays and notifications')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set your birthday')
      .addIntegerOption(opt => opt
        .setName('day')
        .setDescription('Day (1-31)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(31))
      .addIntegerOption(opt => opt
        .setName('month')
        .setDescription('Month')
        .setRequired(true)
        .addChoices(
          { name: 'January', value: 1 },
          { name: 'February', value: 2 },
          { name: 'March', value: 3 },
          { name: 'April', value: 4 },
          { name: 'May', value: 5 },
          { name: 'June', value: 6 },
          { name: 'July', value: 7 },
          { name: 'August', value: 8 },
          { name: 'September', value: 9 },
          { name: 'October', value: 10 },
          { name: 'November', value: 11 },
          { name: 'December', value: 12 }
        ))
      .addIntegerOption(opt => opt
        .setName('year')
        .setDescription('Birth year (optional)')
        .setMinValue(1900)
        .setMaxValue(new Date().getFullYear()))
      .addStringOption(opt => opt
        .setName('timezone')
        .setDescription('Your timezone')
        .setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('follow')  // upcoming -> follow
      .setDescription('View UPCOMING birthdays AND FOLLOW THEM')
      .addIntegerOption(opt => opt
        .setName('days')
        .setDescription('Days to look ahead (default: 30)')
        .setMinValue(1)
        .setMaxValue(365)))
    .addSubcommand(sub => sub
      .setName('lookup')
      .setDescription('Look up someone\'s birthday')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to look up')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('me')
      .setDescription('View your birthday settings'))
    .addSubcommand(sub => sub
      .setName('following')
      .setDescription('Manage birthdays you follow'))
    .addSubcommand(sub => sub
      .setName('test')
      .setDescription('Test birthday notifications (Admin only)')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to test notifications for')
        .setRequired(true))),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'timezone') {
      const allTimezones = moment.tz.names();
      // Filter based on input
      const filtered = allTimezones
        .filter(tz => tz.toLowerCase().includes(focusedOption.value.toLowerCase()))
        .slice(0, 25); // Limit to 25 choices

      await interaction.respond(
        filtered.map(tz => ({ name: tz, value: tz }))
      );
    }
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'set':
          await setBirthday(interaction);
          break;
        case 'follow':
          await showUpcoming(interaction);
          break;
        case 'lookup':
          await lookupBirthday(interaction);
          break;
        case 'me':
          await showMyBirthday(interaction);
          break;
        case 'following':
          await showFollowing(interaction);
          break;
        case 'test':
          await testBirthday(interaction);
          break;
        default:
          await interaction.reply({
            content: '❌ Unknown subcommand!',
            ephemeral: true
          });
      }
    } catch (error) {
      console.error(`Birthday command error (${subcommand}):`, error);

      const errorResponse = {
        content: '❌ An error occurred while processing your request. Please try again.',
        ephemeral: true
      };

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(errorResponse).catch(console.error);
      } else if (interaction.deferred) {
        await interaction.editReply(errorResponse).catch(console.error);
      }
    }
  },

  // Export the Birthday model for the event handler
  Birthday
};