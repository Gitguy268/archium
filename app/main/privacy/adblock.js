// Ghostery's ad and tracker blocker (MPL-2.0, used unmodified from npm) with EasyList,
// EasyPrivacy, uBlock Origin's lists and the cookie-notice lists. The compiled engine is
// cached in userData, so after the first run the blocker starts offline. It's never given
// enableBlockingInSession: filter.js is the only webRequest listener, and that call would
// replace it (and registers its ipc handlers a second time).
import { app, ipcMain, session as electronSession } from "electron";
import { ElectronBlocker } from "@ghostery/adblocker-electron";
import { createRequire } from "node:module";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const PRELOAD = createRequire(import.meta.url).resolve("@ghostery/adblocker-electron-preload");
const REFRESH_AFTER_MS = 7 * 24 * 3600 * 1000;

let blocker = null;
let cosmeticsAllowed = () => true;
const sessions = new Map(); // session → preload id (or null until the engine exists)

export const getBlocker = () => blocker;

const cachePath = () => join(app.getPath("userData"), "adblock-engine.bin");
const fetchList = (url, init) => electronSession.defaultSession.fetch(url, init);

// allowCosmetics(url) → false for sites with blocking switched off.
export async function startAdblock({ allowCosmetics } = {}) {
  if (allowCosmetics) cosmeticsAllowed = allowCosmetics;
  try {
    blocker = await ElectronBlocker.fromPrebuiltFull(fetchList, { path: cachePath(), read: readFile, write: writeFile });
  } catch (e) {
    console.warn(`[archium] ad blocker lists unavailable: ${e.message}`);
    return null;
  }
  ipcMain.handle("@ghostery/adblocker/inject-cosmetic-filters", (event, url, msg) =>
    cosmeticsAllowed(event.sender.getURL()) ? blocker.onInjectCosmeticFilters(event, url, msg) : undefined,
  );
  ipcMain.handle("@ghostery/adblocker/is-mutation-observer-enabled", (...a) => blocker.onIsMutationObserverEnabled(...a));
  for (const ses of sessions.keys()) addPreload(ses);
  void refreshIfStale();
  return blocker;
}

async function refreshIfStale() {
  try {
    const { mtimeMs } = await stat(cachePath());
    if (Date.now() - mtimeMs < REFRESH_AFTER_MS) return;
    const fresh = await ElectronBlocker.fromPrebuiltFull(fetchList);
    await writeFile(cachePath(), fresh.serialize());
    blocker = fresh;
  } catch {
    // Keep the cached engine; the next start tries again.
  }
}

function addPreload(ses) {
  if (!blocker || sessions.get(ses)) return;
  sessions.set(ses, ses.registerPreloadScript({ type: "frame", filePath: PRELOAD }));
}

// Cosmetic filtering (hiding ad slots) needs Ghostery's preload in each web session.
export function enableCosmetics(ses) {
  if (!sessions.has(ses)) sessions.set(ses, null);
  addPreload(ses);
}
