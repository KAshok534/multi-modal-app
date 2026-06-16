// Chorus — Multi-Model Console (frontend)
"use strict";

marked.setOptions({
  breaks: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) { try { return hljs.highlight(code, { language: lang }).value; } catch {} }
    try { return hljs.highlightAuto(code).value; } catch {}
    return code;
  },
});

// ---------- Status metadata ----------
const STATUS = {
  online:       { label: "Online",        dot: "online" },
  needs_credit: { label: "Needs credit",  dot: "needs_credit" },
  offline:      { label: "Offline",       dot: "offline" },
  rate_limited: { label: "Rate-limited",  dot: "rate_limited" },
  error:        { label: "Error",         dot: "error" },
  unknown:      { label: "Checking…",     dot: "unknown" },
};
function bannerFor(status, msg, name) {
  const base = { needs_credit: `<b>${name}</b> needs more credit on this account. You can still send, but it will likely fail. <a href="https://openrouter.ai/credits" target="_blank" rel="noopener">Add OpenRouter credit →</a>`,
    offline: `<b>${name}</b> is offline — ${msg}. Pick an <b>Online</b> model, or fix this key in <code>keys.txt</code>.`,
    rate_limited: `<b>${name}</b> is rate-limited right now — ${msg}.`,
    error: `<b>${name}</b> isn't responding — ${msg}.`,
    unknown: `Checking <b>${name}</b>…` };
  return base[status] || "";
}

// ---------- State ----------
const LS_CHATS = "chorus.chats", LS_SETTINGS = "chorus.settings", LS_THEME = "chorus.theme", LS_MODEL = "chorus.model";
let chats = load(LS_CHATS, []);
let settings = load(LS_SETTINGS, { systemPrompt: "", temperature: 0.7 });
let currentId = null;
let catalog = [];
let health = { models: {} };
let selectedValue = localStorage.getItem(LS_MODEL) || null;
let abortCtrl = null;

// ---------- DOM ----------
const $ = (s) => document.querySelector(s);
const messagesEl = $("#messages"), chatListEl = $("#chat-list"), inputEl = $("#input");
const sendBtn = $("#send-btn"), stopBtn = $("#stop-btn");
const picker = $("#picker"), pickerTrigger = $("#picker-trigger"), pickerPanel = $("#picker-panel");
const banner = $("#model-banner");
const welcomeTemplate = $("#welcome").cloneNode(true);

const LS_PW = "chorus.pw";

// ---------- Auth (optional shared-password gate) ----------
function authHeaders(extra = {}) {
  const pw = localStorage.getItem(LS_PW);
  return pw ? { ...extra, "X-Access-Password": pw } : extra;
}

// ---------- Init ----------
init();
function init() {
  applyTheme(localStorage.getItem(LS_THEME) || "dark");
  wireEvents();
  wireUnlock();
  boot();
}

async function boot() {
  const ok = await loadCatalog();
  if (!ok) return; // gated — unlock screen is showing
  renderChatList();
  if (chats.length) openChat(chats[0].id); else newChat();
  applyResponsive();
  refreshHealth(); // async, updates dots when ready
}

const NARROW = () => window.matchMedia("(max-width: 760px)").matches;
function applyResponsive() { if (NARROW()) toggleSidebar(true); }

// Returns false if the server is locked (and shows the unlock screen).
async function loadCatalog() {
  try {
    const res = await fetch("/api/models", { headers: authHeaders() });
    if (res.status === 401) { showUnlock(); return false; }
    catalog = (await res.json()).groups || [];
  } catch { catalog = []; }
  hideUnlock();
  const all = catalog.flatMap((g) => g.models.map((m) => `${g.provider}::${m.id}`));
  if (!selectedValue || !all.includes(selectedValue)) selectedValue = all[0] || null;
  renderPicker(); updateTrigger(); updateBanner();
  return true;
}

