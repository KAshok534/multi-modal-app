// Multi-Model Chat — backend
// Holds API keys server-side, exposes a model catalog, and proxies streaming
// chat completions to each provider. Keys are NEVER sent to the browser.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;

// Token budget reserved per request. Used for BOTH the live chat and the health
// probe so a model's status reflects what will actually happen when you send
// (OpenRouter reserves credit against this, so premium models that can't afford
// it report "needs credit" rather than falsely showing "online").
const MAX_TOKENS = 1024;

// ---------------------------------------------------------------------------
// Load keys. Two sources, merged (env wins):
//   1) keys.txt  ( provider | key | baseUrl )   — for local dev
//   2) env vars  ( OPENROUTER_API_KEY, DEEPSEEK_API_KEY, … )  — for Vercel/prod
// keys.txt is git-ignored and absent in production, so deployments rely on env.
// ---------------------------------------------------------------------------
function loadKeys(providerIds) {
  const keys = {};
  const file = path.join(__dirname, "keys.txt");
  if (fs.existsSync(file)) {
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length < 2) continue;
      const [provider, key, baseUrl] = parts;
      if (!provider || !key) continue;
      keys[provider.toLowerCase()] = { key, baseUrl: baseUrl || "" };
    }
  }
  for (const id of providerIds) {
    const envKey = process.env[`${id.toUpperCase()}_API_KEY`];
    if (envKey) keys[id] = { key: envKey, baseUrl: keys[id]?.baseUrl || "" };
  }
  if (!Object.keys(keys).length) console.warn("⚠  No keys found (keys.txt or *_API_KEY env vars).");
  return keys;
}

