// Helium's defaults, applied to every web session Hillium creates: the request filter,
// a plain Chrome user agent, no spellcheck downloads from Google, permission prompts,
// WebRTC kept to the public interface, and DNS over HTTPS.
import { app, session } from "electron";
import { createFilter } from "./filter.js";
import { getBlocker, enableCosmetics } from "./adblock.js";
import { chromeUserAgent } from "./ua.js";

export { chromeUserAgent };

const DOH = {
  quad9: "https://dns.quad9.net/dns-query",
  mullvad: "https://dns.mullvad.net/dns-query",
  cloudflare: "https://cloudflare-dns.com/dns-query",
};

export function configureDns(settings) {
  if (settings.doh === "off" || !DOH[settings.doh]) {
    app.configureHostResolver({ secureDnsMode: "off" });
    return;
  }
  app.configureHostResolver({ secureDnsMode: settings.dohMode === "secure" ? "secure" : "automatic", secureDnsServers: [DOH[settings.doh]] });
}

const prepared = new WeakSet();

// askPermission({ webContents, origin, permission }) → Promise<boolean>; decided by the window's prompt.
export function prepareSession(ses, { getSettings, askPermission, onBlocked, preload }) {
  if (prepared.has(ses)) return ses;
  prepared.add(ses);
  const filter = createFilter({ getSettings, getBlocker, onBlocked });
  ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, filter.onBeforeRequest);
  ses.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, filter.onBeforeSendHeaders);
  ses.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, filter.onHeadersReceived);
  ses.wasUpgraded = filter.wasUpgraded;
  ses.setUserAgent(chromeUserAgent());
  if (preload) ses.registerPreloadScript({ type: "frame", filePath: preload });
  enableCosmetics(ses);

  const ASK = new Set(["media", "geolocation", "notifications", "midi", "midiSysex", "idle-detection", "display-capture", "window-management"]);
  const ALLOW = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock", "keyboardLock", "speaker-selection"]);
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (ALLOW.has(permission)) return callback(true);
    if (!ASK.has(permission)) return callback(false);
    let origin = "";
    try {
      origin = new URL(details.requestingUrl || webContents.getURL()).origin;
    } catch {
      return callback(false);
    }
    const key = permission === "media" ? mediaKey(details) : permission;
    const saved = getSettings().permissions[`${origin}|${key}`];
    if (saved !== undefined) return callback(saved);
    askPermission({ webContents, origin, permission: key }).then(callback, () => callback(false));
  });
  ses.setPermissionCheckHandler((webContents, permission, origin) => {
    if (ALLOW.has(permission)) return true;
    const saved = getSettings().permissions;
    try {
      const o = new URL(origin).origin;
      return saved[`${o}|${permission}`] === true;
    } catch {
      return false;
    }
  });
  return ses;
}

function mediaKey(details) {
  const types = details.mediaTypes ?? [];
  if (types.includes("video") && types.includes("audio")) return "camera+microphone";
  if (types.includes("video")) return "camera";
  return "microphone";
}

// Spaces with their own profile get their own cookie jar; private windows get one in memory.
export const partitionFor = (space) => (space?.profile ? `persist:space-${space.id}` : "persist:hillium");

export const sessionFor = (partition, opts) => prepareSession(session.fromPartition(partition), opts);
