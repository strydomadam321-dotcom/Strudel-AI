// ---- Elements ----
const authScreen = document.getElementById('authScreen');
const authForm = document.getElementById('authForm');
const authError = document.getElementById('authError');
const authSubmit = document.getElementById('authSubmit');
const authSwitchBtn = document.getElementById('authSwitchBtn');
const authSwitchText = document.getElementById('authSwitchText');
const displayNameField = document.getElementById('displayNameField');
const confirmPasswordField = document.getElementById('confirmPasswordField');
const authDisplayName = document.getElementById('authDisplayName');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const authConfirmPassword = document.getElementById('authConfirmPassword');

const app = document.getElementById('app');
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const menuBtn = document.getElementById('menuBtn');
const newChatBtn = document.getElementById('newChatBtn');
const conversationList = document.getElementById('conversationList');
const profileBtn = document.getElementById('profileBtn');
const avatarInitials = document.getElementById('avatarInitials');
const profileName = document.getElementById('profileName');

const log = document.getElementById('log');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const fileInput = document.getElementById('fileInput');
const attachBtn = document.getElementById('attachBtn');
const composerAttachments = document.getElementById('composerAttachments');
const stationButtons = document.querySelectorAll('.station');
const modelSelect = document.getElementById('modelSelect');

const settingsOverlay = document.getElementById('settingsOverlay');
const settingsClose = document.getElementById('settingsClose');

const claudeKeyOverlay = document.getElementById('claudeKeyOverlay');
const claudeKeyInput = document.getElementById('claudeKeyInput');
const claudeKeySubmit = document.getElementById('claudeKeySubmit');
const claudeKeyClose = document.getElementById('claudeKeyClose');
const toggleClaudeKeyVis = document.getElementById('toggleClaudeKeyVis');
const claudeKeyError = document.getElementById('claudeKeyError');
const settingsDisplayName = document.getElementById('settingsDisplayName');
const settingsUsername = document.getElementById('settingsUsername');
const settingsTheme = document.getElementById('settingsTheme');
const settingsClaudeKey = document.getElementById('settingsClaudeKey');
const toggleKeyVisibility = document.getElementById('toggleKeyVisibility');
const settingsSave = document.getElementById('settingsSave');
const settingsSavedMsg = document.getElementById('settingsSavedMsg');
const logoutBtn = document.getElementById('logoutBtn');

const ACCENT = { claude: '#c1622e', gemini: '#4653c9' };
const PROVIDER_NAME = { claude: 'Claude', gemini: 'Gemini' };

// ---- State ----
let authMode = 'login';
let authToken = null;
let currentUser = null;
let modelCatalog = { claude: [], gemini: [] };
let geminiServerReady = true;

let currentProvider = 'gemini';
let currentModel = null;
let currentConversationId = null;
let history = []; // { role: 'user' | 'assistant', content }
let conversations = []; // loaded from localStorage per-user
let claudeKey = '';
let pendingMessageForClaudeKey = null; // temp storage while waiting for key entry
let attachedFiles = []; // { id, name, mimeType, data (base64) }

// =========================================================
// Auth screen
// =========================================================
function setAuthMode(mode) {
  authMode = mode;
  displayNameField.style.display = mode === 'signup' ? '' : 'none';
  confirmPasswordField.style.display = mode === 'signup' ? '' : 'none';
  authSubmit.textContent = mode === 'signup' ? 'Sign up' : 'Log in';
  authSwitchText.textContent = mode === 'signup' ? 'Already have an account?' : "Don't have an account?";
  authSwitchBtn.textContent = mode === 'signup' ? 'Log in' : 'Sign up';
  authError.textContent = '';
}

authSwitchBtn.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';

  const username = authUsername.value.trim();
  const password = authPassword.value;

  if (authMode === 'signup' && password !== authConfirmPassword.value) {
    authError.textContent = "Passwords don't match.";
    return;
  }

  authSubmit.disabled = true;
  try {
    const endpoint = authMode === 'signup' ? '/api/signup' : '/api/login';
    const body =
      authMode === 'signup'
        ? { username, password, displayName: authDisplayName.value.trim() }
        : { username, password };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      authError.textContent = data.error || 'Something went wrong.';
      return;
    }

    localStorage.setItem('relay:token', data.token);
    authToken = data.token;
    authForm.reset();
    await initApp(data.user);
  } catch (err) {
    authError.textContent = 'Could not reach the server. Is it still running?';
  } finally {
    authSubmit.disabled = false;
  }
});

