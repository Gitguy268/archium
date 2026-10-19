// The toolbar page: tabs, address field, menus, ⌘K, settings and the find bar. It owns no
// browsing state; main sends a snapshot on every change and this page draws it, then
// reports where the web page and the assistant panel should sit.
import qrcodegen from "./vendor/qrcodegen/qrcodegen.js";

const api = window.archium;
const $ = (id) => document.getElementById(id);
const body = document.body;
let state = null;
let overlay = null; // the open popover element
let lastLayout = "";

const COMMANDS = [
  ["New Tab", "new-tab", "⌘T"],
  ["New Window", "new-window", "⌘N"],
  ["New Private Tab", "new-private-tab", "⇧⌘N"],
  ["Glance", "glance", "⌃⌥Space"],
  ["Reopen Closed Tab", "reopen-tab", "⇧⌘T"],
  ["Bookmark This Page", "bookmark", "⌘D"],
  ["Share Page as QR Code", "share-qr", ""],
  ["Show Assistant", "assistant", "⇧⌘A"],
  ["Summarize Page", "summarize", "⇧⌘U"],
  ["Look at This Page", "look", "⇧⌘L"],
  ["Focus Mode", "focus-mode", "⇧⌘B"],
  ["Tabs on Side / Top", "tabs-position", "⌘S"],
  ["Show or Hide Tabs", "tabs-visible", "⇧⌘S"],
  ["Look: Normal", "theme:normal", ""],
  ["Look: Windows 98", "theme:win98", ""],
  ["Look: Liquid Glass", "theme:glass", ""],
  ["Find in Page", "find", "⌘F"],
  ["Downloads", "downloads", "⇧⌘J"],
  ["Settings", "settings", "⌘,"],
  ["Developer Tools", "devtools", "⌥⌘I"],
];

// --- commands ---------------------------------------------------------------

function command(cmd) {
  if (cmd.startsWith("theme:")) return setSettings({ theme: cmd.slice(6) });
  switch (cmd) {
    case "focus-address":
      closeOverlay();
      $("address").focus();
      $("address").select();
      return;
    case "home":
      return api.send("navigate", "archium://newtab/");
    case "find":
      return openFind();
    case "palette":
      return openPalette("");
    case "history":
      return openPalette("", "history");
    case "bookmarks":
      return openPalette("", "bookmarks");
    case "settings":
      return openSettings();
    case "share-qr":
      return openQr();
    case "escape":
      return closeOverlay();
    default:
      closeOverlay();
      api.send(cmd);
  }
}

api.on("command", command);
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-cmd]");
  if (el) {
    e.preventDefault();
    command(el.dataset.cmd);
  }
});

// --- state ------------------------------------------------------------------

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

function tabElement(tab, vertical) {
  const el = document.createElement("div");
  el.className = "tab";
  el.role = "tab";
  el.draggable = true;
  el.dataset.id = tab.id;
  el.title = `${tab.title}\n${tab.url.startsWith("archium:") ? "" : tab.url}`;
  el.setAttribute("aria-selected", String(tab.id === state.activeId));
  if (tab.private) el.classList.add("private");
  const iconEl = document.createElement("span");
  iconEl.className = "tab-icon";
  if (tab.loading) iconEl.classList.add("loading");
  else if (tab.private) iconEl.innerHTML = '<svg><use href="#i-mask"/></svg>';
  else if (tab.favicon) {
    const img = document.createElement("img");
    img.src = tab.favicon;
    img.alt = "";
    img.onerror = () => img.remove();
    iconEl.append(img);
  } else iconEl.innerHTML = '<img src="assets/logo.svg" alt="">';
  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tab.title || hostOf(tab.url) || "New Tab";
  const close = document.createElement("button");
  close.className = "tab-close";
  close.setAttribute("aria-label", `Close ${title.textContent}`);
  close.innerHTML = '<svg><use href="#i-close"/></svg>';
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    api.send("close-tab", tab.id);
  });
  el.append(iconEl, title, close);
  el.addEventListener("mousedown", (e) => {
    if (e.button === 1) {
      e.preventDefault();
      api.send("close-tab", tab.id);
    } else if (e.button === 0 && !e.target.closest(".tab-close")) api.send("activate", tab.id);
  });
  el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/archium-tab", String(tab.id)));
  el.addEventListener("dragover", (e) => e.preventDefault());
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/archium-tab"));
    const to = state.tabs.findIndex((t) => t.id === tab.id);
    if (id && id !== tab.id) api.send("move-tab", { id, to });
  });
  if (vertical) el.classList.add("vertical");
  return el;
}

