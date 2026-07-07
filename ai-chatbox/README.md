# Relay — a chatbox that talks to Claude or Gemini

A small website where people can sign up for their own account, chat with
Claude or Gemini, and see their past conversations in a sidebar — like a
mini version of a real AI chat app.

```
ai-chatbox/
├── server.js          the backend — accounts, chat routing, keeps keys secret
├── auth.js             account/login helper functions
├── package.json         lists the libraries the server needs
├── .env.example          template for your Gemini key
├── data/                 created automatically — holds accounts (users.json)
└── public/
    ├── index.html         page structure (login screen, sidebar, chat, settings)
    ├── style.css           the look, including dark mode
    └── script.js           all the browser-side behavior
```

## How the two AI models are set up

This is important to understand, since it's different from a normal setup:

- **Gemini** uses *your* key (in `.env`, below). It works immediately for
  anyone who signs up — no setup on their end.
- **Claude** uses *their own* key. After signing in, each person pastes
  their personal Anthropic API key into **Settings**. It's stored only in
  their own browser and sent straight to Anthropic on their own requests —
  your server never stores anyone else's Claude key, and you never pay for
  their Claude usage.

## 1. Install Node.js

If you don't already have it: go to [nodejs.org](https://nodejs.org), download
the **LTS** version, and run the installer. Check it worked with:

```
node -v
```

## 2. Open the project folder in a terminal

```
cd path/to/ai-chatbox
```

## 3. Install dependencies

```
npm install
```

## 4. Add your Gemini key

```
cp .env.example .env
```

(Windows: `copy .env.example .env`)

Open `.env` in a text editor and paste in your Gemini key:

```
GEMINI_API_KEY=AIza...
```

Get one free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
Nothing else goes in this file — Claude keys are added per-person, inside the app.

## 5. Run it

```
npm start
```

Open `http://localhost:3000`. You'll land on a login screen — click
**Sign up** to create the first account.

## Using it

- **Sidebar**: `+ New chat` starts a fresh conversation. Past conversations
  are listed below it — click one to reopen it, or the `✕` to delete it.
  These are stored in *your own browser*, so they won't show up if you log
  into the same account from a different device or browser.
- **Station toggle** (top of the chat): switch between Claude and Gemini
  per-message. The model dropdown next to it picks which specific version
  (fast/cheap vs. most capable) within that provider.
- **Profile / Settings** (bottom-left): change your display name, switch
  light/dark theme, add your Claude API key, or log out.

## Changing the model lineup

Near the top of `server.js`:

```js
const MODELS = {
  claude: [ /* ... */ ],
  gemini: [ /* ... */ ],
};
```

Add, remove, or relabel entries here — the dropdown in the app updates
automatically, nothing else to change.

## A few honest limitations, so nothing surprises you

- Conversations live in the browser, not a database — clearing your
  browser's site data will erase them.
- Accounts are basic (username + password, no "forgot password" flow yet).
  Fine for personal/friends-and-family use; not built for the general public.
- Everyone shares your Gemini quota/cost. If you ever want per-person limits,
  that's a reasonable next feature to add.

## Putting it online

Right now this only runs on your computer. To give it a real web address,
here's the beginner-friendliest path:

**[Railway](https://railway.app)** is a good fit for this project — it
connects to a GitHub repo, deploys automatically, and (unlike some free
hosts) supports a small persistent storage volume cheaply, which this app
needs to keep `data/users.json` (your accounts) from disappearing every time
you redeploy.

Rough steps, whenever you're ready:
1. Put this project in a GitHub repository (a private one is fine).
2. Create a Railway account and "New Project" → "Deploy from GitHub repo".
3. In Railway's dashboard, add an environment variable: `GEMINI_API_KEY`
   with your key.
4. Add a small **volume** in Railway and mount it at `/app/data` so accounts
   survive redeploys.
5. Railway gives you a public URL once it deploys — that's what you share.

**Render** is another common option and has a genuinely free tier, but its
free web services don't reliably keep files between deploys/restarts, so
accounts could reset unexpectedly unless you're on a paid plan with a
persistent disk. Worth knowing before you pick one.

Happy to walk through whichever host you pick, step by step, when you get there.