// ---------------------------------------------------------------------------
// Provider definitions
//   kind: "openai"  -> OpenAI-compatible /chat/completions + SSE
//         "gemini"  -> Google Generative Language streamGenerateContent
// ---------------------------------------------------------------------------
// Connection details per provider id (credentials come from keys.txt).
const PROVIDERS = {
  openrouter: { label: "OpenRouter", kind: "openai", base: "https://openrouter.ai/api/v1" },
  deepseek:   { label: "DeepSeek (Direct)", kind: "openai", base: "https://api.deepseek.com/v1" },
  grok:       { label: "Grok / xAI (Direct)", kind: "openai", base: "https://api.x.ai/v1" },
  groq:       { label: "Groq (Direct)", kind: "openai", base: "https://api.groq.com/openai/v1" },
  mistral:    { label: "Mistral (Direct)", kind: "openai", base: "https://api.mistral.ai/v1" },
  qwen:       { label: "Qwen / Alibaba (Direct)", kind: "openai", base: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  cerebras:   { label: "Cerebras (Direct)", kind: "openai", base: "https://api.cerebras.ai/v1" },
  sambanova:  { label: "SambaNova (Direct)", kind: "openai", base: "https://api.sambanova.ai/v1" },
  gemini:     { label: "Google Gemini (Direct)", kind: "gemini", base: "https://generativelanguage.googleapis.com/v1beta" },
};

const KEYS = loadKeys(Object.keys(PROVIDERS));

// Display groups for the model picker. Each group names a provider (for routing)
// plus a human label. Verified working (June 2026) with the bundled keys are the
// five models in the first group; the rest need OpenRouter credit or a valid
// direct-provider key (see README).
const CATALOG = [
  {
    provider: "openrouter",
    label: "Available now",
    models: [
      { id: "openai/gpt-4o-mini", name: "GPT-4o mini", vision: true },
      { id: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", vision: true },
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
      { id: "deepseek/deepseek-chat-v3.1", name: "DeepSeek V3.1" },
      { id: "qwen/qwen-2.5-72b-instruct", name: "Qwen 2.5 72B" },
    ],
  },
  {
    provider: "openrouter",
    label: "Premium — needs OpenRouter credit",
    models: [
      { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8", vision: true },
      { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", vision: true },
      { id: "openai/gpt-5.5", name: "GPT-5.5", vision: true },
      { id: "openai/gpt-4.1", name: "GPT-4.1", vision: true },
      { id: "deepseek/deepseek-r1-0528", name: "DeepSeek R1" },
      { id: "mistralai/mistral-large", name: "Mistral Large" },
      { id: "x-ai/grok-4.3", name: "Grok 4.3", vision: true },
    ],
  },
  {
    provider: "deepseek",
    label: "DeepSeek (Direct key)",
    models: [
      { id: "deepseek-chat", name: "DeepSeek V3" },
      { id: "deepseek-reasoner", name: "DeepSeek R1" },
    ],
  },
  {
    provider: "grok",
    label: "Grok / xAI (Direct key)",
    models: [
      { id: "grok-3", name: "Grok 3" },
      { id: "grok-3-mini", name: "Grok 3 Mini" },
      { id: "grok-2-latest", name: "Grok 2" },
    ],
  },
  {
    provider: "groq",
    label: "Groq (Direct key)",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
      { id: "gemma2-9b-it", name: "Gemma 2 9B" },
    ],
  },
  {
    provider: "mistral",
    label: "Mistral (Direct key)",
    models: [
      { id: "mistral-large-latest", name: "Mistral Large" },
      { id: "mistral-small-latest", name: "Mistral Small" },
      { id: "codestral-latest", name: "Codestral" },
    ],
  },
  {
    provider: "qwen",
    label: "Qwen / Alibaba (Direct key)",
    models: [
      { id: "qwen-plus", name: "Qwen Plus" },
      { id: "qwen-turbo", name: "Qwen Turbo" },
      { id: "qwen-max", name: "Qwen Max" },
    ],
  },
  {
    provider: "cerebras",
    label: "Cerebras (Direct key)",
    models: [
      { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
      { id: "llama3.1-8b", name: "Llama 3.1 8B" },
    ],
  },
  {
    provider: "sambanova",
    label: "SambaNova (Direct key)",
    models: [
      { id: "Meta-Llama-3.3-70B-Instruct", name: "Llama 3.3 70B" },
      { id: "Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B" },
    ],
  },
  {
    provider: "gemini",
    label: "Google Gemini (Direct key)",
    models: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", vision: true },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", vision: true },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", vision: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "20mb" })); // headroom for base64 image attachments
app.use(express.static(path.join(__dirname, "public")));

// Optional shared-password gate. Activates ONLY when ACCESS_PASSWORD is set
// (e.g. as a Vercel env var). Protects every /api route so a public URL can't
// be used to spend your API credits. The browser supplies it via a header.
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || "";
app.use("/api", (req, res, next) => {
  if (!ACCESS_PASSWORD) return next();
  const supplied = req.get("x-access-password") || req.query.pw || "";
  if (supplied === ACCESS_PASSWORD) return next();
  return res.status(401).json({ error: "Locked — enter the access password.", gate: true });
});

// Catalog of configured providers + their models (no keys exposed).
app.get("/api/models", (_req, res) => {
  const groups = CATALOG
    .filter((g) => KEYS[g.provider]) // only providers we have a key for
    .map((g) => ({ provider: g.provider, label: g.label, kind: PROVIDERS[g.provider]?.kind, models: g.models }));
  res.json({ groups });
});

// ---------------------------------------------------------------------------
// Live status — probe every model with a 1-token request and categorise the
// result so the UI can show online / needs-credit / offline, with a reason.
// Cached in memory; ?refresh=1 forces a fresh sweep.
// ---------------------------------------------------------------------------
let healthCache = null; // { checkedAt, models: { "provider::id": {status, message} } }
let healthInFlight = null;
const HEALTH_TTL_MS = 10 * 60 * 1000;

app.get("/api/health", async (req, res) => {
  const fresh = req.query.refresh === "1";
  if (!fresh && healthCache && Date.now() - healthCache.checkedAt < HEALTH_TTL_MS) {
    return res.json(healthCache);
  }
  if (healthInFlight) return res.json(await healthInFlight);
  healthInFlight = sweepHealth().finally(() => (healthInFlight = null));
  res.json(await healthInFlight);
});

async function sweepHealth() {
  const jobs = [];
  for (const group of CATALOG) {
    if (!KEYS[group.provider]) continue;
    for (const m of group.models) {
      jobs.push(
        probeModel(group.provider, m.id).then((r) => [`${group.provider}::${m.id}`, r])
      );
    }
  }
  const entries = await Promise.all(jobs);
  healthCache = { checkedAt: Date.now(), models: Object.fromEntries(entries) };
  return healthCache;
}

// One non-streaming, 1-token request. Returns {status, message}.
async function probeModel(provider, model) {
  const def = PROVIDERS[provider];
  const cred = KEYS[provider];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    let resp;
    if (def.kind === "gemini") {
      const url = `${(cred.baseUrl || def.base)}/models/${model}:generateContent?key=${encodeURIComponent(cred.key)}`;
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { maxOutputTokens: MAX_TOKENS } }),
        signal: controller.signal,
      });
    } else {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${cred.key}` };
      if (def.base.includes("openrouter")) { headers["HTTP-Referer"] = "http://localhost"; headers["X-Title"] = "Chorus"; }
      resp = await fetch(`${(cred.baseUrl || def.base)}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: MAX_TOKENS, stream: false }),
        signal: controller.signal,
      });
    }
    if (resp.ok) return { status: "online", message: "Online" };
    const body = (await safeText(resp)).toLowerCase();
    return categorise(resp.status, body);
  } catch (err) {
    if (err.name === "AbortError") return { status: "error", message: "Timed out" };
    return { status: "error", message: "Network error" };
  } finally {
    clearTimeout(timer);
  }
}

function categorise(code, body) {
  if (code === 402 || body.includes("insufficient") || body.includes("more credit") || body.includes("requires more")) {
    return { status: "needs_credit", message: "Needs more credit on this account" };
  }
  if (code === 401 || body.includes("invalid api key") || body.includes("incorrect api key") || body.includes("unauthorized")) {
    return { status: "offline", message: "API key invalid for this provider" };
  }
  if (code === 403 || body.includes("permission") || body.includes("forbidden")) {
    return { status: "offline", message: "Key lacks access / permission" };
  }
  if (code === 404 || code === 410 || body.includes("does not exist") || body.includes("not available") || body.includes("unavailable")) {
    return { status: "offline", message: "Model not available for this key" };
  }
  if (code === 429 || body.includes("rate")) {
    return { status: "rate_limited", message: "Rate-limited — try again shortly" };
  }
  return { status: "error", message: `Provider error (${code})` };
}

