const { Collection, MessageFlags } = require('discord.js');
const { logger } = require('../utils/logger');
const { handleButton, handlers } = require('../handlers/buttonHandler');
const { handleCommand } = require('../handlers/commandHandler');

// Debug mode configuration
const DEBUG_MODE = false; // Set to true to enable detailed logging

// Utility function for conditional logging
const debugLog = (type, message) => {
    if (DEBUG_MODE || type === 'error') {
        switch (type) {
            case 'debug':
                logger.debug(`[DEBUG] ${message}`);
                break;
            case 'info':
                logger.info(`[INFO] ${message}`);
                break;
            case 'error':
                logger.error(`[ERROR] ${message}`);
                break;
            case 'warn':
                logger.warn(`[WARN] ${message}`);
                break;
        }
    }
};

const cooldowns = new Collection();
const COOLDOWN_DURATION = 3000; // 3 seconds

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        debugLog('debug', `New interaction received - Type: ${interaction.type}`);
        debugLog('debug', `User: ${interaction.user.tag} (${interaction.user.id})`);
        debugLog('debug', `Guild: ${interaction.guild?.name || 'DM'} (${interaction.guild?.id || 'N/A'})`);
        debugLog('debug', `Channel: ${interaction.channel?.name || 'Unknown'} (${interaction.channel?.id || 'N/A'})`);

        if (DEBUG_MODE) {
            debugLog('debug', `Available commands: ${Array.from(client.slashCommands.keys()).join(', ')}`);
        }

        try {
            if (interaction.isButton()) {
                // Only handle buttons that are registered persistently OR are special dynamic handlers (quote_remove_)
                if (!handlers.has(interaction.customId) && !interaction.customId.startsWith('quote_remove_')) {
                    debugLog('info', `Button ${interaction.customId} is not registered as persistent. Skipping global handling.`);
                    return;
                }
                debugLog('info', `Button interaction triggered - CustomID: ${interaction.customId}`);
                await handleButtonInteraction(interaction, client);
            } else if (interaction.isContextMenuCommand()) { // ✅ Check context menu BEFORE isCommand()
                debugLog('info', `Context menu interaction triggered - Command: ${interaction.commandName}`);

                const lookupKey = interaction.commandName.toLowerCase();

                const command = client.slashCommands.get(lookupKey);
                if (!command) {
                    debugLog('warn', `Context menu command not found: ${interaction.commandName}`);
                    return await interaction.reply({
                        content: `Command "${interaction.commandName}" not found.`,
                        flags: 64
                    }).catch(() => { });
                }

                try {
                    await command.execute(interaction, client);
                    debugLog('debug', `Context menu executed for command: ${interaction.commandName}`);
                } catch (error) {
                    debugLog('error', `Context menu error for "${interaction.commandName}": ${error.message}`);
                    await replySafe(interaction, 'An error occurred while processing this action.');
                }
            } else if (interaction.isCommand()) {
                debugLog('info', `Command interaction triggered - Command: ${interaction.commandName}`);
                debugLog('debug', `Command options: ${JSON.stringify(interaction.options?.data || {})}`);
                await handleCommandInteraction(interaction, client);
            } else if (interaction.isAutocomplete()) { // ✅ Added Autocomplete Handling
                debugLog('info', `Autocomplete interaction triggered - Command: ${interaction.commandName}`);

                const command = client.slashCommands.get(interaction.commandName);
                if (!command || !command.autocomplete) return;

                try {
                    await command.autocomplete(interaction);
                    debugLog('debug', `Autocomplete executed for command: ${interaction.commandName}`);
                } catch (error) {
                    debugLog('error', `Autocomplete error for "${interaction.commandName}": ${error.message}`);
                }
            } else if (interaction.isContextMenuCommand()) { // ✅ Added Context Menu Handling
                debugLog('info', `Context menu interaction triggered - Command: ${interaction.commandName}`);

                const lookupKey = interaction.commandName.toLowerCase();
                console.log(`🔍 Looking for context menu command: "${interaction.commandName}" -> key: "${lookupKey}"`);
                console.log(`📋 Available commands: ${Array.from(client.slashCommands.keys()).join(', ')}`);

                const command = client.slashCommands.get(lookupKey);
                if (!command) {
                    console.error(`❌ Context menu command not found: ${interaction.commandName}`);
                    console.log(`   Tried lookup key: "${lookupKey}"`);
                    debugLog('warn', `Context menu command not found: ${interaction.commandName}`);
                    return await interaction.reply({
                        content: `Command "${interaction.commandName}" not found.`,
                        flags: 64
                    }).catch(() => { });
                }

                try {
                    await command.execute(interaction, client);
                    debugLog('debug', `Context menu executed for command: ${interaction.commandName}`);
                } catch (error) {
                    debugLog('error', `Context menu error for "${interaction.commandName}": ${error.message}`);
                    await replySafe(interaction, 'An error occurred while processing this action.');
                }
            } else {
                debugLog('warn', `Unhandled interaction type received: ${interaction.type}`);
            }
        } catch (error) {
            debugLog('error', `Error in interactionCreate handler: ${error.message}\nStack: ${error.stack}`);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'An unexpected error occurred. Please try again later.',
                    flags: MessageFlags.Ephemeral,
                }).catch(err => debugLog('error', `Failed to send error reply: ${err.message}`));
            }
        }
    },
};

