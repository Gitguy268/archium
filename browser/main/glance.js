// Glance: a small always-on-top browser in the screen corner for a quick lookup while
// you work in another app (the idea comes from nuance-dev/Web). ⌃⌥Space shows or hides it;
// it hides when it loses focus unless pinned, and "Open in tab" moves the page to a window.
import { BaseWindow, WebContentsView, screen } from "electron";
import { sessions } from "./sessions.js";
import { getSettings, addHistory } from "./store.js";
import { PRELOAD, toUrl, nativeGlass, addNativeGlass } from "./shell.js";

const WIDTH = 440;
const HEIGHT = 640;
const MARGIN = 16;

export class Glance {
  constructor({ openInTab }) {
    this.openInTab = openInTab;
    this.pinned = false;
    this.win = null;
    this.headerHeight = 52;
    this.url = "";
  }

  create() {
    this.win = new BaseWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      // An NSPanel takes the keyboard without bringing Archium's other windows forward.
      type: "panel",
      frame: false,
      transparent: true,
      resizable: true,
      minWidth: 320,
      minHeight: 360,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      hasShadow: true,
      roundedCorners: true,
    });
    this.win.setAlwaysOnTop(true, "floating");
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    this.ui = new WebContentsView({
      webPreferences: { session: sessions.ui, preload: PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.ui.setBackgroundColor("#00000000");
    this.ui.webContents.on("will-navigate", (e) => e.preventDefault());
    this.ui.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.ui.webContents.loadURL("archium://app/glance.html");

    this.page = new WebContentsView({
      webPreferences: { session: sessions.tabs, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, safeDialogs: true },
    });
    this.page.setBackgroundColor("#ffffff");
    const wc = this.page.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) wc.loadURL(url);
      return { action: "deny" };
    });
    wc.on("did-navigate", (_, url) => {
      this.url = url;
      addHistory({ url, title: wc.getTitle() });
      this.push();
    });
    wc.on("did-navigate-in-page", (_, url, main) => {
      if (main) this.url = url;
      this.push();
    });
    wc.on("page-title-updated", () => this.push());
    wc.on("did-start-loading", () => this.push());
    wc.on("did-stop-loading", () => this.push());

    this.win.contentView.addChildView(this.ui);
    this.win.on("resize", () => this.place());
    this.win.on("blur", () => {
      // Showing from another app can blur once on the way in; only later blurs hide it.
      if (!this.pinned && Date.now() - this.shownAt > 400) this.hide();
    });
    this.win.on("closed", () => {
      this.win = null;
    });
    this.place();
    this.applyMaterial();
  }

  owns(wc) {
    return this.win && wc === this.ui.webContents;
  }

  place() {
    const { width, height } = this.win.getContentBounds();
    this.ui.setBounds({ x: 0, y: 0, width, height });
    if (this.url) this.page.setBounds({ x: 6, y: this.headerHeight, width: width - 12, height: height - this.headerHeight - 6 });
  }

  // Top-right corner of the screen the pointer is on.
  corner() {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { width } = this.win.getBounds();
    this.win.setPosition(Math.round(workArea.x + workArea.width - width - MARGIN), Math.round(workArea.y + MARGIN));
  }

  toggle() {
    // One key press can arrive twice (menu and global shortcut); the second must not undo the first.
    if (Date.now() - (this.toggledAt ?? 0) < 300) return;
    this.toggledAt = Date.now();
    if (this.win?.isVisible() && this.win.isFocused()) return this.hide();
    this.show();
  }

  show() {
    if (!this.win) this.create();
    if (!this.pinned) this.corner();
    this.shownAt = Date.now();
    this.win.show();
    this.win.focus();
    this.ui.webContents.focus();
    this.ui.webContents.send("command", "focus-address");
    this.push();
  }

  hide() {
    this.win?.hide();
  }

  navigate(text) {
    const url = toUrl(text, getSettings());
    if (!url) return;
    if (!this.url) this.win.contentView.addChildView(this.page);
    this.url = url;
    this.place();
    this.page.webContents.loadURL(url).catch(() => {});
    this.page.webContents.focus();
  }

  moveToTab() {
    if (!this.url) return;
    this.openInTab(this.url);
    this.reset();
    this.hide();
  }

  reset() {
    this.url = "";
    this.win.contentView.removeChildView(this.page);
    this.page.webContents.loadURL("about:blank").catch(() => {});
    this.push();
  }

  setPinned(pinned) {
    this.pinned = Boolean(pinned);
    this.push();
  }

  applyMaterial() {
    if (!this.win) return;
    const glass = getSettings().theme === "glass";
    if (glass && nativeGlass()) {
      if (this.glassId == null) this.glassId = addNativeGlass(this.win, 18);
    } else this.win.setVibrancy(glass ? "hud" : null);
  }

  refreshLook() {
    this.applyMaterial();
    this.push();
  }

  push() {
    if (!this.win || this.ui.webContents.isDestroyed()) return;
    const wc = this.page.webContents;
    this.ui.webContents.send("state", {
      glance: true,
      url: this.url,
      title: this.url ? wc.getTitle() : "",
      loading: this.url ? wc.isLoading() : false,
      canBack: this.url ? wc.navigationHistory.canGoBack() : false,
      pinned: this.pinned,
      settings: { theme: getSettings().theme },
      nativeGlass: nativeGlass(),
    });
  }

  handle(command, arg) {
    const wc = this.page.webContents;
    switch (command) {
      case "navigate":
        return this.navigate(String(arg ?? ""));
      case "back":
        return wc.navigationHistory.canGoBack() ? wc.navigationHistory.goBack() : this.reset();
      case "reload":
        return wc.reload();
      case "pin":
        return this.setPinned(arg);
      case "open-in-tab":
        return this.moveToTab();
      case "hide":
        return this.hide();
      case "header":
        if (Number.isFinite(arg)) this.headerHeight = Math.round(arg);
        return this.place();
      case "ready":
        return this.push();
    }
  }
}
