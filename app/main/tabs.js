// Web views: one WebContentsView per loaded tab (and one for Glance or a Little Archium window).
// Every view gets the same guards: no Node, a sandbox, WebRTC kept to the public interface,
// no way to open, navigate to or frame archium:// pages, and popups only for real popups.
import { WebContentsView, Menu, clipboard, shell } from "electron";
import { isArchiumUrl } from "./protocol.js";
import { siteOf } from "./privacy/filter.js";

const lastClicks = new WeakMap(); // webContents → { url, at } from the web preload

export function noteLinkClick(webContents, url) {
  lastClicks.set(webContents, { url, at: Date.now() });
}

// The page's own link click (not a redirect or a script), within the last second.
export function wasClicked(webContents, url) {
  const click = lastClicks.get(webContents);
  return Boolean(click && click.url === url && Date.now() - click.at < 1500);
}

// hooks:
//   openTab(url, { background }) – a link wanted a new tab
//   glance(url)                  – open in Glance
//   splitWith(url)               – open next to this one
//   onNavigate(url) / onUpdate(patch) / onState(patch)
//   guardNavigation(url) → true to stop it (pinned tabs send other sites to Glance)
//   menuExtras() → extra context-menu items
export function createWebView({ session, url, hooks = {} }) {
  const view = new WebContentsView({
    webPreferences: {
      session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      safeDialogs: true,
      spellcheck: true,
      backgroundThrottling: true,
    },
  });
  const wc = view.webContents;
  wc.setWebRTCIPHandlingPolicy("default_public_interface_only");
  view.setBackgroundColor("#ffffff");

  wc.setWindowOpenHandler(({ url: target, disposition, features }) => {
    if (/^(mailto|tel):/.test(target)) openExternal(target);
    if (!/^https?:|^about:blank/.test(target)) return { action: "deny" };
    // Real popups (sign-in windows and the like) keep their opener; links become tabs.
    if (disposition === "new-window" && features) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    hooks.openTab?.(target, { background: disposition === "background-tab" });
    return { action: "deny" };
  });

  wc.on("will-navigate", (event) => {
    const target = event.url;
    if (/^(mailto|tel):/.test(target)) {
      event.preventDefault();
      return openExternal(target);
    }
    if (isArchiumUrl(target) && !isArchiumUrl(wc.getURL())) return event.preventDefault();
    if (hooks.guardNavigation?.(target, wc)) event.preventDefault();
  });
  wc.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame && isArchiumUrl(event.url)) event.preventDefault();
  });
  wc.on("will-attach-webview", (event) => event.preventDefault());

  const nav = () => {
    hooks.onNavigate?.(wc.getURL());
    hooks.onState?.({ canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() });
  };
  wc.on("did-navigate", nav);
  wc.on("did-navigate-in-page", (_e, _url, isMainFrame) => isMainFrame && nav());
  wc.on("page-title-updated", (_e, title) => hooks.onUpdate?.({ title }));
  wc.on("page-favicon-updated", (_e, favicons) => favicons[0] && hooks.onUpdate?.({ favicon: favicons[0] }));
  wc.on("did-start-loading", () => hooks.onState?.({ loading: true }));
  wc.on("did-stop-loading", () => hooks.onState?.({ loading: false }));
  wc.on("audio-state-changed", (event) => hooks.onState?.({ audible: event.audible }));
  wc.on("did-fail-load", (_e, code, description, failedUrl, isMainFrame) => {
    // -3 is "aborted": a new navigation replaced this one.
    if (!isMainFrame || code === -3) return;
    hooks.onFail?.({ code, description, url: failedUrl });
  });
  wc.on("render-process-gone", (_e, details) => hooks.onFail?.({ code: 0, description: `The page stopped (${details.reason}).`, url: wc.getURL() }));
  wc.on("found-in-page", (_e, result) => hooks.onFound?.(result));
  wc.on("context-menu", (_e, params) => pageMenu(wc, params, hooks).popup());
  wc.on("before-input-event", (event, input) => hooks.onInput?.(event, input));

  if (url) wc.loadURL(url).catch(() => {});
  return view;
}

function pageMenu(wc, p, hooks) {
  const items = [];
  if (p.linkURL && /^https?:/.test(p.linkURL)) {
    items.push(
      { label: "Open Link in New Tab", click: () => hooks.openTab?.(p.linkURL, { background: true }) },
      { label: "Open Link in Glance", click: () => hooks.glance?.(p.linkURL) },
      { label: "Open Link in Split View", click: () => hooks.splitWith?.(p.linkURL) },
      { label: "Copy Link", click: () => clipboard.writeText(p.linkURL) },
      { type: "separator" },
    );
  }
  if (p.mediaType === "image" && p.srcURL) {
    items.push(
      { label: "Open Image in New Tab", click: () => hooks.openTab?.(p.srcURL, { background: true }) },
      { label: "Save Image As…", click: () => wc.downloadURL(p.srcURL) },
      { label: "Copy Image", click: () => wc.copyImageAt(p.x, p.y) },
      { label: "Copy Image Address", click: () => clipboard.writeText(p.srcURL) },
      { type: "separator" },
    );
  }
  if (p.isEditable) {
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 4)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      if (p.dictionarySuggestions.length) items.push({ type: "separator" });
    }
    items.push({ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }, { type: "separator" });
  } else if (p.selectionText) {
    items.push({ role: "copy" }, { type: "separator" });
  }
  if (!p.linkURL && !p.isEditable && !p.selectionText && p.mediaType === "none") {
    const h = wc.navigationHistory;
    items.push(
      { label: "Back", enabled: h.canGoBack(), click: () => h.goBack() },
      { label: "Forward", enabled: h.canGoForward(), click: () => h.goForward() },
      { label: "Reload", click: () => wc.reload() },
      { type: "separator" },
      { label: "Save Page As…", click: () => wc.downloadURL(wc.getURL()) },
      { label: "Print…", click: () => wc.print() },
      { type: "separator" },
    );
  }
  items.push(...(hooks.menuExtras?.() ?? []));
  items.push({ label: "Inspect", click: () => wc.inspectElement(p.x, p.y) });
  return Menu.buildFromTemplate(items);
}

export const openExternal = (url) => /^(mailto|tel|https?):/.test(url) && shell.openExternal(url);

// Same site as the address a pinned tab was pinned with.
export const sameSite = (a, b) => siteOf(a) === siteOf(b);