function render(next) {
  state = next;
  const s = state.settings;
  const active = state.tabs.find((t) => t.id === state.activeId);
  body.dataset.theme = s.theme;
  body.dataset.tabs = s.tabs;
  body.dataset.nativeGlass = String(state.nativeGlass);
  body.toggleAttribute("data-focus", state.focusMode);
  body.toggleAttribute("data-assistant", state.assistantOpen);
  body.toggleAttribute("data-private", Boolean(active?.private));
  body.toggleAttribute("data-fullscreen", state.fullscreen);

  $("tabstrip").replaceChildren(...state.tabs.map((t) => tabElement(t, false)));
  $("sidetabs").replaceChildren(...state.tabs.map((t) => tabElement(t, true)));
  $("tabstrip").querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });

  $("back").disabled = !state.canBack;
  $("forward").disabled = !state.canForward;
  const loading = Boolean(active?.loading);
  $("reload").dataset.cmd = loading ? "stop" : "reload";
  $("reload").querySelector("use").setAttribute("href", loading ? "#i-stop" : "#i-reload");
  $("reload").querySelector(".label").textContent = loading ? "Stop" : "Refresh";

  const address = $("address");
  if (document.activeElement !== address) address.value = state.url;
  const secure = state.url.startsWith("https:");
  $("site").querySelector("use").setAttribute("href", !state.url ? "#i-search" : secure ? "#i-lock" : "#i-shield");
  $("site").title = !state.url ? "" : secure ? `Secure connection to ${hostOf(state.url)}` : "Not encrypted";
  $("site").classList.toggle("insecure", Boolean(state.url) && !secure && !state.url.startsWith("archium:"));
  $("star").classList.toggle("on", state.bookmarked);
  $("star").disabled = !state.url;
  $("qr-btn").disabled = !/^https?:/.test(state.url);

  const blocked = $("blocked");
  blocked.hidden = !state.blocked;
  blocked.textContent = state.blocked > 99 ? "99+" : String(state.blocked);
  $("shield").title = s.adblock ? `${state.blocked} ads and trackers blocked on this page` : "Ad blocking is off";
  $("shield").classList.toggle("off", !s.adblock);

  const chip = $("mode-chip");
  chip.hidden = s.mode === "direct";
  chip.textContent = s.mode === "tor" ? "Tor" : "Proxy";
  chip.classList.toggle("error", Boolean(state.status));
  $("ai-btn").classList.toggle("on", state.assistantOpen);

  const banner = $("banner");
  banner.hidden = !state.status;
  banner.textContent = state.status;

  $("caption-title").textContent = active ? `${active.title || "New Tab"} - Archium` : "Archium";
  document.title = active?.title || "Archium";
  $("status-text").textContent = state.hoverUrl || (loading ? `Opening page ${hostOf(state.url)}…` : "Done");
  $("status-blocked").textContent = s.adblock ? `${state.blocked} blocked` : "Blocking off";
  $("status-zone").textContent = s.mode === "tor" ? "Tor" : s.mode === "proxy" ? "Proxy" : active?.private ? "Private" : "Internet";

  for (const b of document.querySelectorAll("[data-theme-pick]")) b.setAttribute("aria-pressed", String(b.dataset.themePick === s.theme));
  $("panel-slot").hidden = !state.assistantOpen;
  if (!$("settings").hidden) fillSettings();
  queueLayout();
}

api.on("state", render);

// --- layout -----------------------------------------------------------------

function rectOf(el) {
  if (el.hidden || !el.offsetParent) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

let layoutQueued = false;
function queueLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    const layout = { page: rectOf($("page-slot")), panel: rectOf($("panel-slot")) };
    const key = JSON.stringify(layout);
    if (!layout.page || key === lastLayout) return;
    lastLayout = key;
    api.send("layout", layout);
  });
}
new ResizeObserver(queueLayout).observe($("page-slot"));
new ResizeObserver(queueLayout).observe($("panel-slot"));
addEventListener("resize", queueLayout);