// Streaming chat endpoint.
app.post("/api/chat", async (req, res) => {
  const { provider, model, messages, temperature = 0.7, systemPrompt } = req.body || {};
  const def = PROVIDERS[provider];
  const cred = KEYS[provider];

  if (!def || !cred) {
    return res.status(400).json({ error: `Provider "${provider}" is not configured.` });
  }
  if (!model || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Missing model or messages." });
  }

  // SSE headers to the browser
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // don't let a proxy buffer the stream (Vercel/nginx)
  res.flushHeaders?.();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Abort upstream only if the client disconnects before we're done.
  // (Note: listen on `res`, not `req` — the request stream emits "close"
  //  as soon as its body is read, which would abort us prematurely.)
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    if (def.kind === "gemini") {
      await streamGemini({ def, cred, model, messages, systemPrompt, temperature, send, signal: controller.signal });
    } else {
      await streamOpenAI({ def, cred, model, messages, systemPrompt, temperature, send, signal: controller.signal });
    }
    send("done", {});
  } catch (err) {
    if (controller.signal.aborted) {
      // client went away; nothing to report
    } else {
      console.error(`[${provider}/${model}]`, err.message);
      send("error", { message: err.message || "Upstream request failed." });
    }
  } finally {
    res.end();
  }
});

// --- OpenAI-compatible streaming -------------------------------------------
async function streamOpenAI({ def, cred, model, messages, systemPrompt, temperature, send, signal }) {
  const base = cred.baseUrl || def.base;
  const finalMessages = [];
  if (systemPrompt && systemPrompt.trim()) {
    finalMessages.push({ role: "system", content: systemPrompt.trim() });
  }
  finalMessages.push(...messages);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cred.key}`,
  };
  // OpenRouter likes these attribution headers.
  if (def.base.includes("openrouter")) {
    headers["HTTP-Referer"] = "http://localhost";
    headers["X-Title"] = "Chorus";
  }

  const resp = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: finalMessages, temperature, max_tokens: MAX_TOKENS, stream: true }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const text = await safeText(resp);
    throw new Error(`${resp.status} ${resp.statusText}${text ? " — " + text : ""}`);
  }

  await pumpSSE(resp.body, (data) => {
    if (data === "[DONE]") return;
    let json;
    try { json = JSON.parse(data); } catch { return; }
    const delta = json.choices?.[0]?.delta;
    if (delta?.content) send("delta", { text: delta.content });
    // Some reasoning models stream a separate reasoning field.
    if (delta?.reasoning) send("delta", { text: delta.reasoning });
  });
}

// --- Gemini streaming ------------------------------------------------------
async function streamGemini({ def, cred, model, messages, systemPrompt, temperature, send, signal }) {
  const base = cred.baseUrl || def.base;
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: toGeminiParts(m.content),
  }));

  const body = { contents, generationConfig: { temperature, maxOutputTokens: MAX_TOKENS } };
  if (systemPrompt && systemPrompt.trim()) {
    body.systemInstruction = { parts: [{ text: systemPrompt.trim() }] };
  }

  const url = `${base}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cred.key)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const text = await safeText(resp);
    throw new Error(`${resp.status} ${resp.statusText}${text ? " — " + text : ""}`);
  }

  await pumpSSE(resp.body, (data) => {
    let json;
    try { json = JSON.parse(data); } catch { return; }
    const parts = json.candidates?.[0]?.content?.parts;
    if (parts) for (const p of parts) if (p.text) send("delta", { text: p.text });
  });
}

// --- Helpers ---------------------------------------------------------------
// Parse an SSE byte stream and hand each `data:` payload to onData.
async function pumpSSE(stream, onData) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith("data:")) onData(line.slice(5).trim());
    }
  }
}

// Convert OpenAI-style message content (string OR [{type:text}, {type:image_url}])
// into Gemini "parts" so vision works on the direct Gemini route too.
function toGeminiParts(content) {
  if (typeof content === "string") return [{ text: content }];
  const parts = [];
  for (const p of content || []) {
    if (p.type === "text") parts.push({ text: p.text });
    else if (p.type === "image_url") {
      const m = (p.image_url?.url || "").match(/^data:(.+?);base64,(.*)$/);
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
  }
  return parts.length ? parts : [{ text: "" }];
}

async function safeText(resp) {
  try {
    const t = await resp.text();
    return t.slice(0, 500);
  } catch {
    return "";
  }
}

// Run a persistent server locally; on Vercel the app is imported as a handler.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    const configured = Object.keys(PROVIDERS).filter((p) => KEYS[p]);
    console.log(`\n  Chorus running at  http://localhost:${PORT}`);
    console.log(`  Providers configured: ${configured.join(", ") || "(none — check keys.txt / env vars)"}\n`);
  });
}

export default app;