function showUnlock() { $("#unlock").classList.remove("hidden"); $("#unlock-input").focus(); }
function hideUnlock() { $("#unlock").classList.add("hidden"); }
function wireUnlock() {
  $("#unlock-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const pw = $("#unlock-input").value.trim();
    if (!pw) return;
    localStorage.setItem(LS_PW, pw);
    $("#unlock-error").classList.add("hidden");
    boot().then((/* boot returns undefined; loadCatalog handled gate */) => {
      // If still locked, the password was wrong — surface it.
      if (!$("#unlock").classList.contains("hidden")) {
        $("#unlock-error").classList.remove("hidden");
        localStorage.removeItem(LS_PW);
      }
    });
  });
}

async function refreshHealth(force) {
  const btn = $("#refresh-status"); btn?.classList.add("spin");
  try {
    health = await (await fetch("/api/health" + (force ? "?refresh=1" : ""), { headers: authHeaders() })).json();
  } catch { /* keep prior */ }
  renderPicker(); updateTrigger(); updateBanner(); updateStatusBoard();
  // refresh welcome chips if visible
  if (messagesEl.querySelector(".welcome")) renderMessages();
  btn?.classList.remove("spin");
}

function statusOf(value) {
  return (health.models && health.models[value]?.status) || "unknown";
}
function messageOf(value) {
  return (health.models && health.models[value]?.message) || "";
}

// ---------- Model picker ----------
function modelMeta(value) {
  if (!value) return null;
  const [provider, id] = value.split("::");
  for (const g of catalog) if (g.provider === provider) {
    const m = g.models.find((x) => x.id === id);
    if (m) return { provider, id, name: m.name, groupLabel: g.label };
  }
  return null;
}

function renderPicker() {
  pickerPanel.innerHTML = "";
  for (const g of catalog) {
    const lbl = document.createElement("div");
    lbl.className = "picker-group-label"; lbl.textContent = g.label;
    pickerPanel.appendChild(lbl);
    for (const m of g.models) {
      const value = `${g.provider}::${m.id}`;
      const st = statusOf(value);
      const opt = document.createElement("div");
      opt.className = "picker-option" + (value === selectedValue ? " selected" : "");
      opt.setAttribute("role", "option");
      opt.innerHTML = `<i class="dot ${STATUS[st].dot}"></i>
        <div class="po-main">
          <div class="po-name"></div>
          <div class="po-status ${st}"></div>
        </div>`;
      opt.querySelector(".po-name").textContent = m.name;
      opt.querySelector(".po-status").textContent = STATUS[st].label + (messageOf(value) && st !== "online" ? " · " + messageOf(value) : "");
      opt.addEventListener("click", () => { selectModel(value); closePicker(); });
      pickerPanel.appendChild(opt);
    }
  }
}

function selectModel(value) {
  selectedValue = value;
  localStorage.setItem(LS_MODEL, value);
  renderPicker(); updateTrigger(); updateBanner();
}

function updateTrigger() {
  const meta = modelMeta(selectedValue);
  const st = statusOf(selectedValue);
  $("#trigger-dot").className = `dot ${STATUS[st].dot}`;
  $("#trigger-name").textContent = meta ? meta.name : "No models";
  $("#trigger-provider").textContent = meta ? "· " + meta.groupLabel : "";
}

function updateBanner() {
  const st = statusOf(selectedValue);
  const meta = modelMeta(selectedValue);
  if (!meta || st === "online") { banner.classList.add("hidden"); banner.className = "model-banner hidden"; return; }
  banner.className = `model-banner ${st}`;
  banner.innerHTML = `<span class="mb-icon"><svg viewBox="0 0 24 24" width="17" height="17"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    <span class="mb-text">${bannerFor(st, messageOf(selectedValue), meta.name)}</span>`;
}

function openPicker() { picker.dataset.open = "true"; pickerPanel.hidden = false; pickerTrigger.setAttribute("aria-expanded", "true"); }
function closePicker() { picker.dataset.open = "false"; pickerPanel.hidden = true; pickerTrigger.setAttribute("aria-expanded", "false"); }