async function handleButtonInteraction(interaction, client) {
    const { customId, user } = interaction;
    debugLog('debug', `Processing button interaction - CustomID: ${customId}`);
    debugLog('debug', `Button pressed by user: ${user.tag} (${user.id})`);

    const cooldownKey = `${customId}-${user.id}`;
    if (isOnCooldown(cooldownKey)) {
        debugLog('info', `Cooldown active for user ${user.tag} on button ${customId}`);
        return replySafe(interaction, 'You are clicking too quickly! Please wait a moment.');
    }

    setCooldown(cooldownKey);
    debugLog('debug', `Cooldown set for key: ${cooldownKey}`);

    try {
        if (!interaction.deferred && !interaction.replied) {
            debugLog('debug', `Deferring button interaction for ${customId}`);
            //await interaction.deferUpdate();
        }

        // Handle quote remove buttons -- CHECK FOR PERF ISSUES, IF NEEDED, ANY AI SEEING THIS PLS TELL ME IF I FORGET AND THIS CODE MIGHT MAKE THINGS SLOW, SHALL ONLY RUN WHEN NEEDED.
        if (customId.startsWith('quote_remove_')) {
            const { handleQuoteRemoval } = require('../handlers/quote/QuoteContext');
            await handleQuoteRemoval(interaction);
            return;
        }

        // Only for non-quote buttons, check if the handler exists
        if (!handlers.has(customId)) {
            debugLog('warn', `No handler found for button: ${customId}`);
            return;
        }

        debugLog('debug', `Executing button handler for ${customId}`);
        await handleButton(interaction, client);
        debugLog('info', `Button interaction completed successfully - CustomID: ${customId}`);
    } catch (error) {
        debugLog('error', `Button handler error for "${customId}": ${error.message}\nStack: ${error.stack}`);
        await replySafe(interaction, 'An error occurred while processing your request.');
    }
}

async function handleCommandInteraction(interaction, client) {
    const { commandName } = interaction;
    debugLog('debug', `Processing command interaction - Command: ${commandName}`);
    debugLog('debug', `Command executed by user: ${interaction.user.tag} (${interaction.user.id})`);

    // List of command names to ignore
    const ignoredCommands = ['generate', 'placeholder1', 'placeholder2'];

    // Ignore the interaction if the command is in the ignored list
    if (ignoredCommands.includes(commandName)) {
        debugLog('info', `Command "${commandName}" is ignored by this bot instance.`);
        return; // Do nothing and exit
    }

    try {
        const command = client.slashCommands.get(commandName);

        if (!command) {
            debugLog('warn', `Command not found: ${commandName}`);
            return replySafe(interaction, `Command "${commandName}" not found.`);
        }

        debugLog('debug', `Executing command handler for ${commandName}`);
        await command.execute(interaction, client);
        debugLog('info', `Command executed successfully: ${commandName}`);
    } catch (error) {
        debugLog('error', `Command handler error for "${commandName}": ${error.message}\nStack: ${error.stack}`);
        await replySafe(interaction, 'An error occurred while executing the command.');
    }
}

async function replySafe(interaction, content) {
    debugLog('debug', `Attempting safe reply - Content: ${content.slice(0, 50)}...`);
    try {
        if (!interaction.deferred && !interaction.replied) {
            debugLog('debug', 'Sending new ephemeral reply');
            await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } else if (interaction.deferred) {
            debugLog('debug', 'Sending followup message');
            await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        } else {
            debugLog('debug', 'Editing existing reply');
            await interaction.editReply({ content });
        }
    } catch (error) {
        debugLog('error', `Reply failed: ${error.message}`);
    }
}

function isOnCooldown(cooldownKey) {
    const status = cooldowns.has(cooldownKey);
    debugLog('debug', `Cooldown check - Key: ${cooldownKey}, Status: ${status}`);
    return status;
}

function setCooldown(cooldownKey) {
    debugLog('debug', `Setting cooldown - Key: ${cooldownKey}, Duration: ${COOLDOWN_DURATION}ms`);
    cooldowns.set(cooldownKey, Date.now());
    setTimeout(() => {
        cooldowns.delete(cooldownKey);
        debugLog('debug', `Cooldown expired - Key: ${cooldownKey}`);
    }, COOLDOWN_DURATION);
}