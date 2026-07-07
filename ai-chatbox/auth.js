// auth.js
// Handles user accounts: signup, login, and "remember me" tokens.
// Everything lives in one JSON file (data/users.json) — no database to install.
// Good enough for a personal/small-group app; not built for thousands of users.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { users: [], tokens: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { users: [], tokens: {} };
  }
}

function saveData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function findUserByUsername(data, username) {
  return data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
}

// Everyone starts on Gemini, since it works immediately with no setup.
// Claude needs a personal key added in Settings first.
function defaultSettings() {
  return {
    defaultProvider: 'gemini',
    defaultModel: 'gemini-3.5-flash',
    theme: 'light',
  };
}

async function createUser(username, password, displayName) {
  const data = loadData();

  username = (username || '').trim();
  password = password || '';

  if (username.length < 3) throw new Error('Username needs to be at least 3 characters.');
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new Error('Username can only have letters, numbers, _ . and -');
  if (password.length < 6) throw new Error('Password needs to be at least 6 characters.');
  if (findUserByUsername(data, username)) throw new Error('That username is already taken.');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: crypto.randomUUID(),
    username,
    passwordHash,
    displayName: (displayName || username).trim().slice(0, 60),
    createdAt: new Date().toISOString(),
    settings: defaultSettings(),
  };

  data.users.push(user);
  saveData(data);
  return user;
}

async function verifyUser(username, password) {
  const data = loadData();
  const user = findUserByUsername(data, username || '');
  if (!user) throw new Error('Incorrect username or password.');

  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) throw new Error('Incorrect username or password.');

  return user;
}

function issueToken(userId) {
  const data = loadData();
  const token = crypto.randomBytes(32).toString('hex');
  data.tokens[token] = { userId, createdAt: new Date().toISOString() };
  saveData(data);
  return token;
}

function revokeToken(token) {
  const data = loadData();
  delete data.tokens[token];
  saveData(data);
}

function getUserByToken(token) {
  if (!token) return null;
  const data = loadData();
  const entry = data.tokens[token];
  if (!entry) return null;
  return data.users.find((u) => u.id === entry.userId) || null;
}

function updateUser(userId, updates) {
  const data = loadData();
  const user = data.users.find((u) => u.id === userId);
  if (!user) throw new Error('User not found.');

  if (updates.displayName !== undefined) {
    user.displayName = String(updates.displayName).trim().slice(0, 60) || user.username;
  }
  if (updates.settings) {
    user.settings = { ...user.settings, ...updates.settings };
  }

  saveData(data);
  return user;
}

// Strips the password hash before sending a user object to the browser.
function publicUser(user) {
  if (!user) return null;
  const { id, username, displayName, settings } = user;
  return { id, username, displayName, settings };
}

module.exports = {
  createUser,
  verifyUser,
  issueToken,
  revokeToken,
  getUserByToken,
  updateUser,
  publicUser,
};
