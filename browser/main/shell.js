// One browser window: the toolbar page (archium://app/chrome.html) fills the window, the
// active tab's page sits in the rectangle the toolbar reports, and the assistant panel
// sits beside it. Only the active tab's view is attached; the rest stay alive off-screen.
import { BaseWindow, WebContentsView, Menu, clipboard, nativeImage } from "electron";
import { fileURLToPath } from "node:url";
import { fallbackUrl } from "../../extension/lib.js";
import { sessions, blockedCount, resetBlocked, proxyStatus, noteLoadError, clearProxyError } from "./sessions.js";
import { getSettings, getBookmarks, addHistory } from "./store.js";
import { EXTRACT } from "./page-text.js";
import { toUrl } from "./url.js";

export { toUrl };

export const PRELOAD = fileURLToPath(new URL("../preload/archium.cjs", import.meta.url));
export const NEWTAB = "archium://newtab/";

let liquidGlass = null;
try {
  liquidGlass = (await import("electron-liquid-glass")).default;
} catch {
  // Optional dependency: without it the Liquid Glass look uses macOS vibrancy.
}
export const nativeGlass = () => Boolean(liquidGlass?.isGlassSupported?.());
export const addNativeGlass = (win, cornerRadius) => liquidGlass.addView(win.getNativeWindowHandle(), { cornerRadius });

let nextTabId = 1;

const securePrefs = (extra) => ({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: false,
  safeDialogs: true,
  ...extra,
});

export class Shell {
  constructor({ urls = [], onClosed }) {
    this.tabs = [];
    this.activeId = null;
    this.closedTabs = [];
    this.layout = { page: { x: 0, y: 80, width: 800, height: 600 }, panel: null };
    this.overlay = false;
    this.focusMode = false;
    this.assistantOpen = false;
    this.assistant = null;
    this.glassId = null;
    this.hoverUrl = "";

    this.win = new BaseWindow({
      width: 1280,
      height: 840,
      minWidth: 560,
      minHeight: 380,
      title: "Archium",
      show: false,
      // Transparent so the Liquid Glass look can put native glass behind the toolbar.
      transparent: true,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 13 },
    });
    this.ui = new WebContentsView({ webPreferences: securePrefs({ session: sessions.ui, preload: PRELOAD, spellcheck: false }) });
    this.ui.setBackgroundColor("#00000000");
    this.win.contentView.addChildView(this.ui);
    this.fitUi();
    this.guard(this.ui.webContents);
    this.ui.webContents.loadURL("archium://app/chrome.html");
    this.ui.webContents.once("did-finish-load", () => {
      this.applyMaterial();
      this.win.show();
    });

    this.win.on("resize", () => this.fitUi());
    this.win.on("closed", () => {
      for (const tab of this.tabs) tab.view.webContents.close();
      this.assistant?.webContents.close();
      this.ui.webContents.close();
      onClosed(this);
    });

