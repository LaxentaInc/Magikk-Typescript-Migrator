const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { registerFonts } = require('../../utils/canvasFonts');

// font stack: inter for text, noto color emoji for emoji glyphs
const FONT_TEXT = '"Inter", "Noto Color Emoji"';

/**
 * Generate a quote image from message content
 * Layout: Left half = user avatar, Right half = quote text
 */
async function generateQuoteImage(messageContent, author) {
    // ensure fonts are downloaded + registered before drawing
    await registerFonts();

    const width = 800;
    const height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // enable color emoji rendering
    ctx.textDrawingMode = 'glyph';

    // black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    try {
        // load and draw user avatar on left side
        const avatarUrl = author.displayAvatarURL({ extension: 'png', size: 512 });
        const avatar = await loadImage(avatarUrl);

        // draw avatar covering left portion (half screen)
        const avatarWidth = width / 2;
        ctx.drawImage(avatar, 0, 0, avatarWidth, height);

        // create smooth gradient overlay that blends the avatar into black
        const gradient = ctx.createLinearGradient(avatarWidth - 250, 0, avatarWidth, 0);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.5)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // right side - quote text
        const textStartX = avatarWidth + 60;
        const textWidth = width - textStartX - 60;

        // quote text - clean and readable
        ctx.fillStyle = '#ffffff';
        ctx.font = `italic 28px ${FONT_TEXT}`;
        ctx.textAlign = 'left';

        // word wrap
        const lineHeight = 38;
        let y = height / 2 - 40;

        const words = `"${messageContent}"`.split(' ');
        let line = '';
        const lines = [];

        for (let word of words) {
            const testLine = line + word + ' ';
            const metrics = ctx.measureText(testLine);

            if (metrics.width > textWidth && line !== '') {
                lines.push(line.trim());
                line = word + ' ';
            } else {
                line = testLine;
            }
        }
        if (line) lines.push(line.trim());

        // limit lines
        const maxLines = 4;
        const displayLines = lines.slice(0, maxLines);

        // center vertically
        const totalTextHeight = displayLines.length * lineHeight;
        y = (height - totalTextHeight) / 2 + 20;

        // draw text lines
        displayLines.forEach((line, i) => {
            let displayLine = line;
            if (i === maxLines - 1 && lines.length > maxLines) {
                displayLine = line.substring(0, line.length - 3) + '...';
            }
            ctx.fillText(displayLine, textStartX, y + (i * lineHeight));
        });

        // author attribution
        ctx.fillStyle = '#aaaaaa';
        ctx.font = `16px ${FONT_TEXT}`;
        ctx.textAlign = 'left';
        const authorY = y + (displayLines.length * lineHeight) + 40;
        ctx.fillText(`- ${author.displayName}`, textStartX, authorY);

        // username/tag below
        ctx.fillStyle = '#666666';
        ctx.font = `13px ${FONT_TEXT}`;
        const tag = `@${author.username}`;
        ctx.fillText(tag, textStartX, authorY + 20);

        // aero branding in bottom right
        ctx.fillStyle = '#444444';
        ctx.font = `12px ${FONT_TEXT}`;
        ctx.textAlign = 'right';
        ctx.fillText('Aero-Chan', width - 20, height - 15);
    } catch (error) {
        console.error('Failed to generate quote image:', error);
        // fallback - just text on black
        ctx.fillStyle = '#ffffff';
        ctx.font = `24px ${FONT_TEXT}`;
        ctx.textAlign = 'center';
        ctx.fillText(messageContent.substring(0, 100), width / 2, height / 2);
        ctx.fillStyle = '#888888';
        ctx.font = `16px ${FONT_TEXT}`;
        ctx.fillText(`- ${author.username}`, width / 2, height / 2 + 40);
    }

    // convert to buffer
    return canvas.toBuffer('image/png');
}

module.exports = { generateQuoteImage };