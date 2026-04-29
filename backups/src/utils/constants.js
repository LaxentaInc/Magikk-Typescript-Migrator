const Colors = {
    ERROR: 0xFF0000,      // Red
    SUCCESS: 0x57F287,    // Green
    INFO: 0x5865F2,       // Discord Blurple
    WARNING: 0xFFA500,    // Orange
    PRIMARY: 0x5865F2,    // Discord Blurple (same as INFO)
    SECONDARY: 0x4F545C,  // Dark Grey
    DEFAULT: 0x2F3136     // Discord Dark
};

const Messages = {
    ERROR: 'An error occurred while executing the command.',
    NO_PERMISSION: 'You do not have permission to use this command.',
    COMMAND_COOLDOWN: 'Please wait before using this command again.',
    INVALID_USAGE: 'Invalid command usage. Please check the correct syntax.',
    MISSING_ARGS: 'Missing required arguments.',
    SUCCESS: 'Command executed successfully.',
    TICKET_CREATED: 'Ticket created successfully!',
    TICKET_CLOSED: 'Ticket will be closed.',
    TICKET_CLAIMED: 'Ticket claimed successfully!'
};

const Permissions = {
    ADMIN: 'Administrator',
    MANAGE_MESSAGES: 'ManageMessages',
    KICK_MEMBERS: 'KickMembers',
    BAN_MEMBERS: 'BanMembers',
    MANAGE_ROLES: 'ManageRoles',
    MANAGE_CHANNELS: 'ManageChannels',
    MANAGE_GUILD: 'ManageGuild'
};

module.exports = {
    Colors,
    Messages,
    Permissions
};