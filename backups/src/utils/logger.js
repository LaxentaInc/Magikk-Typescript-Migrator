const fs = require('fs');
const path = require('path');

// Define log levels with default colors (will be updated with chalk dynamically)
const logLevels = {
    fatal: { color: (msg) => msg, level: 0 },
    error: { color: (msg) => msg, level: 1 },
    warn: { color: (msg) => msg, level: 2 },
    info: { color: (msg) => msg, level: 3 },
    debug: { color: (msg) => msg, level: 4 },
};

// Always set the log level to 'debug' to show all logs
const LOG_LEVEL = 'debug';

// Utility to format timestamp
const formatTimestamp = () => new Date().toISOString();

// Dynamically import chalk and apply colors to log levels
async function loadChalk() {
    try {
        const chalk = (await import('chalk')).default;
        logLevels.fatal.color = chalk.bold.red;
        logLevels.error.color = chalk.red;
        logLevels.warn.color = chalk.yellow;
        logLevels.info.color = chalk.green;
        logLevels.debug.color = chalk.blue;
    } catch (err) {
        console.error("Failed to load chalk, defaulting to plain text logging.");
    }
}

// Initialize chalk colors (run this once on startup)
loadChalk().catch(console.error);

// General log function
function log(level, message) {
    const logLevel = logLevels[level];
    if (logLevel && logLevel.level <= logLevels[LOG_LEVEL].level) {
        const timestamp = formatTimestamp();
        const formattedMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;

        // Console output with dynamic color (color applied once chalk is loaded)
        console.log(logLevel.color ? logLevel.color(formattedMessage) : formattedMessage);

        // Asynchronous file output for errors
        if (level === 'error' || level === 'fatal') {
            fs.promises.appendFile(path.join(__dirname, 'error.log'), `${formattedMessage}\n`)
                .catch(err => console.error("Failed to write to error log file:", err));
        }
    }
}

// Define specific log level functions
const logger = {
    fatal: (msg) => log('fatal', msg),
    error: (msg) => log('error', msg),
    warn: (msg) => log('warn', msg),
    info: (msg) => log('info', msg),
    debug: (msg) => log('debug', msg),
};

// Error handler function
function handleError(error, isFatal = false) {
    const errorMsg = error instanceof Error ? error.stack || error.message : error;
    logger.error(`Error encountered: ${errorMsg}`);

    if (isFatal) {
        logger.fatal("Fatal error encountered, shutting down...");
        process.exit(1); // Exit only for fatal errors
    }
}

// :3 Exporting logger and error handler 
module.exports = { logger, handleError };