function showAuthScreen() {
  authScreen.hidden = false;
  app.hidden = true;
  settingsOverlay.hidden = true;
  setAuthMode('login');
}

// =========================================================
// Storage keys (scoped per logged-in username)
// =========================================================
function conversationsKey() {
  return `relay:conversations:${currentUser.username}`;
}
function claudeKeyStorageKey() {
  return `relay:claudeKey:${currentUser.username}`;
}

function loadConversations() {
  try {
    return JSON.parse(localStorage.getItem(conversationsKey())) || [];
  } catch {
    return [];
  }
}
function persistConversations() {
  localStorage.setItem(conversationsKey(), JSON.stringify(conversations));
}

// =========================================================
// App init (after login / on valid session)
// =========================================================
async function initApp(user) {
  currentUser = user;
  document.documentElement.setAttribute('data-theme', user.settings?.theme || 'light');

  currentProvider = user.settings?.defaultProvider || 'gemini';
  stationButtons.forEach((b) => b.classList.toggle('active', b.dataset.provider === currentProvider));
  document.documentElement.style.setProperty('--accent', ACCENT[currentProvider]);
  input.placeholder = `Message ${PROVIDER_NAME[currentProvider]}…`;

  claudeKey = localStorage.getItem(claudeKeyStorageKey()) || '';
  conversations = loadConversations();

  renderProfile();
  updateClaudeStationBadge();

  // Load model catalog + server status, then settle on a starting conversation.
  await Promise.all([loadModelCatalog(), loadStatus()]);

  const mostRecent = conversations.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (mostRecent) {
    loadConversation(mostRecent.id);
  } else {
    startNewChat();
  }

  renderSidebar();

  authScreen.hidden = true;
  app.hidden = false;
}

async function loadModelCatalog() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    modelCatalog = data.models || { claude: [], gemini: [] };
  } catch {
    modelCatalog = { claude: [], gemini: [] };
  }
  populateModelSelect(currentUser.settings?.defaultModel);
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    geminiServerReady = Boolean(data.gemini);
  } catch {
    geminiServerReady = true; // don't scare the user over a status-check hiccup
  }
}

function renderProfile() {
  const name = currentUser.displayName || currentUser.username;
  avatarInitials.textContent = getInitials(name);
  profileName.textContent = name;
}

function getInitials(name) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((w) => w[0].toUpperCase()).join('') || '?';
}

// =========================================================
// Provider / model selection
// =========================================================
stationButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    currentProvider = btn.dataset.provider;
    stationButtons.forEach((b) => b.classList.toggle('active', b === btn));
    document.documentElement.style.setProperty('--accent', ACCENT[currentProvider]);
    input.placeholder = `Message ${PROVIDER_NAME[currentProvider]}…`;
    populateModelSelect();
    if (history.length === 0) renderEmptyState();
  });
});

modelSelect.addEventListener('change', () => {
  currentModel = modelSelect.value;
});

function populateModelSelect(preferredId) {
  const models = modelCatalog[currentProvider] || [];
  modelSelect.innerHTML = '';

  if (models.length === 0) {
    modelSelect.innerHTML = '<option>No models loaded</option>';
    return;
  }

  models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelect.appendChild(opt);
  });

  const validPreferred = models.find((m) => m.id === preferredId);
  const recommended = models.find((m) => /recommended/i.test(m.label));
  currentModel = (validPreferred || recommended || models[0]).id;
  modelSelect.value = currentModel;
}

function updateClaudeStationBadge() {
  const claudeBtn = document.querySelector('.station--claude');
  let badge = claudeBtn.querySelector('.station-badge');
  if (!claudeKey) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'station-badge';
      badge.textContent = 'add key';
      claudeBtn.appendChild(badge);
    }
  } else if (badge) {
    badge.remove();
  }
}

// =========================================================
// Conversations (sidebar)
// =========================================================
function startNewChat() {
  currentConversationId = null;
  history = [];
  renderEmptyState();
  renderSidebar();
  closeSidebarOnMobile();
}
newChatBtn.addEventListener('click', () => {
  startNewChat();
  input.focus();
});

