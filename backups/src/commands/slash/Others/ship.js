const {
    SlashCommandBuilder,
    EmbedBuilder,
    AttachmentBuilder,
    MessageFlags
} = require('discord.js');
const axios = require('axios');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { registerFonts } = require('../../../utils/canvasFonts');

const FONT_TEXT = '"Inter", "Noto Color Emoji"';

// ========== wallpaper cache ==========
const wallpaperCache = {
    urls: [],
    lastFetch: 0,
    isLoading: false,
    CACHE_DURATION: 1000 * 60 * 5, // 5 minutes
    CACHE_SIZE: 10 // reduced from 100 to save memory
};

// fill the cache in the background without blocking
const fillWallpaperCache = () => {
    if (wallpaperCache.isLoading) return;
    wallpaperCache.isLoading = true;

    (async () => {
        try {
            const promises = [];
            for (let i = 0; i < wallpaperCache.CACHE_SIZE; i++) {
                promises.push(
                    axios.get('https://nekos.life/api/v2/img/wallpaper', { timeout: 5000 })
                        .then(r => r.data.url)
                        .catch(() => null)
                );
            }
            const results = (await Promise.all(promises)).filter(Boolean);
            if (results.length > 0) {
                wallpaperCache.urls = results;
                wallpaperCache.lastFetch = Date.now();
            }
        } catch (e) {
            // silent fail
        } finally {
            wallpaperCache.isLoading = false;
        }
    })();
};

// kick off initial cache fill on load
fillWallpaperCache();

// get a wallpaper url from cache or fetch one directly as fallback
const getBackground = async () => {
    const now = Date.now();

    // refill cache if expired or running low
    if (now - wallpaperCache.lastFetch > wallpaperCache.CACHE_DURATION || wallpaperCache.urls.length < 3) {
        fillWallpaperCache();
    }

    // serve from cache instantly if available
    if (wallpaperCache.urls.length > 0) {
        const idx = Math.floor(Math.random() * wallpaperCache.urls.length);
        return wallpaperCache.urls.splice(idx, 1)[0];
    }

    // fallback: direct fetch if cache is empty
    try {
        const response = await axios.get('https://nekos.life/api/v2/img/wallpaper', { timeout: 5000 });
        return response.data.url;
    } catch {
        return null;
    }
};

// random compatibility each time
const getCompatibility = () => {
    return Math.floor(Math.random() * 101);
};

// generate the ship name from two usernames
const getShipName = (name1, name2) => {
    const half1 = name1.slice(0, Math.ceil(name1.length / 2));
    const half2 = name2.slice(Math.floor(name2.length / 2));
    return half1 + half2;
};

// special-case certain pairs (e.g. fav couple) for custom behaviour
const isSpecialPair = (user1, user2) => {
    const u1 = user1.username.toLowerCase();
    const u2 = user2.username.toLowerCase();

    const a = 'a.itsjustmyinitial';
    const b = 'laxenta.me';

    return (u1 === a && u2 === b) || (u1 === b && u2 === a);
};

// custom compatibility logic for special pairs
// never goes below 50, otherwise uniform
const getSpecialCompatibility = () => {
    // returns an integer between 50 and 100 inclusive
    return 50 + Math.floor(Math.random() * 51);
};