function updateStatusBoard() {
  const vals = catalog.flatMap((g) => g.models.map((m) => `${g.provider}::${m.id}`));
  let on = 0, cr = 0, off = 0;
  for (const v of vals) { const s = statusOf(v); if (s === "online") on++; else if (s === "needs_credit") cr++; else if (s === "offline" || s === "error") off++; }
  $("#sc-online").textContent = on; $("#sc-credit").textContent = cr; $("#sc-offline").textContent = off;
}

// ---------- Chat management ----------
function newChat() {
  // Reuse an existing empty session instead of stacking up duplicates.
  const empty = chats.find((c) => c.messages.length === 0);
  if (empty) { openChat(empty.id); inputEl.focus(); return; }
  const chat = { id: crypto.randomUUID(), title: "New session", messages: [] };
  chats.unshift(chat); currentId = chat.id; save(LS_CHATS, chats);
  renderChatList(); renderMessages(); inputEl.focus();
  if (NARROW()) toggleSidebar(true);
}
function openChat(id) { currentId = id; renderChatList(); renderMessages(); if (NARROW()) toggleSidebar(true); }
function deleteChat(id) {
  chats = chats.filter((c) => c.id !== id); save(LS_CHATS, chats);
  if (currentId === id) { chats.length ? openChat(chats[0].id) : newChat(); } else renderChatList();
}
function getChat() { return chats.find((c) => c.id === currentId); }