function loadConversation(id) {
  const conv = conversations.find((c) => c.id === id);
  if (!conv) return;

  currentConversationId = id;
  history = conv.messages.slice();
  currentProvider = conv.provider;

  stationButtons.forEach((b) => b.classList.toggle('active', b.dataset.provider === currentProvider));
  document.documentElement.style.setProperty('--accent', ACCENT[currentProvider]);
  input.placeholder = `Message ${PROVIDER_NAME[currentProvider]}…`;
  populateModelSelect(conv.model);

  log.innerHTML = '';
  if (history.length === 0) {
    renderEmptyState();
  } else {
    history.forEach((m) =>
      renderMessage({ role: m.role, content: m.content, provider: currentProvider, model: conv.model })
    );
    log.scrollTop = log.scrollHeight;
  }

  renderSidebar();
  closeSidebarOnMobile();
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n).trim() + '…' : str;
}

function saveCurrentConversation() {
  if (history.length === 0) return;
  const now = new Date().toISOString();

  if (!currentConversationId) {
    currentConversationId = 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const firstUserMsg = history.find((m) => m.role === 'user');
    const title = firstUserMsg ? truncate(firstUserMsg.content, 42) : 'New chat';
    conversations.unshift({
      id: currentConversationId,
      title,
      provider: currentProvider,
      model: currentModel,
      messages: history,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    const conv = conversations.find((c) => c.id === currentConversationId);
    if (conv) {
      conv.messages = history;
      conv.provider = currentProvider;
      conv.model = currentModel;
      conv.updatedAt = now;
    }
  }

  persistConversations();
  renderSidebar();
}

function renderSidebar() {
  conversationList.innerHTML = '';

  if (conversations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'conversation-empty';
    empty.textContent = 'No conversations yet.';
    conversationList.appendChild(empty);
    return;
  }

  const sorted = conversations.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  sorted.forEach((conv) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'conv-item' + (conv.id === currentConversationId ? ' active' : '');

    const title = document.createElement('span');
    title.className = 'conv-title';
    title.textContent = conv.title || 'New chat';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'conv-delete';
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Delete conversation');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this conversation? This can\'t be undone.')) return;
      conversations = conversations.filter((c) => c.id !== conv.id);
      persistConversations();
      if (conv.id === currentConversationId) startNewChat();
      renderSidebar();
    });

    item.appendChild(title);
    item.appendChild(del);
    item.addEventListener('click', () => loadConversation(conv.id));
    conversationList.appendChild(item);
  });
}

// =========================================================
// Mobile sidebar drawer
// =========================================================
menuBtn.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  sidebarBackdrop.classList.toggle('visible');
});
sidebarBackdrop.addEventListener('click', () => {
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('visible');
});
function closeSidebarOnMobile() {
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('visible');
}

// =========================================================
// Chat log rendering
// =========================================================
function getKeyHintText() {
  if (currentProvider === 'gemini') {
    return geminiServerReady
      ? 'Gemini is ready — say hello.'
      : "The site owner hasn't added a Gemini key on the server yet.";
  }
  return claudeKey
    ? 'Your Claude key is set — say hello.'
    : 'Add your own Claude API key in Settings (bottom-left) to use this station.';
}

function renderEmptyState() {
  log.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = `
    <p>Pick a station above, then send your first message.</p>
    <p class="empty-state-sub">${getKeyHintText()}</p>
  `;
  log.appendChild(el);
}

function renderMessage({ role, content, provider, model, pending, files }) {
  const el = document.createElement('div');
  el.className = `msg msg--${role === 'user' ? 'user' : role === 'error' ? 'error' : 'ai'}`;

  if (provider) el.style.setProperty('--accent', ACCENT[provider]);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent =
    role === 'user' ? 'You' : role === 'error' ? 'System' : `${PROVIDER_NAME[provider] || 'AI'} · ${model || ''}`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble' + (pending ? ' thinking' : '');
  bubble.textContent = content;

  el.appendChild(meta);
  el.appendChild(bubble);

  // Display attached files
  if (files && Array.isArray(files) && files.length > 0) {
    const filesDiv = document.createElement('div');
    filesDiv.className = 'msg-files';
    files.forEach((file) => {
      if (file.mimeType && file.mimeType.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = `data:${file.mimeType};base64,${file.data}`;
        img.alt = file.name;
        img.style.maxWidth = '300px';
        img.style.maxHeight = '300px';
        img.style.borderRadius = '8px';
        img.style.marginTop = '8px';
        filesDiv.appendChild(img);
      } else {
        const fileTag = document.createElement('div');
        fileTag.className = 'msg-file-tag';
        fileTag.textContent = `📎 ${file.name}`;
        filesDiv.appendChild(fileTag);
      }
    });
    el.appendChild(filesDiv);
  }

  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

// =========================================================
// Sending messages
// =========================================================
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});

