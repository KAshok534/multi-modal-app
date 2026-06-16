# Chorus — Multi-Model Console

A distinctive, production-grade web interface that talks to many AI models
through your own provider API keys. Keys live **only on the server**
(in `keys.txt`) and are never sent to the browser.

Design: "mission control" aesthetic — OLED-dark with a signal-green accent,
IBM Plex Sans + JetBrains Mono, gradient-mesh + grain background.

## Features

- 🟢 **Live model status** — every model is probed and shown as **Online**,
  **Needs credit**, or **Offline** with the reason, so you know what will work
  *before* you send (status dots in the picker + a count board in the sidebar)
- ⚠️ **In-chat banner** when a non-online model is selected, explaining why it
  may fail (e.g. "needs more credit") instead of a cryptic error
- 💬 Streaming responses (token-by-token), with **Stop** mid-generation
- 🔀 Custom model picker grouped by provider, with one-click "online" chips
- 🗂️ Multiple sessions, saved in your browser (localStorage), auto-titled, delete
- ✍️ Markdown rendering with terminal-dark, syntax-highlighted code + per-block **Copy**
- 🔁 **Regenerate** and **Copy** on any answer
- ⚙️ Settings: custom **system prompt** and **temperature**
- 🌓 Dark / light theme, responsive (mobile sidebar overlay), reduced-motion aware

## Run it

```powershell
cd "C:\Multi Model"
npm install
npm start
```

Then open <http://localhost:5173>. (Set a different port with `$env:PORT=8080; npm start`.)

## How keys work

All keys are read from `keys.txt` (format `provider | key | base_url`, one per
line). That file is git-ignored. To rotate a key, edit `keys.txt` and restart.

## Live status & the token cap

The app doesn't guess — it calls `/api/health`, which sends a tiny request to
every model and categorises the result (Online / Needs credit / Offline). The
sidebar shows live counts; the picker shows a status dot per model. Results are
cached ~10 min; the ↻ button forces a re-check.

To keep status **honest**, the probe reserves the same token budget as a real
chat (`MAX_TOKENS = 1024` in `server.js`). This matters: OpenRouter checks your
balance against that reservation, so a model only shows "Online" if it can
actually afford to answer. A useful side effect — capping responses at 1024
tokens makes the **premium** models affordable on this account, so they work
today instead of erroring. Raise `MAX_TOKENS` for longer replies (premium
models may then need credit).

## Status of the bundled keys (checked June 2026)

Consolidated from the four source files. **OpenRouter is the only working
provider** — it's the universal gateway, so the app routes through it.

| Provider | Result |
|---|---|
| **OpenRouter** | ✅ **Live** — powers the app |
| DeepSeek, Grok, Groq, Mistral, Qwen, Gemini, Cerebras, SambaNova (direct) | ❌ Key invalid / no balance / no access |

Within OpenRouter (with the 1024-token cap), the live sweep currently finds:

- ✅ **Online:** GPT-4o mini, Gemini 2.5 Flash Lite, Llama 3.3 70B, DeepSeek V3.1,
  Qwen 2.5 72B, **Claude Opus 4.8, Claude Sonnet 4.6, GPT-4.1, DeepSeek R1,
  Mistral Large, Grok 4.3** — all verified streaming live
- 💳 **Needs credit:** GPT-5.5 and other top-tier models — top up at
  <https://openrouter.ai/credits>

The direct providers are still wired in; fix a key in `keys.txt` (or add
balance) and its models go Online on the next status check — no code change.

## Project layout

```
keys.txt        # your API keys (private, git-ignored)
server.js       # Express: model catalog, /api/health status sweep, streaming proxy
public/
  index.html    # app shell
  styles.css    # mission-control design system (themes, layout, animation)
  app.js        # chat UI, custom picker, status logic, SSE streaming client
```

## Security notes

- `keys.txt`, `.env`, and `node_modules/` are in `.gitignore` — don't commit keys.
- The server proxies requests so the browser never sees your keys.
- This is a local dev server (no auth). Don't expose it to the public internet.