// --- address field ----------------------------------------------------------

$("omnibox").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("address").value.trim();
  if (!text) return;
  api.send("navigate", text);
  $("address").blur();
});
$("address").addEventListener("focus", () => requestAnimationFrame(() => $("address").select()));
$("address").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("address").value = state?.url ?? "";
    $("address").blur();
    api.send("focus-page");
  }
});

// --- overlays ---------------------------------------------------------------

function openOverlay(el, anchor) {
  if (overlay && overlay !== el) overlay.hidden = true;
  overlay = el;
  api.send("overlay", true);
  body.toggleAttribute("data-overlay", true);
  $("scrim").hidden = false;
  $("scrim").classList.toggle("dim", !anchor);
  el.hidden = false;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    el.style.top = `${r.bottom + 6}px`;
    el.style.right = `${Math.max(8, innerWidth - r.right)}px`;
    el.style.left = "auto";
  }
}

function closeOverlay() {
  if (!overlay) return;
  overlay.hidden = true;
  overlay = null;
  $("scrim").hidden = true;
  body.toggleAttribute("data-overlay", false);
  api.send("overlay", false);
}

$("scrim").addEventListener("mousedown", closeOverlay);
for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", closeOverlay);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay) {
    e.preventDefault();
    closeOverlay();
  }
});

$("menu-btn").addEventListener("click", () => (overlay === $("menu") ? closeOverlay() : openOverlay($("menu"), $("menu-btn"))));
for (const b of document.querySelectorAll("[data-theme-pick]")) b.addEventListener("click", () => setSettings({ theme: b.dataset.themePick }));

// --- ⌘K palette -------------------------------------------------------------

let paletteItems = [];
let paletteIndex = 0;
let paletteScope = "all";

async function openPalette(text, scope = "all") {
  paletteScope = scope;
  openOverlay($("palette"));
  const input = $("palette-input");
  input.value = text;
  input.placeholder = scope === "history" ? "Search history" : scope === "bookmarks" ? "Search bookmarks" : "Search tabs, bookmarks, history and commands";
  input.focus();
  await fillPalette();
}

async function fillPalette() {
  const q = $("palette-input").value.trim();
  const found = await api.invoke("search", q);
  const items = [];
  if (q && paletteScope === "all") items.push({ group: "Go", label: q, hint: "Search or open", run: () => api.send("navigate", q) });
  if (paletteScope === "all") {
    for (const t of found.tabs) items.push({ group: "Tabs", label: t.title || t.url, hint: hostOf(t.url), icon: t.private ? "mask" : "", run: () => (t.own ? api.send("activate", t.id) : api.send("new-tab", t.url)) });
    const lower = q.toLowerCase();
    for (const [label, cmd, keys] of COMMANDS) {
      if (!q || label.toLowerCase().includes(lower)) items.push({ group: "Commands", label, hint: keys, run: () => command(cmd) });
    }
  }
  if (paletteScope !== "history") {
    for (const b of found.bookmarks) items.push({ group: "Bookmarks", label: b.title, hint: hostOf(b.url), run: () => api.send("navigate", b.url), remove: () => api.invoke("remove-bookmark", b.url).then(fillPalette) });
  }
  if (paletteScope !== "bookmarks") {
    for (const h of found.history) items.push({ group: "History", label: h.title, hint: hostOf(h.url), run: () => api.send("navigate", h.url) });
  }
  paletteItems = items;
  paletteIndex = 0;
  drawPalette();
}

function drawPalette() {
  const list = $("palette-list");
  let group = "";
  const nodes = [];
  paletteItems.forEach((item, i) => {
    if (item.group !== group) {
      group = item.group;
      const h = document.createElement("li");
      h.className = "palette-group";
      h.textContent = group;
      nodes.push(h);
    }
    const li = document.createElement("li");
    li.role = "option";
    li.className = "palette-item";
    li.setAttribute("aria-selected", String(i === paletteIndex));
    const label = document.createElement("span");
    label.className = "palette-label";
    label.textContent = item.label;
    const hint = document.createElement("span");
    hint.className = "palette-hint";
    hint.textContent = item.hint ?? "";
    li.append(label, hint);
    if (item.remove) {
      const x = document.createElement("button");
      x.className = "icon mini";
      x.setAttribute("aria-label", "Remove bookmark");
      x.innerHTML = '<svg><use href="#i-close"/></svg>';
      x.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        item.remove();
      });
      li.append(x);
    }
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pick(i);
    });
    nodes.push(li);
  });
  if (!paletteItems.length) {
    const empty = document.createElement("li");
    empty.className = "palette-empty";
    empty.textContent = paletteScope === "history" ? "No history yet." : paletteScope === "bookmarks" ? "No bookmarks yet. Press ⌘D on a page." : "Nothing found.";
    nodes.push(empty);
  }
  list.replaceChildren(...nodes);
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

