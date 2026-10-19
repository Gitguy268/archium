// Every session gets the same network policy: proxy (with kill switch), the request
// dispatcher, and deny-by-default permissions. A session left out would be a leak.
import { app, dialog, session, webContents } from "electron";
import { createDispatcher } from "./filter.js";
import { sessionProxy, sessionWebRTC } from "./privacy.js";
import { getBlocker, onHeadersReceived, enableCosmetics } from "./adblock.js";
import { getSettings } from "./store.js";

export let sessions; // { tabs, private, ui, ai }
const blockedBy = new Map(); // webContents id → requests blocked on its current page
let proxyError = "";
let onChange = () => {};

export const blockedCount = (id) => blockedBy.get(id) ?? 0;
export const resetBlocked = (id) => blockedBy.delete(id);
export const proxyStatus = () => proxyError;

// Asked once per site and session; the answer lasts until the browser quits.
const PROMPTED = new Set(["media", "geolocation", "notifications", "midi", "clipboard-read"]);
const ALWAYS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock"]);
const answers = new Map();

function permissionLabel(permission, details) {
  if (permission === "media") {
    const kinds = details.mediaTypes ?? [];
    if (kinds.includes("video") && kinds.includes("audio")) return "use your camera and microphone";
    return kinds.includes("video") ? "use your camera" : "use your microphone";
  }
  return { geolocation: "know your location", notifications: "show notifications", midi: "use MIDI devices", "clipboard-read": "read your clipboard" }[permission];
}

function webPermissions(ses) {
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (ALWAYS.has(permission)) return callback(true);
    if (!PROMPTED.has(permission) || ses === sessions.ui || ses === sessions.ai) return callback(false);
    let origin;
    try {
      origin = new URL(details.requestingUrl).origin;
    } catch {
      return callback(false);
    }
    const key = `${ses === sessions.private ? "p" : "n"}|${origin}|${permission}`;
    if (answers.has(key)) return callback(answers.get(key));
    const { response } = await dialog.showMessageBox({
      type: "question",
      buttons: ["Block", "Allow"],
      defaultId: 0,
      cancelId: 0,
      message: `Allow ${new URL(origin).host} to ${permissionLabel(permission, details)}?`,
      detail: "Archium remembers your answer until you quit.",
    });
    answers.set(key, response === 1);
    callback(response === 1);
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (ALWAYS.has(permission)) return true;
    try {
      return answers.get(`${ses === sessions.private ? "p" : "n"}|${new URL(origin).origin}|${permission}`) === true;
    } catch {
      return false;
    }
  });
  ses.setDevicePermissionHandler(() => false);
}

export function setupSessions(changed) {
  onChange = changed;
  sessions = {
    tabs: session.defaultSession,
    private: session.fromPartition("archium-private"), // in memory: gone when Archium quits
    ui: session.fromPartition("persist:archium-ui"),
    // persist: Chromium can't read back a 1.6 GB Blob in an in-memory session.
    ai: session.fromPartition("persist:archium-ai"),
  };
  // Look like Chrome: "Electron" and the app name in the user agent get pages blocked.
  const ua = app.userAgentFallback.replace(/ (Electron|archium-browser)\/\S+/g, "");
  app.userAgentFallback = ua;

  const dispatcher = createDispatcher({
    getSettings,
    getBlocker: () => (getSettings().adblock ? getBlocker() : null),
    onBlocked: (details) => {
      if (details.webContentsId == null) return;
      blockedBy.set(details.webContentsId, blockedCount(details.webContentsId) + 1);
      onChange("blocked", details.webContentsId);
    },
  });
  for (const ses of Object.values(sessions)) {
    ses.setUserAgent(ua);
    ses.webRequest.onBeforeRequest(dispatcher);
    ses.webRequest.onHeadersReceived((details, callback) =>
      getSettings().adblock ? onHeadersReceived(details, callback) : callback({}),
    );
    webPermissions(ses);
  }
  enableCosmetics(sessions.tabs);
  enableCosmetics(sessions.private);
  return applyNetwork();
}

// Pushes the stored network settings into every session and every page.
export async function applyNetwork() {
  const s = getSettings();
  const { config, error } = sessionProxy(s);
  proxyError = error;
  await Promise.all(
    Object.values(sessions).map(async (ses) => {
      await ses.setProxy(config);
      await ses.closeAllConnections(); // open sockets would otherwise keep the old route
    }),
  );
  for (const wc of webContents.getAllWebContents()) wc.setWebRTCIPHandlingPolicy(sessionWebRTC(s));
  onChange("network");
}

// Pages created later get the policy as they appear.
app.on("web-contents-created", (_, wc) => {
  wc.setWebRTCIPHandlingPolicy(sessionWebRTC(getSettings()));
  wc.on("will-attach-webview", (e) => e.preventDefault());
});

// Tor or the proxy is down: pages fail with a proxy error rather than going direct.
export function noteLoadError(errorCode) {
  if ([-130, -115, -125, -127].includes(errorCode) && getSettings().mode !== "direct") {
    proxyError = getSettings().mode === "tor" ? "Tor is not reachable. Pages are blocked until it is back." : "The proxy is not reachable. Pages are blocked until it is back.";
    onChange("network");
  }
}
export function clearProxyError() {
  if (proxyError && !sessionProxy(getSettings()).error) {
    proxyError = "";
    onChange("network");
  }
}
