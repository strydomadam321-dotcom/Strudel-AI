// server.js
// The backend. It runs on your computer (or a host, later) and does three jobs:
//   1. Logs people in/out (accounts stored in data/users.json)
//   2. Uses YOUR Gemini key so Gemini works for everyone automatically
//   3. For Claude, forwards each person's OWN key straight to Anthropic —
//      your server never stores anyone else's Claude key.

require('dotenv').config();
const express = require('express');
const path = require('path');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Only Gemini uses a server-side key. Claude is "bring your own key" —
// see callClaude() below, which takes the key from the logged-in user instead.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// The models users can pick from in the dropdown. Add/remove entries here —
// the frontend reads this list automatically, nothing else to change.
const MODELS = {
  claude: [
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fastest & cheapest' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5 — balanced (recommended)' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8 — most capable' },
  ],
  gemini: [
    { id: 'gemini-3.1-flash-lite', label: 'Flash-Lite 3.1 — fastest & cheapest' },
    { id: 'gemini-3.5-flash', label: 'Flash 3.5 — balanced (recommended)' },
    { id: 'gemini-3.1-pro-preview', label: 'Pro 3.1 — most capable reasoning' },
  ],
};

const DEFAULT_MODEL = {
  claude: 'claude-sonnet-5',
  gemini: 'gemini-3.5-flash',
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Auth middleware: protects routes that shouldn't be free-for-all ----
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = auth.getUserByToken(token);

  if (!user) {
    return res.status(401).json({ error: 'Please log in again.' });
  }
  req.user = user;
  req.token = token;
  next();
}

// ---- Accounts ----
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, displayName } = req.body || {};
    const user = await auth.createUser(username, password, displayName);
    const token = auth.issueToken(user.id);
    res.json({ token, user: auth.publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = await auth.verifyUser(username, password);
    const token = auth.issueToken(user.id);
    res.json({ token, user: auth.publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/logout', requireAuth, (req, res) => {
  auth.revokeToken(req.token);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: auth.publicUser(req.user) });
});

app.put('/api/me', requireAuth, (req, res) => {
  try {
    const updated = auth.updateUser(req.user.id, req.body || {});
    res.json({ user: auth.publicUser(updated) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Status & models (no login needed — nothing sensitive here) ----
app.get('/api/status', (req, res) => {
  res.json({ gemini: Boolean(GEMINI_API_KEY) });
});

app.get('/api/models', (req, res) => {
  res.json({ models: MODELS, defaults: DEFAULT_MODEL });
});

// ---- Chat (must be logged in) ----
app.post('/api/chat', requireAuth, async (req, res) => {
  const { provider, messages, apiKey, files } = req.body;
  let { model } = req.body;

  if (!provider || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Request needs a "provider" and a non-empty "messages" array.' });
  }
  if (provider !== 'claude' && provider !== 'gemini') {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  // Guard against unexpected model ids — fall back to the provider's default.
  const validModelIds = MODELS[provider].map((m) => m.id);
  if (!model || !validModelIds.includes(model)) {
    model = DEFAULT_MODEL[provider];
  }

  try {
    let reply;

    if (provider === 'claude') {
      if (!apiKey || !apiKey.trim()) {
        return res.status(400).json({
          error: 'Add your own Claude API key in Settings to use Claude.',
        });
      }
      reply = await callClaude(messages, model, apiKey.trim(), files || []);
    } else {
      if (!GEMINI_API_KEY) {
        return res.status(400).json({
          error: 'No Gemini API key found on the server. Add GEMINI_API_KEY to your .env file and restart.',
        });
      }
      reply = await callGemini(messages, model, files || []);
    }

    res.json({ reply, model });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong talking to the AI provider.' });
  }
});

// --- Claude — uses whichever key the browser sent for THIS request only.
// It's never written to disk on the server. ---
async function callClaude(messages, model, apiKey, files = []) {
  // Transform messages to include file content
  const transformedMessages = messages.map((m) => {
    const content = [];
    
    // Add text content
    if (m.content) {
      content.push({ type: 'text', text: m.content });
    }
    
    // Add file content (files attached to this message)
    if (m.files && Array.isArray(m.files)) {
      m.files.forEach((fileId) => {
        const file = files.find((f) => f.id === fileId);
        if (file) {
          if (file.mimeType.startsWith('image/')) {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: file.mimeType,
                data: file.data,
              },
            });
          } else if (file.mimeType === 'application/pdf') {
            content.push({
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: file.data,
              },
            });
          }
        }
      });
    }
    
    return { role: m.role, content };
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: transformedMessages,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Claude API request failed.');
  }
  return data.content?.[0]?.text || '(empty response)';
}

// --- Gemini — always uses the server's own key. ---
async function callGemini(messages, model, files = []) {
  // Gemini uses "user" / "model" instead of "user" / "assistant".
  const contents = messages.map((m) => {
    const parts = [];
    
    // Add text content
    if (m.content) {
      parts.push({ text: m.content });
    }
    
    // Add file content (files attached to this message)
    if (m.files && Array.isArray(m.files)) {
      m.files.forEach((fileId) => {
        const file = files.find((f) => f.id === fileId);
        if (file) {
          if (file.mimeType.startsWith('image/')) {
            parts.push({
              inline_data: {
                mime_type: file.mimeType,
                data: file.data,
              },
            });
          }
          // Note: Gemini has limited document support in the free tier, so we skip PDFs for now
        }
      });
    }
    
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({ contents }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Gemini API request failed.');
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '(empty response)';
}

app.listen(PORT, () => {
  console.log(`\n✅ AI chatbox running — open http://localhost:${PORT} in your browser\n`);
});
