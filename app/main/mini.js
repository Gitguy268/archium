// Little Archium: a small window for links from other apps (Arc's Little Arc). A slim bar on
// top, the page below, and one click moves the page into your main window as a tab.
import { BaseWindow, WebContentsView, clipboard } from "electron";
import { fileURLToPath } from "node:url";
import { createWebView } from "./tabs.js";

const PRELOAD = fileURLToPath(new URL("../preload/chrome.cjs", import.meta.url));
const BAR = 44;

export class MiniWindow {
  constructor(hub, url) {
    this.hub = hub;
    const mac = process.platform === "darwin";
    this.base = new BaseWindow({
      width: 960,
      height: 680,
      minWidth: 420,
      minHeight: 300,
      show: false,
      title: "Little Archium",
      ...(mac ? { titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 15 } } : { frame: false }),
      autoHideMenuBar: true,
    });
    this.glassLights = mac && hub.settings.windowButtons !== "native";
    if (this.glassLights) this.base.setWindowButtonVisibility(false);
    this.ui = new WebContentsView({ webPreferences: { session: hub.uiSession, preload: PRELOAD, sandbox: true, contextIsolation: true } });
    this.ui.setBackgroundColor("#00000000");
    this.ui.webContents.loadURL("archium://mini/");
    this.ui.webContents.on("will-navigate", (e) => e.preventDefault());
    this.base.contentView.addChildView(this.ui);

    const hooks = {
      openTab: (target) => hub.openExternalLink(target),
      onNavigate: (target) => this.push({ url: target }),
      onUpdate: (patch) => this.push(patch),
      onState: (patch) => this.push(patch),
      onFail: (info) => hub.showError(this.view.webContents, info),
    };
    this.hooks = hooks;
    this.view = createWebView({ session: hub.session("persist:archium"), url: url || "about:blank", hooks });
    hub.watchBoosts(this.view.webContents);
    this.base.contentView.addChildView(this.view);
    this.fit();
    this.base.on("resize", () => this.fit());
    this.base.on("focus", () => this.push({ focused: true }));
    this.base.on("blur", () => this.push({ focused: false }));
    this.base.on("enter-full-screen", () => this.push({ fullscreen: true }));
    this.base.on("leave-full-screen", () => this.push({ fullscreen: false }));
    this.base.on("closed", () => {
      hub.minis.delete(this);
      if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    });
    this.ui.webContents.once("did-finish-load", () => {
      this.base.show();
      this.push({ url: this.view.webContents.getURL() || url, glassLights: this.glassLights, focused: this.base.isFocused() });
    });
    hub.minis.add(this);
  }

  fit() {
    const { width, height } = this.base.getContentBounds();
    this.ui.setBounds({ x: 0, y: 0, width, height });
    this.view?.setBounds({ x: 6, y: BAR, width: width - 12, height: height - BAR - 6 });
    this.view?.setBorderRadius(8);
  }

  push(patch) {
    if (!this.ui.webContents.isDestroyed()) this.ui.webContents.send("archium:mini-state", { ...patch, platform: process.platform });
  }

  nav(action) {
    const wc = this.view.webContents;
    if (action?.load && /^https?:/.test(action.load)) wc.loadURL(action.load).catch(() => {});
    else if (action === "back") wc.navigationHistory.goBack();
    else if (action === "reload") wc.reload();
  }

  copy() {
    clipboard.writeText(this.view.webContents.getURL());
  }

  // The page becomes a Today tab in the main window, without reloading.
  moveToMain() {
    const hub = this.hub;
    const win = hub.mainWindow() ?? hub.createWindow();
    const wc = this.view.webContents;
    const tab = hub.model.newTab(win.spaceId, wc.getURL(), { title: wc.getTitle(), select: false });
    Object.assign(this.hooks, hub.tabHooks(tab.id));
    this.base.contentView.removeChildView(this.view);
    hub.views.set(tab.id, { view: this.view, win, model: hub.model, runtime: { loading: wc.isLoading(), blocked: 0 } });
    this.view = null;
    this.base.close();
    hub.activate(win, tab.id);
    win.base.focus();
  }
}