function renderChatList() {
  chatListEl.innerHTML = "";
  for (const c of chats) {
    const item = document.createElement("div");
    item.className = "chat-item" + (c.id === currentId ? " active" : "");
    item.innerHTML = `<span class="title"></span>
      <button class="del" title="Delete" aria-label="Delete session"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
    item.querySelector(".title").textContent = c.title;
    item.addEventListener("click", () => openChat(c.id));
    item.querySelector(".del").addEventListener("click", (e) => { e.stopPropagation(); deleteChat(c.id); });
    chatListEl.appendChild(item);
  }
}

// ---------- Rendering messages ----------
function renderMessages() {
  const chat = getChat();
  messagesEl.innerHTML = "";
  if (!chat || !chat.messages.length) { messagesEl.appendChild(cloneWelcome()); return; }
  for (const m of chat.messages) messagesEl.appendChild(renderRow(m));
  scrollToBottom();
}

function cloneWelcome() {
  const node = welcomeTemplate.cloneNode(true);
  // online-model quick chips
  const wrap = node.querySelector("#welcome-status");
  wrap.innerHTML = "";
  const online = catalog.flatMap((g) => g.models.map((m) => ({ value: `${g.provider}::${m.id}`, name: m.name })))
    .filter((x) => statusOf(x.value) === "online");
  if (online.length) {
    for (const o of online.slice(0, 6)) {
      const chip = document.createElement("button");
      chip.className = "ws-chip"; chip.type = "button";
      chip.innerHTML = `<i class="dot online"></i>`; chip.append(o.name);
      chip.addEventListener("click", () => { selectModel(o.value); inputEl.focus(); });
      wrap.appendChild(chip);
    }
  } else {
    const chip = document.createElement("span");
    chip.className = "ws-chip"; chip.innerHTML = `<i class="dot unknown"></i>`; chip.append("Checking model availability…");
    wrap.appendChild(chip);
  }
  node.querySelectorAll(".suggestion").forEach((b) =>
    b.addEventListener("click", () => { inputEl.value = b.textContent.replace(/^[a-z]+/, "").trim(); inputEl.focus(); autoGrow(); })
  );
  return node;
}

function renderRow(msg) {
  const row = document.createElement("div");
  row.className = "msg-row " + msg.role;
  const inner = document.createElement("div"); inner.className = "msg-inner";
  const avatar = document.createElement("div"); avatar.className = "avatar " + msg.role; avatar.textContent = msg.role === "user" ? "YOU" : "AI";
  const body = document.createElement("div"); body.className = "msg-body";
  if (msg.role === "assistant" && msg.modelName) {
    const meta = document.createElement("div"); meta.className = "msg-meta";
    meta.innerHTML = `<i class="dot online"></i>`; meta.append(msg.modelName);
    body.appendChild(meta);
  }
  const content = document.createElement("div"); content.className = "msg-content";
  if (msg.error) { content.innerHTML = `<div class="msg-error"><span class="me-title">Request failed</span><span class="me-body"></span></div>`; content.querySelector(".me-body").textContent = msg.content; }
  else renderMarkdown(content, msg.content);
  body.appendChild(content);
  inner.append(avatar, body); row.appendChild(inner);
  return row;
}

function renderMarkdown(container, text) {
  container.innerHTML = DOMPurify.sanitize(marked.parse(text || ""));
  enhanceCode(container);
}
function enhanceCode(container) {
  container.querySelectorAll("pre code").forEach((code) => {
    if (code.closest(".code-block")) return;
    const pre = code.parentElement;
    const wrap = document.createElement("div"); wrap.className = "code-block";
    const lang = (code.className.match(/language-(\w+)/) || [])[1] || "text";
    const head = document.createElement("div"); head.className = "code-head";
    head.innerHTML = `<span>${lang}</span><button class="copy-code"><svg viewBox="0 0 24 24" width="12" height="12"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="2" fill="none"/></svg>Copy</button>`;
    head.querySelector(".copy-code").addEventListener("click", (e) => {
      navigator.clipboard.writeText(code.textContent);
      const b = e.currentTarget; const prev = b.innerHTML; b.textContent = "Copied"; setTimeout(() => (b.innerHTML = prev), 1200);
    });
    pre.parentElement.insertBefore(wrap, pre); wrap.append(head, pre);
  });
}
function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// ---------- Sending ----------
async function send() {
  const text = inputEl.value.trim();
  if (!text || abortCtrl) return;
  const meta = modelMeta(selectedValue);
  if (!meta) { return; }
  const chat = getChat();
  if (!chat.messages.length) { chat.title = text.slice(0, 42) + (text.length > 42 ? "…" : ""); renderChatList(); }
  chat.messages.push({ role: "user", content: text });
  inputEl.value = ""; autoGrow();
  if (messagesEl.querySelector(".welcome")) messagesEl.innerHTML = "";
  messagesEl.appendChild(renderRow(chat.messages[chat.messages.length - 1]));
  await streamAssistant(chat, meta);
  save(LS_CHATS, chats);
}

async function streamAssistant(chat, meta) {
  const assistant = { role: "assistant", content: "", provider: meta.provider, model: meta.id, modelName: meta.name };
  chat.messages.push(assistant);
  const row = renderRow(assistant); messagesEl.appendChild(row);
  const contentEl = row.querySelector(".msg-content");
  contentEl.classList.add("cursor-blink"); scrollToBottom();
  setStreaming(true); abortCtrl = new AbortController();

  const payload = chat.messages.filter((m) => m !== assistant && !m.error).map((m) => ({ role: m.role, content: m.content }));
  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ provider: meta.provider, model: meta.id, messages: payload, systemPrompt: settings.systemPrompt, temperature: settings.temperature }),
      signal: abortCtrl.signal,
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Request failed (${res.status})`); }
    await readSSE(res.body, (event, data) => {
      if (event === "delta") { assistant.content += data.text; renderMarkdown(contentEl, assistant.content); contentEl.classList.add("cursor-blink"); scrollToBottom(); }
      else if (event === "error") throw new Error(data.message);
    });
    contentEl.classList.remove("cursor-blink");
    addMessageActions(row, assistant, chat);
  } catch (err) {
    contentEl.classList.remove("cursor-blink");
    if (err.name === "AbortError") {
      if (!assistant.content) assistant.content = "_(stopped)_";
      renderMarkdown(contentEl, assistant.content); addMessageActions(row, assistant, chat);
    } else {
      assistant.error = true; assistant.content = err.message || "Something went wrong.";
      contentEl.innerHTML = `<div class="msg-error"><span class="me-title">Request failed</span><span class="me-body"></span></div>`;
      contentEl.querySelector(".me-body").textContent = assistant.content;
      refreshHealth(true); // a failure is a good moment to recheck status
    }
  } finally { setStreaming(false); abortCtrl = null; }
}