// ---- File handling ----
function renderAttachedFiles() {
  composerAttachments.innerHTML = '';
  attachedFiles.forEach((file) => {
    const tag = document.createElement('div');
    tag.className = 'file-tag';
    tag.innerHTML = `
      <span>${file.name}</span>
      <span class="file-tag-remove" data-id="${file.id}">×</span>
    `;
    tag.querySelector('.file-tag-remove').addEventListener('click', () => {
      attachedFiles = attachedFiles.filter((f) => f.id !== file.id);
      renderAttachedFiles();
    });
    composerAttachments.appendChild(tag);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFiles(files) {
  for (const file of files) {
    // Skip if already attached
    if (attachedFiles.some((f) => f.name === file.name)) continue;

    try {
      const base64 = await fileToBase64(file);
      attachedFiles.push({
        id: Math.random().toString(36).substring(7),
        name: file.name,
        mimeType: file.type,
        data: base64,
      });
    } catch (err) {
      console.error('Error reading file:', err);
    }
  }
  renderAttachedFiles();
}

attachBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  handleFiles(Array.from(e.target.files));
  e.target.value = ''; // Reset so same file can be selected again
});

// Drag and drop
composer.addEventListener('dragover', (e) => {
  e.preventDefault();
  composer.style.opacity = '0.7';
});

composer.addEventListener('dragleave', () => {
  composer.style.opacity = '1';
});

composer.addEventListener('drop', (e) => {
  e.preventDefault();
  composer.style.opacity = '1';
  handleFiles(Array.from(e.dataTransfer.files));
});

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  if (currentProvider === 'claude' && !claudeKey) {
    pendingMessageForClaudeKey = text;
    claudeKeyInput.value = '';
    claudeKeyError.textContent = '';
    claudeKeyOverlay.removeAttribute('hidden');
    claudeKeyInput.focus();
    return;
  }

  if (log.querySelector('.empty-state')) log.innerHTML = '';
  renderMessage({ role: 'user', content: text, files: attachedFiles });
  history.push({ role: 'user', content: text, files: attachedFiles.map((f) => f.id) });

  input.value = '';
  input.style.height = 'auto';
  attachedFiles = [];
  renderAttachedFiles();
  sendBtn.disabled = true;

  const modelUsed = currentModel;
  const thinkingEl = renderMessage({
    role: 'assistant',
    content: 'thinking…',
    provider: currentProvider,
    model: modelUsed,
    pending: true,
  });

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        provider: currentProvider,
        model: modelUsed,
        messages: history,
        apiKey: currentProvider === 'claude' ? claudeKey : undefined,
        files: attachedFiles,
      }),
    });

    if (res.status === 401) {
      thinkingEl.remove();
      handleSessionExpired();
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      thinkingEl.remove();
      renderMessage({ role: 'error', content: data.error || 'Something went wrong.' });
    } else {
      thinkingEl.remove();
      renderMessage({ role: 'assistant', content: data.reply, provider: currentProvider, model: modelUsed });
      history.push({ role: 'assistant', content: data.reply });
      saveCurrentConversation();
    }
  } catch (err) {
    thinkingEl.remove();
    renderMessage({ role: 'error', content: 'Could not reach the server. Is it still running?' });
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
});

function handleSessionExpired() {
  localStorage.removeItem('relay:token');
  authToken = null;
  currentUser = null;
  showAuthScreen();
  authError.textContent = 'Your session expired — please log in again.';
}

