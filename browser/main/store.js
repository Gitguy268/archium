// Settings, bookmarks, history and the saved session, as small JSON files in userData.
import { app } from "electron";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULTS } from "../../extension/lib.js";

export const SETTINGS_DEFAULTS = Object.freeze({
  ...DEFAULTS,
  theme: "normal", // "normal" | "win98" | "glass"
  tabs: "top", // "top" | "side" | "hidden"
  restoreSession: false,
  adblock: true,
  links: [
    { title: "Wikipedia", url: "https://en.wikipedia.org/" },
    { title: "OpenStreetMap", url: "https://www.openstreetmap.org/" },
    { title: "GitHub", url: "https://github.com/" },
  ],
});

const HISTORY_MAX = 2000;
const dir = () => app.getPath("userData");

function load(name, fallback) {
  try {
    return JSON.parse(readFileSync(join(dir(), name), "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

// Write to a temp file and rename, so a crash never leaves half a file.
function save(name, value) {
  mkdirSync(dir(), { recursive: true });
  const path = join(dir(), name);
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 1));
  renameSync(`${path}.tmp`, path);
}

let settings;
export function getSettings() {
  settings ??= { ...SETTINGS_DEFAULTS, ...load("settings.json", {}) };
  return settings;
}

const ALLOWED = {
  theme: ["normal", "win98", "glass"],
  tabs: ["top", "side", "hidden"],
  mode: ["direct", "tor", "proxy"],
  proxyScheme: ["socks5", "socks4", "http", "https"],
};

// Only known keys with valid values get through: the UI is trusted, but its input is not.
export function updateSettings(patch) {
  const next = { ...getSettings() };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!(key in SETTINGS_DEFAULTS)) continue;
    if (ALLOWED[key] && !ALLOWED[key].includes(value)) continue;
    const kind = Array.isArray(SETTINGS_DEFAULTS[key]) ? "array" : typeof SETTINGS_DEFAULTS[key];
    if (kind === "array" ? !Array.isArray(value) : typeof value !== kind) continue;
    next[key] = value;
  }
  settings = next;
  save("settings.json", settings);
  return settings;
}

let bookmarks;
export function getBookmarks() {
  bookmarks ??= load("bookmarks.json", []);
  return bookmarks;
}
export function toggleBookmark({ url, title }) {
  const list = getBookmarks();
  const i = list.findIndex((b) => b.url === url);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ url, title: title || url, added: Date.now() });
  save("bookmarks.json", list);
  return i < 0;
}

let history;
export function getHistory() {
  history ??= load("history.json", []);
  return history;
}
let historyTimer;
export function addHistory({ url, title }) {
  if (!/^https?:/.test(url)) return;
  const list = getHistory();
  const i = list.findIndex((h) => h.url === url);
  if (i >= 0) list.splice(i, 1);
  list.unshift({ url, title: title || url, visited: Date.now() });
  list.length = Math.min(list.length, HISTORY_MAX);
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => save("history.json", list), 1000);
}
export function clearHistory() {
  history = [];
  save("history.json", history);
}

// Normal tabs only, URLs and titles only: never page text, never private tabs.
export function saveSession(tabs) {
  if (!getSettings().restoreSession) return save("session.json", []);
  save("session.json", tabs.slice(0, 100));
}
export function loadSession() {
  return getSettings().restoreSession ? load("session.json", []) : [];
}