    if (urls.length) for (const url of urls) this.createTab(url, { background: true });
    else this.createTab(NEWTAB);
    if (!this.activeId) this.activate(this.tabs[0].id);
  }

  // Archium's own pages may never navigate away or open windows.
  guard(wc) {
    wc.on("will-navigate", (e, url) => {
      if (!url.startsWith("archium://app/")) e.preventDefault();
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) this.createTab(url);
      return { action: "deny" };
    });
  }

  fitUi() {
    const { width, height } = this.win.getContentBounds();
    this.ui.setBounds({ x: 0, y: 0, width, height });
    if (this.fullscreenTab) this.fullscreenTab.view.setBounds({ x: 0, y: 0, width, height });
  }

  get active() {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  owns(wc) {
    return wc === this.ui.webContents || wc === this.assistant?.webContents;
  }

  // --- tabs -----------------------------------------------------------------

  createTab(url = NEWTAB, { private: isPrivate = false, background = false, index } = {}) {
    const view = new WebContentsView({
      webPreferences: securePrefs({ session: isPrivate ? sessions.private : sessions.tabs, spellcheck: true }),
    });
    const tab = { id: nextTabId++, view, private: isPrivate, title: "New Tab", url, favicon: "", loading: true };
    const wc = view.webContents;

    wc.on("page-title-updated", (_, title) => {
      tab.title = title;
      if (!tab.private) addHistory({ url: tab.url, title });
      this.push();
    });
    wc.on("page-favicon-updated", (_, favicons) => {
      tab.favicon = favicons.find((f) => /^(https?|data):/.test(f)) ?? "";
      this.push();
    });
    wc.on("did-start-loading", () => {
      tab.loading = true;
      this.push();
    });
    wc.on("did-stop-loading", () => {
      tab.loading = false;
      this.push();
    });
    // The new tab page is transparent so the window's look shows through; everything else,
    // error pages included, gets white. Set when a navigation starts, since a failed one never commits.
    wc.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) view.setBackgroundColor(details.url.startsWith(NEWTAB) ? "#00000000" : "#ffffff");
    });
    wc.on("did-navigate", (_, navUrl) => {
      tab.url = navUrl;
      tab.favicon = "";
      resetBlocked(wc.id);
      clearProxyError();
      if (!tab.private) addHistory({ url: navUrl, title: wc.getTitle() });
      this.push();
    });
    wc.on("did-navigate-in-page", (_, navUrl, isMainFrame) => {
      if (!isMainFrame) return;
      tab.url = navUrl;
      if (!tab.private) addHistory({ url: navUrl, title: wc.getTitle() });
      this.push();
    });
    wc.on("did-fail-load", (_, code, description, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      // Local SearXNG isn't running: the same search goes to the public instance.
      const fallback = fallbackUrl(failedUrl, getSettings());
      if (fallback) return void wc.loadURL(fallback);
      // Show the address that failed, like other browsers, so it can be retried or edited.
      tab.url = failedUrl;
      noteLoadError(code);
      this.push();
    });
    wc.on("update-target-url", (_, target) => {
      if (tab.id !== this.activeId) return;
      this.hoverUrl = target;
      this.push();
    });
    wc.on("found-in-page", (_, result) => this.ui.webContents.send("found", result));
    wc.setWindowOpenHandler(({ url: target, disposition }) => {
      if (/^(https?|archium):/.test(target)) {
        const at = this.tabs.indexOf(tab) + 1;
        this.createTab(target, { private: tab.private, background: disposition === "background-tab", index: at });
      }
      return { action: "deny" };
    });
    wc.on("context-menu", (_, params) => this.contextMenu(tab, params));
    wc.on("enter-html-full-screen", () => {
      this.fullscreenTab = tab;
      this.win.setFullScreen(true);
      this.fitUi();
    });
    wc.on("leave-html-full-screen", () => {
      this.fullscreenTab = null;
      this.win.setFullScreen(false);
      this.place();
    });

    view.setBackgroundColor(url.startsWith(NEWTAB) ? "#00000000" : "#ffffff");
    if (index == null) this.tabs.push(tab);
    else this.tabs.splice(index, 0, tab);
    wc.loadURL(url).catch(() => {});
    if (!background || !this.activeId) this.activate(tab.id);
    else this.push();
    return tab;
  }

  activate(id) {
    const next = this.tabs.find((t) => t.id === id);
    if (!next) return;
    const previous = this.active;
    if (previous && previous !== next) this.win.contentView.removeChildView(previous.view);
    this.activeId = id;
    this.hoverUrl = "";
    this.stack();
    this.place();
    if (!this.overlay) next.view.webContents.focus();
    this.push();
  }

  closeTab(id = this.activeId) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [tab] = this.tabs.splice(i, 1);
    if (!tab.private) this.closedTabs.push(tab.url);
    this.win.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    if (!this.tabs.length) return void this.win.close();
    if (id === this.activeId) {
      this.activeId = null;
      this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    } else this.push();
  }

  reopenTab() {
    const url = this.closedTabs.pop();
    if (url) this.createTab(url);
  }

  cycle(step) {
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    const next = this.tabs[(i + step + this.tabs.length) % this.tabs.length];
    if (next) this.activate(next.id);
  }

  moveTab(id, to) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0 || to < 0 || to >= this.tabs.length) return;
    const [tab] = this.tabs.splice(i, 1);
    this.tabs.splice(to, 0, tab);
    this.push();
  }

  navigate(text) {
    const url = toUrl(text, getSettings());
    if (!url) return;
    const tab = this.active ?? this.createTab(url);
    tab.view.webContents.loadURL(url).catch(() => {});
    tab.view.webContents.focus();
  }

  // --- layout ---------------------------------------------------------------

  // Bottom to top: toolbar page, active tab, assistant. During an overlay (⌘K, menus,
  // settings) the toolbar page goes on top: its transparent parts show the page beneath.
  stack() {
    const views = this.win.contentView;
    const tab = this.active;
    if (this.overlay) {
      views.addChildView(this.ui);
      return;
    }
    if (tab) views.addChildView(tab.view);
    if (this.assistant && this.assistantOpen) views.addChildView(this.assistant);
  }

  setLayout(layout) {
    const ok = (r) => r && [r.x, r.y, r.width, r.height].every(Number.isFinite);
    if (!ok(layout?.page)) return;
    this.layout = { page: layout.page, panel: ok(layout.panel) ? layout.panel : null };
    this.place();
  }

  place() {
    if (this.fullscreenTab) return;
    const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) });
    this.active?.view.setBounds(round(this.layout.page));
    // Liquid Glass frames the page with rounded corners; the other looks keep it square.
    this.active?.view.setBorderRadius?.(getSettings().theme === "glass" && !this.focusMode ? 12 : 0);
    if (this.assistant && this.layout.panel) this.assistant.setBounds(round(this.layout.panel));
  }

  setOverlay(open) {
    this.overlay = Boolean(open);
    if (!this.overlay) this.win.contentView.addChildView(this.ui, 0);
    this.stack();
    if (this.overlay) this.ui.webContents.focus();
    else this.active?.view.webContents.focus();
  }

  toggleAssistant(force) {
    this.assistantOpen = force ?? !this.assistantOpen;
    if (this.assistantOpen && !this.assistant) {
      this.assistant = new WebContentsView({ webPreferences: securePrefs({ session: sessions.ai, preload: PRELOAD, spellcheck: true }) });
      this.assistant.setBackgroundColor("#00000000");
      this.guard(this.assistant.webContents);
      this.assistant.webContents.on("did-finish-load", () => this.push());
      this.assistant.webContents.loadURL("archium://app/assistant.html");
    }
    if (this.assistantOpen) this.stack();
    else if (this.assistant) this.win.contentView.removeChildView(this.assistant);
    this.push();
    if (this.assistantOpen) setTimeout(() => this.assistant?.webContents.focus(), 50);
  }

  ask(action) {
    this.toggleAssistant(true);
    const send = () => this.assistant.webContents.send("ask", action);
    if (this.assistant.webContents.isLoading()) this.assistant.webContents.once("did-finish-load", send);
    else send();
  }

  setFocusMode(on = !this.focusMode) {
    this.focusMode = on;
    this.push();
  }

  // --- look -----------------------------------------------------------------

  // Liquid Glass puts native NSGlassEffectView glass (macOS 26+) behind the window's
  // content, or vibrancy on older macOS. The glass can't be removed once added, so the
  // other looks simply paint over it.
  applyMaterial() {
    const glass = getSettings().theme === "glass";
    // Windows 98 draws its own caption buttons.
    this.win.setWindowButtonVisibility(getSettings().theme !== "win98" || this.win.isFullScreen());
    if (glass && nativeGlass()) {
      if (this.glassId == null) {
        this.glassId = addNativeGlass(this.win, 0);
      }
    } else this.win.setVibrancy(glass ? "under-window" : null);
  }

  // --- page tools -----------------------------------------------------------

  async pageText() {
    const tab = this.active;
    if (!tab) throw new Error("No page is open.");
    if (tab.private) throw new Error("Private tabs are never read by the assistant.");
    if (!/^https?:/.test(tab.url)) throw new Error("Open a web page first.");
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: EXTRACT }]);
  }

  async capture() {
    const tab = this.active;
    if (!tab) throw new Error("No page is open.");
    if (tab.private) throw new Error("Private tabs are never read by the assistant.");
    let image = await tab.view.webContents.capturePage();
    const { width } = image.getSize();
    if (width > 1024) image = image.resize({ width: 1024, quality: "good" });
    return { jpeg: image.toJPEG(82), title: tab.title, url: tab.url };
  }

  contextMenu(tab, p) {
    const wc = tab.view.webContents;
    const items = [];
    if (p.linkURL && /^https?:/.test(p.linkURL)) {
      items.push(
        { label: "Open Link in New Tab", click: () => this.createTab(p.linkURL, { private: tab.private, background: true, index: this.tabs.indexOf(tab) + 1 }) },
        { label: "Open Link in Private Tab", click: () => this.createTab(p.linkURL, { private: true }) },
        { label: "Copy Link", click: () => clipboard.writeText(p.linkURL) },
        { type: "separator" },
      );
    }
    if (p.mediaType === "image" && p.srcURL) {
      items.push({ label: "Copy Image", click: () => wc.copyImageAt(p.x, p.y) }, { label: "Open Image in New Tab", click: () => this.createTab(p.srcURL) }, { type: "separator" });
    }
    if (p.selectionText) {
      items.push(
        { role: "copy" },
        { label: `Search for “${p.selectionText.slice(0, 24)}${p.selectionText.length > 24 ? "…" : ""}”`, click: () => this.createTab(toUrl(p.selectionText, getSettings()), { private: tab.private }) },
        { label: "Ask the Assistant", click: () => this.ask({ kind: "selection", text: p.selectionText.slice(0, 4000) }) },
        { type: "separator" },
      );
    }
    if (p.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }, { type: "separator" });
    items.push(
      { label: "Back", enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: "Forward", enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: "Reload", click: () => wc.reload() },
      { type: "separator" },
      { label: "Summarize Page", enabled: !tab.private, click: () => this.ask({ kind: "summarize" }) },
      { label: "Inspect", click: () => wc.inspectElement(p.x, p.y) },
    );
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  // --- state ----------------------------------------------------------------

  snapshot() {
    const tab = this.active;
    const wc = tab?.view.webContents;
    const s = getSettings();
    return {
      tabs: this.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, favicon: t.favicon, loading: t.loading, private: t.private })),
      activeId: this.activeId,
      url: tab?.url.startsWith(NEWTAB) ? "" : tab?.url ?? "",
      canBack: wc?.navigationHistory.canGoBack() ?? false,
      canForward: wc?.navigationHistory.canGoForward() ?? false,
      bookmarked: Boolean(tab && getBookmarks().some((b) => b.url === tab.url)),
      blocked: wc ? blockedCount(wc.id) : 0,
      hoverUrl: this.hoverUrl,
      zoom: wc ? Math.round(wc.getZoomFactor() * 100) : 100,
      status: proxyStatus(),
      focusMode: this.focusMode,
      assistantOpen: this.assistantOpen,
      fullscreen: this.win.isFullScreen(),
      settings: {
        theme: s.theme,
        tabs: s.tabs,
        mode: s.mode,
        torPort: s.torPort,
        proxyScheme: s.proxyScheme,
        proxyHost: s.proxyHost,
        proxyPort: s.proxyPort,
        blockWebRTC: s.blockWebRTC,
        adblock: s.adblock,
        restoreSession: s.restoreSession,
        localSearch: s.localSearch,
        publicSearch: s.publicSearch,
      },
      nativeGlass: nativeGlass(),
    };
  }

  // Coalesced: many page events in one tick send one update.
  push() {
    if (this.pushQueued) return;
    this.pushQueued = true;
    setImmediate(() => {
      this.pushQueued = false;
      if (this.ui.webContents.isDestroyed()) return;
      const state = this.snapshot();
      this.ui.webContents.send("state", state);
      if (this.assistant && !this.assistant.webContents.isDestroyed()) this.assistant.webContents.send("state", state);
    });
  }

  // Theme change: the window material, the toolbar, and every new tab page follow.
  refreshLook() {
    this.applyMaterial();
    this.place();
    for (const t of this.tabs) if (t.url.startsWith(NEWTAB)) t.view.webContents.reload();
    this.push();
  }

  sessionUrls() {
    return this.tabs.filter((t) => !t.private && /^https?:/.test(t.url)).map((t) => t.url);
  }

  setZoom(delta) {
    const wc = this.active?.view.webContents;
    if (!wc) return;
    const levels = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    const now = wc.getZoomFactor();
    const i = levels.findIndex((l) => l >= now - 0.001);
    wc.setZoomFactor(delta === 0 ? 1 : levels[Math.max(0, Math.min(levels.length - 1, (i < 0 ? 5 : i) + delta))]);
    this.push();
  }
}

export const icon = () => nativeImage.createFromPath(fileURLToPath(new URL("../../branding/logo-512.png", import.meta.url)));