// =========================================================
// Settings modal
// =========================================================
profileBtn.addEventListener('click', () => {
  settingsDisplayName.value = currentUser.displayName || '';
  settingsUsername.textContent = currentUser.username;
  settingsTheme.value = currentUser.settings?.theme || 'light';
  settingsClaudeKey.value = claudeKey;
  settingsClaudeKey.type = 'password';
  toggleKeyVisibility.textContent = 'show';
  settingsSavedMsg.textContent = '';
  settingsSavedMsg.classList.remove('error');
  settingsOverlay.hidden = false;
});

settingsClose.addEventListener('click', () => (settingsOverlay.hidden = true));
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.hidden = true;
});

// Claude key modal
claudeKeyClose.addEventListener('click', () => {
  claudeKeyOverlay.hidden = true;
  pendingMessageForClaudeKey = null;
  input.focus();
});

claudeKeyOverlay.addEventListener('click', (e) => {
  if (e.target === claudeKeyOverlay) {
    claudeKeyOverlay.hidden = true;
    pendingMessageForClaudeKey = null;
    input.focus();
  }
});

toggleClaudeKeyVis.addEventListener('click', () => {
  const showing = claudeKeyInput.type === 'text';
  claudeKeyInput.type = showing ? 'password' : 'text';
  toggleClaudeKeyVis.textContent = showing ? 'show' : 'hide';
});

claudeKeySubmit.addEventListener('click', async () => {
  const key = claudeKeyInput.value.trim();
  if (!key) {
    claudeKeyError.textContent = 'Please paste your API key.';
    return;
  }

  claudeKey = key;
  localStorage.setItem(claudeKeyStorageKey(), claudeKey);
  claudeKeyError.textContent = '';
  claudeKeyOverlay.hidden = true;

  // Send the pending message
  if (pendingMessageForClaudeKey) {
    const msg = pendingMessageForClaudeKey;
    pendingMessageForClaudeKey = null;
    input.value = msg;
    composer.requestSubmit();
  }
});

// Allow Enter key to submit Claude key
claudeKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') claudeKeySubmit.click();
});

toggleKeyVisibility.addEventListener('click', () => {
  const showing = settingsClaudeKey.type === 'text';
  settingsClaudeKey.type = showing ? 'password' : 'text';
  toggleKeyVisibility.textContent = showing ? 'show' : 'hide';
});

settingsSave.addEventListener('click', async () => {
  const newDisplayName = settingsDisplayName.value.trim();
  const newTheme = settingsTheme.value;
  const newClaudeKey = settingsClaudeKey.value.trim();

  // Claude key lives only in this browser — never sent for storage.
  claudeKey = newClaudeKey;
  localStorage.setItem(claudeKeyStorageKey(), claudeKey);
  updateClaudeStationBadge();
  if (history.length === 0) renderEmptyState();

  document.documentElement.setAttribute('data-theme', newTheme);

  settingsSave.disabled = true;
  try {
    const res = await fetch('/api/me', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ displayName: newDisplayName, settings: { theme: newTheme } }),
    });

    if (res.status === 401) {
      settingsOverlay.hidden = true;
      handleSessionExpired();
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      settingsSavedMsg.textContent = data.error || 'Could not save changes.';
      settingsSavedMsg.classList.add('error');
      return;
    }

    currentUser = data.user;
    renderProfile();
    settingsSavedMsg.classList.remove('error');
    settingsSavedMsg.textContent = 'Saved!';
    setTimeout(() => (settingsSavedMsg.textContent = ''), 2000);
  } catch {
    settingsSavedMsg.textContent = 'Could not reach the server.';
    settingsSavedMsg.classList.add('error');
  } finally {
    settingsSave.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    });
  } catch {
    // fine to ignore — we're logging out locally regardless
  }
  localStorage.removeItem('relay:token');
  authToken = null;
  currentUser = null;
  conversations = [];
  history = [];
  currentConversationId = null;
  settingsOverlay.hidden = true;
  showAuthScreen();
});

// =========================================================
// Boot: check for an existing session
// =========================================================
(async function checkSession() {
  const token = localStorage.getItem('relay:token');
  if (!token) {
    showAuthScreen();
    return;
  }

  try {
    const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('invalid session');
    const data = await res.json();
    authToken = token;
    await initApp(data.user);
  } catch {
    localStorage.removeItem('relay:token');
    showAuthScreen();
  }
})();