function pick(i) {
  const item = paletteItems[i];
  if (!item) return;
  closeOverlay();
  item.run();
}

$("palette-input").addEventListener("input", fillPalette);
$("palette-input").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    paletteIndex = (paletteIndex + (e.key === "ArrowDown" ? 1 : -1) + paletteItems.length) % Math.max(1, paletteItems.length);
    drawPalette();
  } else if (e.key === "Enter") {
    e.preventDefault();
    pick(paletteIndex);
  }
});

// --- settings ---------------------------------------------------------------

async function setSettings(patch) {
  await api.invoke("set-settings", patch);
}

function fillSettings() {
  const form = $("settings-form");
  const s = state.settings;
  for (const el of form.elements) {
    if (!el.name || !(el.name in s) || document.activeElement === el) continue;
    if (el.type === "radio") el.checked = s[el.name] === el.value;
    else if (el.type === "checkbox") el.checked = Boolean(s[el.name]);
    else el.value = s[el.name];
  }
  form.dataset.mode = s.mode;
}

function openSettings() {
  openOverlay($("settings"));
  fillSettings();
}

$("settings-form").addEventListener("change", (e) => {
  const el = e.target;
  if (!el.name) return;
  let value = el.type === "checkbox" ? el.checked : el.value;
  if (el.type === "number") value = Number(value);
  if (el.type === "url" && !/^https?:\/\/[^/]+/.test(value)) return fillSettings();
  setSettings({ [el.name]: value });
});
$("settings-form").addEventListener("submit", (e) => e.preventDefault());
$("clear-history").addEventListener("click", async () => {
  await api.invoke("clear-history");
  $("clear-history").textContent = "History cleared";
});

// --- share as QR ------------------------------------------------------------

function openQr() {
  if (!/^https?:/.test(state?.url ?? "")) return;
  const qr = qrcodegen.QrCode.encodeText(state.url, qrcodegen.QrCode.Ecc.MEDIUM);
  const canvas = $("qr-canvas");
  const quiet = 4;
  const scale = Math.floor(canvas.width / (qr.size + quiet * 2));
  const offset = Math.floor((canvas.width - scale * qr.size) / 2);
  const c = canvas.getContext("2d");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "#000";
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) c.fillRect(offset + x * scale, offset + y * scale, scale, scale);
  $("qr-url").textContent = state.url;
  $("qr-copy").textContent = "Copy link";
  openOverlay($("qr"));
}
$("qr-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.url);
  $("qr-copy").textContent = "Copied";
});

// --- find in page -----------------------------------------------------------

function openFind() {
  $("findbar").hidden = false;
  $("find").focus();
  $("find").select();
  queueLayout();
}
function closeFind() {
  $("findbar").hidden = true;
  $("find-count").textContent = "";
  api.send("stop-find");
  queueLayout();
}
let findText = "";
$("find").addEventListener("input", () => {
  findText = $("find").value;
  if (findText) api.send("find", { text: findText });
  else {
    api.send("stop-find");
    $("find-count").textContent = "";
  }
});
$("find").addEventListener("keydown", (e) => {
  if (e.key === "Enter") api.send("find", { text: findText, forward: !e.shiftKey, next: true });
  if (e.key === "Escape") closeFind();
});
$("find-next").addEventListener("click", () => findText && api.send("find", { text: findText, next: true }));
$("find-prev").addEventListener("click", () => findText && api.send("find", { text: findText, forward: false, next: true }));
$("find-close").addEventListener("click", closeFind);
api.on("found", (r) => {
  $("find-count").textContent = r.matches ? `${r.activeMatchOrdinal} of ${r.matches}` : "No matches";
});

api.send("ready");
