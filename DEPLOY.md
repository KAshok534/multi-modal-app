# Deploying Chorus to Vercel

This app is a Node/Express server with a static frontend. It's wired for Vercel:
- `public/` is served as static files by Vercel's CDN.
- `api/index.js` runs the Express app as a serverless function; `vercel.json`
  rewrites every `/api/*` request to it.
- Keys come from **environment variables** in production (your `keys.txt` is
  git-ignored and never leaves your machine).

---

## ⚠️ Before you deploy — read this

A public URL with your keys means **anyone who finds it can spend your API
credits**. Two protections, both strongly recommended:

1. **Set a spending limit** on OpenRouter → <https://openrouter.ai/settings/credits>
   (credit limit / monthly cap). This is your hard backstop.
2. **Set `ACCESS_PASSWORD`** (step 4 below). The app then shows an unlock screen
   and rejects every API call without the password. Leave it unset = open to all.

Also: these keys were previously in PDFs that may have synced to cloud/email —
consider **rotating the OpenRouter key** at <https://openrouter.ai/keys>.

---

## Step 1 — Push the code to GitHub

From `C:\Multi Model` (PowerShell):

```powershell
git init
git add .
git commit -m "Chorus: multi-model chat, Vercel-ready"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`keys.txt`, `node_modules/`, and `.env` are git-ignored, so no secrets are pushed.
(If you've already created the repo, just add the remote and push.)

## Step 2 — Import into Vercel

1. <https://vercel.com/new> → **Import** your GitHub repo.
2. Framework Preset: **Other** (no build step needed).
3. Leave Build/Output settings empty. Click **Deploy** — it'll deploy, but
   models won't work yet because keys aren't set. Add them next, then redeploy.

## Step 3 — Add your keys as Environment Variables

Project → **Settings → Environment Variables**. Add at minimum:

| Name | Value |
|------|-------|
| `OPENROUTER_API_KEY` | the OpenRouter key from your `keys.txt` (the `sk-or-v1-…` value) |

Optionally add any of `DEEPSEEK_API_KEY`, `GROK_API_KEY`, `GROQ_API_KEY`,
`MISTRAL_API_KEY`, `QWEN_API_KEY`, `CEREBRAS_API_KEY`, `SAMBANOVA_API_KEY`,
`GEMINI_API_KEY` (see `.env.example`). Apply to **Production** (and Preview if
you want preview deploys to work).

## Step 4 — Lock it (recommended)

Add one more variable:

| Name | Value |
|------|-------|
| `ACCESS_PASSWORD` | a password you choose |

Now visitors must enter it once to use the app.

## Step 5 — Redeploy

Deployments → ⋯ → **Redeploy** (env-var changes need a new deploy). Open the
URL, enter your password if you set one, and start chatting.

---

## Local development

Nothing changes — keep using:

```powershell
npm install
npm start          # http://localhost:5173, reads keys.txt, no password
```

To mimic production locally, install the CLI and run `vercel dev` (it reads a
local `.env` you can create from `.env.example`).

## Good to know about serverless

- **Streaming** works; the chat function is capped at `maxDuration: 60s`
  (`vercel.json`). Responses are limited to `MAX_TOKENS = 1024` in `server.js`,
  which fits comfortably — raise it if you want longer replies and have credit.
- **Status checks** (`/api/health`) re-probe on a cold start since serverless
  instances don't share memory; the ↻ button forces a fresh sweep.
- Prefer a always-on server? This same code runs unchanged on **Render**,
  **Railway**, or **Fly.io** (Start command `npm start`, set the same env vars) —
  no serverless caveats.
