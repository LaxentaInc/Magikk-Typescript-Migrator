const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./logger');

class TicketConfig {
    constructor() {
        this.configPath = path.join(__dirname, '../../data/ticketConfig.json');
        this.config = new Map();
        this.defaultConfig = {
            ticketChannel: null,
            transcriptChannel: null,
            supportRoles: [],
            categoryId: null,
            embedSettings: {
                color: 0x5865F2, // Discord Blurple as default
                title: 'Support Tickets',
                description: '<a:eh:1342443037371928627> Click the button below and describe your issue to create a ticket!!',
                thumbnail: null
            },
            buttonSettings: {
                label: 'Create Ticket?',
                emoji: '<a:eh:1342443908189257728>',
                style: 'PRIMARY'
            },
            ticketSettings: {
                nameFormat: 'ticket-{number}',
                welcomeMessage: '<a:wel:1342444020726501407> Please be patient! Support will be with you shortly!',
                maxTickets: 1, //only 1 ticker per person is enough honestly
                pingRoles: [],
                closeDelay: 5000 // 5 seconds delay before closing the ticket
            }
        };
        this.init();
    }

    async init() {
        try {
            await fs.mkdir(path.dirname(this.configPath), { recursive: true });
            await this.loadConfig();
        } catch (error) {
            logger.error('Error initializing TicketConfig:', error);
        }
    }

    async loadConfig() {
        try {
            const data = await fs.readFile(this.configPath, 'utf8');
            const configData = JSON.parse(data);
            Object.entries(configData).forEach(([guildId, settings]) => {
                // Merge with default config to ensure all properties exist
                this.config.set(guildId, this.mergeWithDefaults(settings));
            });
            logger.info('Ticket configuration loaded successfully');
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('Error loading ticket config:', error);
            }
            await this.saveConfig();
        }
    }

    mergeWithDefaults(settings) {
        const merged = {
            ...this.defaultConfig,
            ...settings,
            embedSettings: {
                ...this.defaultConfig.embedSettings,
                ...(settings.embedSettings || {})
            },
            buttonSettings: {
                ...this.defaultConfig.buttonSettings,
                ...(settings.buttonSettings || {})
            },
            ticketSettings: {
                ...this.defaultConfig.ticketSettings,
                ...(settings.ticketSettings || {})
            }
        };

        // Ensure color is always a valid hex number
        if (typeof merged.embedSettings.color === 'string') {
            merged.embedSettings.color = parseInt(merged.embedSettings.color.replace('#', ''), 16);
        }

        // Validate and fix numeric values
        merged.ticketSettings.closeDelay = Number(merged.ticketSettings.closeDelay) || 5000;
        merged.ticketSettings.maxTickets = Number(merged.ticketSettings.maxTickets) || 5;

        return merged;
    }

    async saveConfig() {
        try {
            const configData = Object.fromEntries(this.config);
            await fs.writeFile(this.configPath, JSON.stringify(configData, null, 2));
            logger.info(': 3 Ticket configuration saved successfully');
        } catch (error) {
            logger.error('error saving ticket config:', error);
        }
    }

    getGuildConfig(guildId) {
        const config = this.config.get(guildId);
        if (!config) {
            logger.info(`Creating new config for guild ${guildId}`);
            return this.defaultConfig;
        }
        return this.mergeWithDefaults(config);
    }

    async setGuildConfig(guildId, settings) {
        const mergedConfig = this.mergeWithDefaults(settings);
        this.config.set(guildId, mergedConfig);
        await this.saveConfig();
        logger.info(`Updated configuration for guild ${guildId}`);
        return mergedConfig;
    }
}

module.exports = new TicketConfig();