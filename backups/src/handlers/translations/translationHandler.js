const Tesseract = require("tesseract.js");
const translate = require("translate-google-api");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Temp directory for image processing
const TEMP_DIR = path.join(__dirname, "../../temp/translations");
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Language display names
const LANGUAGES = {
    en: "English",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    es: "Spanish",
    fr: "French",
    de: "German",
    ru: "Russian",
    ar: "Arabic",
    hi: "Hindi",
    pt: "Portuguese",
    it: "Italian"
};

// API Keys
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY;

function downloadFile(url, filepath) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith("https") ? https : http;
        const file = fs.createWriteStream(filepath);

        const request = client.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                downloadFile(response.headers.location, filepath).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on("finish", () => {
                file.close();
                resolve();
            });
        });

        request.on("error", (err) => {
            fs.unlink(filepath, () => { });
            reject(err);
        });

        request.setTimeout(30000, () => {
            request.destroy();
            reject(new Error("Download timeout"));
        });
    });
}

// Extract text using OCR.space API
async function extractTextWithOCRSpace(imageUrl) {
    if (!OCR_SPACE_API_KEY) {
        throw new Error("OCR_SPACE_API_KEY not configured");
    }

    try {
        const response = await axios.get("https://api.ocr.space/parse/imageurl", {
            params: {
                apikey: OCR_SPACE_API_KEY,
                url: imageUrl,
                language: "auto",
                OCREngine: "2"
            }
        });

        if (response.data.IsErroredOnProcessing) {
            throw new Error(response.data.ErrorMessage?.[0] || "OCR.space processing error");
        }

        if (response.data.ParsedResults && response.data.ParsedResults.length > 0) {
            return response.data.ParsedResults.map(r => r.ParsedText).join(" ").trim();
        }
        return "";
    } catch (error) {
        throw new Error(`OCR.space API error: ${error.message}`);
    }
}

// Extract text using Google Cloud Vision API
async function extractTextWithGoogleVision(imagePath) {
    if (!GOOGLE_VISION_API_KEY) {
        throw new Error("GOOGLE_VISION_API_KEY not configured");
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");

    const requestBody = JSON.stringify({
        requests: [{
            image: { content: base64Image },
            features: [{ type: "TEXT_DETECTION", maxResults: 1 }]
        }]
    });

    return new Promise((resolve, reject) => {
        const options = {
            hostname: "vision.googleapis.com",
            path: `/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(requestBody)
            }
        };

        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const response = JSON.parse(data);
                    if (response.error) {
                        reject(new Error(response.error.message));
                        return;
                    }
                    const textAnnotations = response.responses?.[0]?.textAnnotations;
                    if (textAnnotations && textAnnotations.length > 0) {
                        resolve(textAnnotations[0].description);
                    } else {
                        resolve("");
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on("error", reject);
        req.write(requestBody);
        req.end();
    });
}

// extract text using Tesseract.js (fallback)
async function extractTextWithTesseract(imagePath) {
    const defaultLangs = "eng+rus+jpn+kor+chi_sim+ara+hin+spa+fra+deu";
    try {
        const result = await Tesseract.recognize(imagePath, defaultLangs, {
            logger: () => { }
        });
        return result.data.text;
    } catch (error) {
        console.error('tesseract failed to read image:', error.message);
        throw new Error('Failed to extract text from image (format may be unsupported)');
    }
}

// Check if URL is an image
function isImageUrl(url) {
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
    const lowerUrl = url.toLowerCase().split("?")[0];
    return imageExtensions.some(ext => lowerUrl.endsWith(ext)) ||
        url.includes("cdn.discordapp.com") ||
        url.includes("media.discordapp.net");
}

// Process image and translate
async function processAndTranslate(imageUrl, targetLang, engine) {
    const timestamp = Date.now();
    const ext = imageUrl.split("?")[0].split(".").pop() || "jpg";
    const imagePath = path.join(TEMP_DIR, `img_${timestamp}.${ext}`);

    try {
        // Start processing
        let extractedText = "";
        let usedEngine = "";

        // Helper to ensure file is downloaded only when needed
        const ensureImageDownloaded = async () => {
            if (!fs.existsSync(imagePath)) {
                await downloadFile(imageUrl, imagePath);
            }
        };

        if (engine === "ocrspace") {
            extractedText = await extractTextWithOCRSpace(imageUrl);
            usedEngine = "OCR.space";
        } else if (engine === "google") {
            await ensureImageDownloaded();
            extractedText = await extractTextWithGoogleVision(imagePath);
            usedEngine = "Google Vision";
        } else if (engine === "tesseract") {
            await ensureImageDownloaded();
            extractedText = await extractTextWithTesseract(imagePath);
            usedEngine = "Tesseract";
        } else {
            // Default Priority: OCR.space -> Google Vision -> Tesseract
            try {
                extractedText = await extractTextWithOCRSpace(imageUrl);
                usedEngine = "OCR.space";
            } catch (err) {
                console.log("OCR.space failed, trying Google Vision:", err.message);
                try {
                    await ensureImageDownloaded();
                    extractedText = await extractTextWithGoogleVision(imagePath);
                    usedEngine = "Google Vision";
                } catch (err2) {
                    console.log("Google Vision failed, trying Tesseract:", err2.message);
                    await ensureImageDownloaded();
                    extractedText = await extractTextWithTesseract(imagePath);
                    usedEngine = "Tesseract";
                }
            }
        }

        extractedText = extractedText.trim();

        if (!extractedText) {
            return { success: false, error: "no_text" };
        }

        const translatedText = await translate(extractedText, { to: targetLang });
        const translatedStr = Array.isArray(translatedText) ? translatedText.join(" ") : translatedText;

        return {
            success: true,
            original: extractedText,
            translated: translatedStr,
            engine: usedEngine,
            targetLang
        };
    } finally {
        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
    }
}

// Translate plain text
async function translateText(text, targetLang = 'en', sourceLang = null) {
    const options = { tld: "com", to: targetLang };
    if (sourceLang) options.from = sourceLang;

    const result = await translate(text, options);
    const translatedText = Array.isArray(result) ? result[0] : result;

    return {
        original: text,
        translated: translatedText,
        targetLang,
        sourceLang: sourceLang || 'auto'
    };
}

module.exports = {
    processAndTranslate,
    translateText,
    isImageUrl,
    LANGUAGES
};