// pick a random flavour message based on the compatibility percentage
const getFlavourText = (percent) => {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    if (percent === 0) return pick([
        'But... the compatibility between you is null.',
        'Absolutely nothing. Nada. Zero.',
        'The universe said no.',
        'This ship was dead on arrival.',
        'Stick to gooning mate'
    ]);
    if (percent <= 10) return pick([
        'Yikes... this ship is sinking before it even launched.',
        'Not even flex tape can fix this ship.',
        'Maybe in another universe... but not this one.',
        'The ship hit an iceberg immediately. 🧊',
        'Stick to gooning mate'

    ]);
    if (percent <= 20) return pick([
        'This is... rough. Like really rough.',
        'Bestie... I wouldn\'t get my hopes up.',
        'Even the stars are looking away from this one.',
        'Have you considered being pen pals instead?',
        'Stick to gooning mate'

    ]);
    if (percent <= 30) return pick([
        'There\'s a spark... but it\'s more like a short circuit.',
        'Hmm, I\'ve seen worse. Not much worse, but worse.',
        'The compatibility is giving... acquaintances at best.',
        'Maybe stick to waving from across the room. 👋'
    ]);
    if (percent <= 40) return pick([
        'Eh, it\'s giving "just friends" vibes.',
        'There\'s potential... if you squint really hard.',
        'Not the worst ship, but definitely needs repairs.',
        'The vibe is there... somewhere... maybe. 🤔'
    ]);
    if (percent <= 50) return pick([
        'It\'s a coin flip honestly! Could go either way~',
        'Perfectly balanced, as all things should be.',
        '50/50 odds. You feeling lucky? 🎲',
        'The universe is undecided on this one.'
    ]);
    if (percent <= 60) return pick([
        'Not bad! There\'s definitely something there~',
        'The ship is floating! That\'s a good sign!',
        'I see chemistry brewing... 👀',
        'Something\'s cooking and it smells like love~ 🍳'
    ]);
    if (percent <= 70) return pick([
        'Ooh, things are getting interesting! 💕',
        'There might be something real here! Keep trying~',
        'This ship has wind in its sails! ⛵',
        'The stars are starting to align for you two~'
    ]);
    if (percent <= 80) return pick([
        'Wow, you two might actually be onto something! 💖',
        'This is looking really promising!',
        'Never give up on each other',
        'The ship is sailing smoothly~ full speed ahead!',
        'Someone call the wedding planner... maybe? 💒'
    ]);
    if (percent <= 90) return pick([
        'This ship is basically canon at this point! 🚢💖',
        'The compatibility is through the roof!!',
        'You two were made for each other fr fr 💗',
        'Even the gods approve of this ship! ✨',
        'You two are accidentally soulmates and the bot is just documenting it.',
        'Heavy main character energy when you\'re together ngl.'
    ]);
    if (percent <= 99) return pick([
        'OH MY GOD just get married already!! 💍',
        'This is the kind of love stories are written about!',
        'Soulmate energy is OFF THE CHARTS!',
        'I\'m literally crying this is so perfect 💖',
        'Nice. You two are outrageously down bad for each other LMAO.',
        '69%... the brainrot is mutual and unhinged, keep it up.',
        'This ship is 69% chaos, 31% sanity — perfect balance actually.'
    ]);
    return pick([
        'Soulmates! This was literally meant to be!',
        'PERFECT MATCH! The universe has spoken!',
        '100%?! This is destiny incarnate!',
        '💖 A love so powerful it broke the algorithm!',
        'Certified canon. No take-backs, the bot has spoken.',
        'Algorithm says 100% — you literally broke the scale together.',
        'OTP locked in. Everyone else is just background characters.',
        'Lowkey already married in another timeline, this is just the rerun.'
    ]);
};

