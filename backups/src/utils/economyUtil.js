// path: utils/economyUtil.js

const { getDb } = require('./CloudDB');
const NodeCache = require('node-cache');

// Cache: TTL 1 hour (refresh on access), check for expired keys every 60s
// We keep active users in memory longer now since we rely on cache for writes.
const userCache = new NodeCache({ stdTTL: 3600, checkperiod: 60, useClones: false });

// Track users with unsaved changes
const dirtyUsers = new Set();

// New default balance: 100,000
const DEFAULT_BALANCE = 500000;

// Helper to format currency: 125000 -> "125,000 (125k)"
function formatCurrency(amount) {
  const formatted = amount.toLocaleString('en-US');
  let suffix = "";

  if (amount >= 1000000) {
    suffix = ` (${(amount / 1000000).toFixed(1).replace(/\.0$/, '')}M)`;
  } else if (amount >= 1000) {
    suffix = ` (${(amount / 1000).toFixed(1).replace(/\.0$/, '')}k)`;
  }

  return `⏣ ${formatted}${suffix}`;
}

async function connectDB() {
  try {
    const db = await getDb("botEconomy");
    return db;
  } catch (error) {
    console.error("Error connecting to MongoDB via CloudDB:", error);
    throw error;
  }
}

// Ensure user is in cache, fetch from DB if not
async function ensureUserCached(userId) {
  let user = userCache.get(userId);
  if (user) return user;

  const database = await connectDB();
  const collection = database.collection("users");
  user = await collection.findOne({ userId });

  if (!user) {
    user = {
      userId,
      balance: DEFAULT_BALANCE,
      lastDaily: null,
      lastWork: null
    };
    // If new user, likely to change, so mark dirty immediately if we treat creation as a change?
    // Better: insert immediately to DB or just cache it and mark dirty.
    // Let's mark dirty to save DB calls on creation too.
    dirtyUsers.add(userId);
  }

  userCache.set(userId, user);
  return user;
}

// READ: Always from cache (after ensure)
async function getBalance(userId) {
  const user = await ensureUserCached(userId);
  return user.balance;
}

async function getUser(userId) {
  return await ensureUserCached(userId);
}

// WRITE: Update cache, mark dirty
async function updateBalance(userId, amount) {
  const user = await ensureUserCached(userId);
  user.balance += amount;
  dirtyUsers.add(userId);
  userCache.set(userId, user); // Refresh TTL
  return user.balance;
}

async function setBalance(userId, newBalance) {
  const user = await ensureUserCached(userId);
  user.balance = newBalance;
  dirtyUsers.add(userId);
  userCache.set(userId, user);
  return user.balance;
}

async function claimDaily(userId, rewardAmount = 10000) {
  const user = await ensureUserCached(userId);
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;

  if (user.lastDaily && (now - user.lastDaily) < cooldown) {
    return {
      success: false,
      timeLeft: cooldown - (now - user.lastDaily)
    };
  }

  user.balance += rewardAmount;
  user.lastDaily = now;

  dirtyUsers.add(userId);
  userCache.set(userId, user);

  return { success: true, balance: user.balance };
}

async function performWork(userId, minReward = 1000, maxReward = 5000) {
  const user = await ensureUserCached(userId);
  const now = Date.now();
  const cooldown = 60 * 60 * 1000; // 1 hour

  if (user.lastWork && (now - user.lastWork) < cooldown) {
    return {
      success: false,
      timeLeft: cooldown - (now - user.lastWork)
    };
  }

  const earned = Math.floor(Math.random() * (maxReward - minReward + 1)) + minReward;
  user.balance += earned;
  user.lastWork = now;

  dirtyUsers.add(userId);
  userCache.set(userId, user);

  return { success: true, earned, balance: user.balance };
}

async function transfer(fromId, toId, amount) {
  if (amount <= 0) throw new Error("Amount must be positive.");

  const sender = await ensureUserCached(fromId);
  if (sender.balance < amount) throw new Error("Insufficient funds.");
  const receiver = await ensureUserCached(toId);

  sender.balance -= amount;
  receiver.balance += amount;

  dirtyUsers.add(fromId);
  dirtyUsers.add(toId);

  userCache.set(fromId, sender);
  userCache.set(toId, receiver);

  return {
    senderBalance: sender.balance,
    receiverBalance: receiver.balance
  };
}

// PERSISTENCE: Background flush
async function flushDirtyData() {
  if (dirtyUsers.size === 0) return;

  const database = await connectDB();
  const collection = database.collection("users");

  const ops = [];
  const idsToClear = [];

  for (const userId of dirtyUsers) {
    const user = userCache.get(userId);
    if (!user) continue; // Should not happen

    ops.push({
      updateOne: {
        filter: { userId },
        update: {
          $set: {
            balance: user.balance,
            lastDaily: user.lastDaily,
            lastWork: user.lastWork
          }
        },
        upsert: true
      }
    });
    idsToClear.push(userId);
  }

  if (ops.length > 0) {
    // Clear dirty set BEFORE await to prevent blocking new updates?
    // No, if we clear before success, and write fails, we lose data state.
    // But if we clear after, and new update happened during await, we might miss it?
    // JS is single threaded event loop. While 'await bulkWrite' is paused, other code runs.
    // If 'updateBalance' runs, it adds to dirtyUsers.
    // So we should capture the list, verify write, then remove ONLY captured ids from dirty set.

    try {
      await collection.bulkWrite(ops);
      // Success: remove these IDs from dirtyUsers
      idsToClear.forEach(id => dirtyUsers.delete(id));
      console.log(`[Economy] Saved ${ops.length} users to DB.`);
    } catch (err) {
      console.error("[Economy] Failed to save dirty data:", err);
      // Leave them in dirtyUsers to try again next time
    }
  }
}

async function getLeaderboard(limit = 10) {
  // Leaderboard still hits DB because cache doesn't have everyone
  // TODO: optimization - minimal cache flush before reading leaderboard?
  await flushDirtyData();
  const database = await connectDB();
  const collection = database.collection("users");
  return collection.find().sort({ balance: -1 }).limit(limit).toArray();
}

// Flush interval: 60 seconds
setInterval(flushDirtyData, 60 * 1000);

// Flush on exit
process.on('SIGINT', async () => {
  console.log("Flushing economy data before exit...");
  await flushDirtyData();
  process.exit(0);
});

module.exports = {
  connectDB,
  getUser,
  getBalance,
  updateBalance,
  setBalance,
  claimDaily,
  performWork,
  transfer,
  getLeaderboard,
  formatCurrency,
  forceSave: flushDirtyData,
  DEFAULT_BALANCE
};
