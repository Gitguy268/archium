// Settings, bookmarks, history, site settings, favicons and the saved session, as small
// JSON files in userData.
import { app } from "electron";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULTS } from "../../extension/lib.js";
import { normalizeSession } from "./session-file.js";

export const SETTINGS_DEFAULTS = Object.freeze({
  ...DEFAULTS,
  theme: "normal", // "normal" | "win98" | "glass"
  tabs: "side", // "side" | "top"
  compact: false, // side tabs: the sidebar slides in from the left edge
  bookmarksBar: false,
  restoreSession: false,
  adblock: true,
  searchSuggestions: false, // typed text goes to the local SearXNG's autocompleter
  downloadAsk: false,
  downloadDir: "", // empty: ~/Downloads
  links: [
    { title: "Wikipedia", url: "https://en.wikipedia.org/" },
    { title: "OpenStreetMap", url: "https://www.openstreetmap.org/" },
    { title: "GitHub", url: "https://github.com/" },
  ],
});

const HISTORY_MAX = 5000;
const FAVICONS_MAX = 600;
const dir = () => app.getPath("userData");

export function loadJson(name, fallback) {
  try {
    return JSON.parse(readFileSync(join(dir(), name), "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

// Write to a temp file and rename, so a crash never leaves half a file.
export function saveJson(name, value) {
  mkdirSync(dir(), { recursive: true });
  const path = join(dir(), name);
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 1));
  renameSync(`${path}.tmp`, path);
}

// Batches frequent writes (history, favicons) into one per second.
const timers = new Map();
function saveSoon(name, value) {
  clearTimeout(timers.get(name));
  timers.set(name, setTimeout(() => saveJson(name, value), 1000));
}

let settings;
export function getSettings() {
  if (!settings) {
    settings = { ...SETTINGS_DEFAULTS, ...loadJson("settings.json", {}) };
    // Older profiles: "hidden" tabs are now side tabs in compact mode.
    if (settings.tabs === "hidden") Object.assign(settings, { tabs: "side", compact: true });
  }
  return settings;
}

const ALLOWED = {
  theme: ["normal", "win98", "glass"],
  tabs: ["top", "side"],
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
  saveJson("settings.json", settings);
  return settings;
}

// --- bookmarks ---------------------------------------------------------------

let bookmarks;
export function getBookmarks() {
  bookmarks ??= loadJson("bookmarks.json", []);
  return bookmarks;
}
export function toggleBookmark({ url, title }) {
  const list = getBookmarks();
  const i = list.findIndex((b) => b.url === url);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ url, title: title || url, added: Date.now() });
  saveJson("bookmarks.json", list);
  return i < 0;
}
export function removeBookmark(url) {
  const list = getBookmarks();
  const i = list.findIndex((b) => b.url === url);
  if (i >= 0) list.splice(i, 1);
  saveJson("bookmarks.json", list);
}
export function renameBookmark(url, title) {
  const b = getBookmarks().find((x) => x.url === url);
  if (!b || typeof title !== "string" || !title.trim()) return;
  b.title = title.trim().slice(0, 300);
  saveJson("bookmarks.json", getBookmarks());
}
// Imported bookmarks keep their folder; ones already saved are skipped.
export function addBookmarks(items, folder) {
  const list = getBookmarks();
  const have = new Set(list.map((b) => b.url));
  let added = 0;
  for (const item of items) {
    if (!/^https?:\/\//.test(item.url) || have.has(item.url)) continue;
    have.add(item.url);
    list.push({ url: item.url.slice(0, 4000), title: String(item.title || item.url).slice(0, 300), folder: [folder, item.folder].filter(Boolean).join(" / "), added: Date.now() });
    added++;
  }
  saveJson("bookmarks.json", list);
  return added;
}

// --- history -----------------------------------------------------------------

let history;
export function getHistory() {
  history ??= loadJson("history.json", []);
  return history;
}
export function addHistory({ url, title }) {
  if (!/^https?:/.test(url)) return;
  const list = getHistory();
  const i = list.findIndex((h) => h.url === url);
  const before = i >= 0 ? list.splice(i, 1)[0] : null;
  // A title update for the page just visited isn't a second visit.
  const visits = (before?.visits ?? 0) + (before && Date.now() - before.visited < 3000 ? 0 : 1);
  list.unshift({ url, title: title || before?.title || url, visited: Date.now(), visits });
  list.length = Math.min(list.length, HISTORY_MAX);
  saveSoon("history.json", list);
}
export function removeHistory(url) {
  const list = getHistory();
  const i = list.findIndex((h) => h.url === url);
  if (i >= 0) list.splice(i, 1);
  saveSoon("history.json", list);
}
// since: a timestamp; entries visited after it are removed. 0 clears everything.
export function clearHistory(since = 0) {
  history = since ? getHistory().filter((h) => h.visited < since) : [];
  saveJson("history.json", history);
}

// --- per-site settings -------------------------------------------------------
// { "https://example.org": { camera: "allow", microphone: "block", blocking: false } }

const SITE_KEYS = { camera: ["ask", "allow", "block"], microphone: ["ask", "allow", "block"], geolocation: ["ask", "allow", "block"], notifications: ["ask", "allow", "block"], blocking: [true, false] };
let sites;
export function getSites() {
  sites ??= loadJson("site-settings.json", {});
  return sites;
}
export const siteOf = (origin) => getSites()[origin] ?? {};
export function setSite(origin, key, value) {
  if (!/^https?:\/\/[^/]+$/.test(origin) || !SITE_KEYS[key]?.includes(value)) return;
  const all = getSites();
  const entry = { ...all[origin], [key]: value };
  // "ask" and blocking on are the defaults: not stored.
  if (value === "ask" || value === true) delete entry[key];
  if (Object.keys(entry).length) all[origin] = entry;
  else delete all[origin];
  saveJson("site-settings.json", all);
}
export function clearSite(origin) {
  delete getSites()[origin];
  saveJson("site-settings.json", getSites());
}
export function blockingOff(url) {
  try {
    return siteOf(new URL(url).origin).blocking === false;
  } catch {
    return false;
  }
}

// --- favicons ----------------------------------------------------------------
// host → data: URL, copied from what pages already loaded, so lists never fetch them again.

let favicons;
const getFavicons = () => (favicons ??= loadJson("favicons.json", {}));
export const getFavicon = (host) => getFavicons()[host] ?? "";
export function setFavicon(host, dataUrl) {
  const all = getFavicons();
  delete all[host];
  all[host] = dataUrl;
  const hosts = Object.keys(all);
  for (const h of hosts.slice(0, Math.max(0, hosts.length - FAVICONS_MAX))) delete all[h];
  saveSoon("favicons.json", all);
}
export function clearFavicons() {
  favicons = {};
  saveJson("favicons.json", favicons);
}

// --- session -----------------------------------------------------------------

// Normal tabs only, URLs only: never page text, never private tabs. Pinned tabs are kept
// even when "reopen tabs" is off, like Zen's essentials.
export function saveSession(entries) {
  const keep = getSettings().restoreSession ? entries : entries.filter((e) => e.pinned);
  saveJson("session.json", keep.slice(0, 100));
}
export function loadSession() {
  const all = normalizeSession(loadJson("session.json", []));
  return getSettings().restoreSession ? all : all.filter((e) => e.pinned);
}