// generate the ship canvas image
const generateShipImage = async (user1, user2, percent) => {
    // ensure fonts are downloaded + registered before drawing
    await registerFonts();

    const width = 700;
    const height = 300;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // enable color emoji rendering
    ctx.textDrawingMode = 'glyph';

    // try to load a background wallpaper
    try {
        const bgUrl = await getBackground();
        if (bgUrl) {
            const bg = await loadImage(bgUrl);
            // cover the canvas with the background
            const scale = Math.max(width / bg.width, height / bg.height);
            const bw = bg.width * scale;
            const bh = bg.height * scale;
            ctx.drawImage(bg, (width - bw) / 2, (height - bh) / 2, bw, bh);
        } else {
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, width, height);
        }
    } catch {
        // fallback dark background
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);
    }

    // dark overlay for readability
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, width, height);

    // load both avatars
    const avatarSize = 120;
    const avatar1Url = user1.displayAvatarURL({ extension: 'png', size: 256 });
    const avatar2Url = user2.displayAvatarURL({ extension: 'png', size: 256 });

    let avatar1, avatar2;
    try {
        [avatar1, avatar2] = await Promise.all([
            loadImage(avatar1Url),
            loadImage(avatar2Url)
        ]);
    } catch {
        // if avatars fail to load, draw placeholder circles
        avatar1 = null;
        avatar2 = null;
    }

    // positions for circular avatars
    const avatarY = height / 2 - avatarSize / 2 - 10;
    const avatar1X = width / 2 - avatarSize - 70;
    const avatar2X = width / 2 + 70;

    // helper to draw a circular avatar
    const drawCircularAvatar = (img, x, y, size) => {
        ctx.save();

        // outer glow ring
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2 + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 105, 180, 0.6)';
        ctx.lineWidth = 3;
        ctx.stroke();

        // clip to circle
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        if (img) {
            ctx.drawImage(img, x, y, size, size);
        } else {
            // placeholder
            ctx.fillStyle = '#333';
            ctx.fillRect(x, y, size, size);
        }

        ctx.restore();
    };

    drawCircularAvatar(avatar1, avatar1X, avatarY, avatarSize);
    drawCircularAvatar(avatar2, avatar2X, avatarY, avatarSize);

    // draw a little heart between them
    const heartX = width / 2;
    const heartY = avatarY + avatarSize / 2;
    ctx.fillStyle = '#ff69b4';
    ctx.font = `28px ${FONT_TEXT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💕', heartX, heartY);

    // percentage text below the avatars
    const percentY = avatarY + avatarSize + 35;
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 36px ${FONT_TEXT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${percent}%`, width / 2, percentY);

    // usernames below their avatars
    ctx.fillStyle = '#cccccc';
    ctx.font = `14px ${FONT_TEXT}`;
    ctx.textAlign = 'center';
    const nameY = avatarY - 12;
    ctx.fillText(user1.username, avatar1X + avatarSize / 2, nameY);
    ctx.fillText(user2.username, avatar2X + avatarSize / 2, nameY);

    return canvas.toBuffer('image/png');
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ship')
        .setDescription('Ship two users together and see their compatibility!')
        .setIntegrationTypes(0, 1)
        .setContexts([0, 1, 2])
        .addUserOption(option =>
            option
                .setName('user1')
                .setDescription('The first user to ship')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('user2')
                .setDescription('The second user to ship')
                .setRequired(true)
        ),
    async execute(interaction) {
        const user1 = interaction.options.getUser('user1');
        const user2 = interaction.options.getUser('user2');

        // no shipping someone with themselves
        if (user1.id === user2.id) {
            return interaction.reply({
                content: `you can't ship someone with themselves lol`,
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply();
        
        try {
            // special protection for certain pairs so they never flop
            const specialPair = isSpecialPair(user1, user2);

            const percent = specialPair
                ? getSpecialCompatibility()
                : getCompatibility();

            const shipName = getShipName(user1.username, user2.username);
            const flavour = getFlavourText(percent);

            // generate the canvas image
            const imageBuffer = await generateShipImage(user1, user2, percent);
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'ship.png' });

            const embed = new EmbedBuilder()
                .setColor('#ff69b4')
                .setDescription(
                    `<a:Mariposas_Kawaii:1333359136037011568> | The name of the ship is **${shipName}**\n` +
                    `<a:kittycat:1333358006720794624> | The compatibility is **${percent}%**\n\n` +
                    `*${flavour}*`
                )
                .setImage('attachment://ship.png')
            // .setFooter({
            //     text: `shipped by ${interaction.user.username}`,
            //     iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 64 })
            // });

            await interaction.editReply({ embeds: [embed], files: [attachment] });
        } catch (error) {
            console.error('error executing ship command:', error);
            await interaction.editReply({
                content: 'something went wrong while shipping... try again later!'
            });
        }
    }
};
