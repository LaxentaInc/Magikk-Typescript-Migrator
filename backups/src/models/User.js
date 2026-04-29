const mongoose = require('mongoose');
// UNUSED AND REDUNDANT, WE DONT USE WEB DASHBOARD FROM THIS CODE NOW 
const userSchema = new mongoose.Schema({
    discordId: String,
    username: String,
    email: String,
    avatar: String,
    // Add sessions back
    sessions: [{
        sessionId: String,
        createdAt: Date,
        lastActive: Date,
        ip: String,
        isActive: Boolean,
        spotify: {
            accessToken: String,
            refreshToken: String,
            expiresAt: Date,
            profile: Object,
            needsReconnect: Boolean
        }
    }],
    lastActive: {
        type: Date,
        default: Date.now
    },
    spotifyAuth: {
        accessToken: String,
        refreshToken: String,
        expiresAt: Date,
        profile: Object
    }
});

// Add session management methods
userSchema.methods.findOrCreateSession = function(sessionId, ip) {
    if (!this.sessions) {
        this.sessions = [];
    }

    let session = this.sessions.find(s => s.sessionId === sessionId);
    
    if (!session) {
        session = {
            sessionId: sessionId,
            createdAt: new Date(),
            lastActive: new Date(),
            ip: ip || 'unknown',
            isActive: true
        };
        this.sessions.push(session);
    } else {
        session.lastActive = new Date();
        session.isActive = true;
        if (ip) session.ip = ip;
    }
    
    return session;
};
// cleaning up the sessionssss
userSchema.methods.cleanupSessions = async function() {
    if (!this.sessions) return;
    
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    
    // Count active sessions first
    const activeSessions = this.sessions.filter(s => 
        s.isActive && s.lastActive > oneDayAgo
    );
    
    if (activeSessions.length > 3) {
        // Keep only the 3 most recent active sessions
        const sortedSessions = activeSessions
            .sort((a, b) => b.lastActive - a.lastActive)
            .slice(0, 3);
            
        // Add their IDs to a Set for quick lookup
        const keepSessionIds = new Set(sortedSessions.map(s => s.sessionId));
        
        // Filter the main sessions array
        this.sessions = this.sessions.filter(s => 
            keepSessionIds.has(s.sessionId) || 
            (s.isActive && s.lastActive > oneDayAgo)
        );
        
        console.log('Session cleanup:', {
            before: activeSessions.length,
            after: this.sessions.length,
            userId: this._id
        });
    }
    
    return this.save();
};

userSchema.methods.touch = function() {
    this.lastActive = new Date();
    return this.save();
};

userSchema.methods.updateSpotifyTokens = function(tokens) {
    this.spotifyAuth = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + (tokens.expiresIn * 1000)),
        profile: tokens.profile || this.spotifyAuth?.profile
    };
    return this.save();
};

userSchema.methods.clearAuthData = async function() {
    try {
        // Clear ALL sessions and spotify data atomically
        await this.model('User').findByIdAndUpdate(
            this._id,
            {
                $set: { sessions: [] },  // Clear all sessions
                $unset: { 
                    "spotifyAuth": "",   // Remove global spotify auth
                }
            },
            { new: true }
        );

        // Clear in-memory data
        this.sessions = [];
        this.spotifyAuth = undefined;

        return true;
    } catch (error) {
        console.error('Clear auth data error:', error);
        throw error;
    }
};
const User = mongoose.model('User', userSchema);
module.exports = User;