function addMessageActions(row, msg, chat) {
  if (msg.error) return;
  const body = row.querySelector(".msg-body");
  if (body.querySelector(".msg-actions")) return;
  const actions = document.createElement("div"); actions.className = "msg-actions";
  const copyBtn = document.createElement("button"); copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => { navigator.clipboard.writeText(msg.content); copyBtn.textContent = "Copied"; setTimeout(() => (copyBtn.textContent = "Copy"), 1200); });
  const regenBtn = document.createElement("button"); regenBtn.textContent = "Regenerate";
  regenBtn.addEventListener("click", () => regenerate(chat));
  actions.append(copyBtn, regenBtn); body.appendChild(actions);
}

async function regenerate(chat) {
  if (abortCtrl) return;
  while (chat.messages.length && chat.messages[chat.messages.length - 1].role === "assistant") chat.messages.pop();
  renderMessages();
  const meta = modelMeta(selectedValue); if (!meta) return;
  await streamAssistant(chat, meta); save(LS_CHATS, chats);
}

function setStreaming(on) { sendBtn.classList.toggle("hidden", on); stopBtn.classList.toggle("hidden", !on); }

async function readSSE(stream, onEvent) {
  const reader = stream.getReader(), decoder = new TextDecoder(); let buffer = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
      let event = "message", data = "";
      for (const line of chunk.split("\n")) { if (line.startsWith("event:")) event = line.slice(6).trim(); else if (line.startsWith("data:")) data += line.slice(5).trim(); }
      if (data) { let parsed; try { parsed = JSON.parse(data); } catch { parsed = {}; } onEvent(event, parsed); }
    }
  }
}

// ---------- Events ----------
function wireEvents() {
  $("#new-chat").addEventListener("click", newChat);
  $("#composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  stopBtn.addEventListener("click", () => abortCtrl?.abort());
  inputEl.addEventListener("input", autoGrow);
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });

  pickerTrigger.addEventListener("click", (e) => { e.stopPropagation(); picker.dataset.open === "true" ? closePicker() : openPicker(); });
  document.addEventListener("click", (e) => { if (!picker.contains(e.target)) closePicker(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePicker(); });

  $("#refresh-status").addEventListener("click", (e) => { e.stopPropagation(); refreshHealth(true); });

  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next); localStorage.setItem(LS_THEME, next);
  });
  $("#toggle-sidebar").addEventListener("click", () => toggleSidebar(true));
  $("#show-sidebar").addEventListener("click", () => toggleSidebar(false));

  const dialog = $("#settings-dialog");
  $("#open-settings").addEventListener("click", () => {
    $("#system-prompt").value = settings.systemPrompt; $("#temperature").value = settings.temperature; $("#temp-value").textContent = settings.temperature;
    dialog.showModal();
  });
  $("#temperature").addEventListener("input", (e) => ($("#temp-value").textContent = e.target.value));
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "save") { settings.systemPrompt = $("#system-prompt").value; settings.temperature = parseFloat($("#temperature").value); save(LS_SETTINGS, settings); }
  });

  document.querySelectorAll(".suggestion").forEach((b) =>
    b.addEventListener("click", () => { inputEl.value = b.textContent.replace(/^[a-z]+/, "").trim(); inputEl.focus(); autoGrow(); })
  );
}

function toggleSidebar(collapse) { $("#sidebar").classList.toggle("collapsed", collapse); $("#show-sidebar").classList.toggle("hidden", !collapse); }
function autoGrow() { inputEl.style.height = "auto"; inputEl.style.height = Math.min(inputEl.scrollHeight, 220) + "px"; }
function applyTheme(theme) { document.documentElement.dataset.theme = theme; }

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
