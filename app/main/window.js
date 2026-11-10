// One Archium window: the window UI (sidebar, command bar, Glance frame) in a transparent
// view that fills the window, and the active tab's view in the card rectangle that the UI
// reports. Split view shows up to four tab views side by side.
//
// Stacking, bottom to top:
//   normal   UI, tabs                 – the page is live and clickable
//   overlay  tabs, UI                 – the UI draws over the page (command bar, compact sidebar,
//                                       drag targets); its background has a hole where the page is
//   glance   tabs, UI, glance view    – the UI dims the page and frames the Glance card
import { BaseWindow, WebContentsView, nativeTheme } from "electron";
import { fileURLToPath } from "node:url";

const PRELOAD = fileURLToPath(new URL("../preload/chrome.cjs", import.meta.url));
const GAP = 8;

export class ArchiumWindow {
  constructor(hub, { model, isPrivate = false, spaceId, bounds, uiSession }) {
    this.hub = hub;
    this.model = model;
    this.isPrivate = isPrivate;
    this.spaceId = spaceId ?? model.data.activeSpace;
    this.activeTab = null;
    this.rect = null; // the card, in window coordinates, as the UI last reported it
    this.radius = 10;
    this.ratios = null; // split widths
    this.overlay = false;
    this.glance = null; // { view, sourceId, rect }
    this.findOpen = false;

    const mac = process.platform === "darwin";
    this.base = new BaseWindow({
      width: bounds?.width ?? 1280,
      height: bounds?.height ?? 820,
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: isPrivate ? "Archium (Private)" : "Archium",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1b1f" : "#ecebf2",
      ...(mac ? { titleBarStyle: "hidden", trafficLightPosition: { x: 16, y: 16 } } : { frame: false }),
      autoHideMenuBar: true,
    });
    this.base.setMenuBarVisibility?.(false);
    // Glass window buttons are drawn by the UI; hide the system ones before the first paint.
    if (mac && hub.settings.windowButtons !== "native") this.base.setWindowButtonVisibility(false);

    this.ui = new WebContentsView({
      webPreferences: { session: uiSession, preload: PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    this.ui.setBackgroundColor("#00000000");
    this.base.contentView.addChildView(this.ui);
    this.fitUi();
    this.ui.webContents.loadURL(`archium://chrome/${isPrivate ? "?private=1" : ""}`);
    this.ui.webContents.on("before-input-event", (event, input) => hub.onInput(this, event, input, this.ui.webContents));
    this.ui.webContents.on("will-navigate", (e) => e.preventDefault());
    this.ui.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.ui.webContents.once("did-finish-load", () => {
      this.base.show();
      hub.pushState(this);
    });

    this.base.on("resize", () => this.fitUi());
    this.base.on("enter-full-screen", () => hub.pushState(this));
    this.base.on("leave-full-screen", () => hub.pushState(this));
    this.base.on("focus", () => {
      hub.onFocus(this);
      hub.pushState(this);
    });
    this.base.on("blur", () => hub.pushState(this));
    this.base.on("closed", () => hub.onClosed(this));
  }

  get closed() {
    return this.base.isDestroyed();
  }

  fitUi() {
    const { width, height } = this.base.getContentBounds();
    this.ui.setBounds({ x: 0, y: 0, width, height });
  }

  send(channel, ...args) {
    if (!this.closed && !this.ui.webContents.isDestroyed()) this.ui.webContents.send(channel, ...args);
  }

  // Tabs shown right now: the active tab, or its whole split group.
  visibleTabs() {
    if (!this.activeTab) return [];
    const group = this.model.splitOf(this.activeTab);
    return group ? [...group] : [this.activeTab];
  }

  // Puts every view where it belongs. Views of tabs that aren't visible are taken out of
  // the window (they keep running) and the rest are re-added in stacking order.
  apply() {
    if (this.closed) return;
    const content = this.base.contentView;
    const visible = this.visibleTabs()
      .map((id) => ({ id, entry: this.hub.views.get(id) }))
      .filter(({ entry }) => entry && entry.win === this);
    const wanted = new Set(visible.map(({ entry }) => entry.view));
    if (this.glance) wanted.add(this.glance.view);
    for (const child of [...content.children]) {
      if (child !== this.ui && !wanted.has(child)) content.removeChildView(child);
    }
    const order = this.overlay || this.glance ? [...visible.map((v) => v.entry.view), this.ui] : [this.ui, ...visible.map((v) => v.entry.view)];
    if (this.glance) order.push(this.glance.view);
    for (const view of order) content.addChildView(view);
    this.layout(visible);
  }

  layout(visible = this.visibleTabs().map((id) => ({ id, entry: this.hub.views.get(id) })).filter((v) => v.entry?.win === this)) {
    if (!this.rect) return;
    const { x, y, width, height } = this.rect;
    const n = visible.length;
    if (n) {
      const ratios = this.ratios?.length === n ? this.ratios : Array(n).fill(1 / n);
      const usable = width - GAP * (n - 1);
      let left = x;
      visible.forEach(({ entry }, i) => {
        const w = i === n - 1 ? x + width - left : Math.round(usable * ratios[i]);
        entry.view.setBounds({ x: Math.round(left), y: Math.round(y), width: Math.max(0, Math.round(w)), height: Math.round(height) });
        entry.view.setBorderRadius(this.radius);
        left += w + GAP;
      });
    }
    if (this.glance?.rect) {
      this.glance.view.setBounds(this.glance.rect);
      this.glance.view.setBorderRadius(this.radius + 2);
    }
  }

  setRect(rect, radius) {
    this.rect = rect;
    if (Number.isFinite(radius)) this.radius = radius;
    this.layout();
  }

  setOverlay(on) {
    if (this.overlay === Boolean(on)) return;
    this.overlay = Boolean(on);
    this.apply();
  }

  // The visible page(s), for the glass behind the command bar.
  async snapshot() {
    const shots = [];
    for (const id of this.visibleTabs()) {
      const entry = this.hub.views.get(id);
      if (!entry || entry.win !== this) continue;
      try {
        const image = await entry.view.webContents.capturePage();
        const b = entry.view.getBounds();
        shots.push({ ...b, src: image.resize({ width: Math.max(1, Math.round(b.width / 2)) }).toDataURL() });
      } catch {
        // A crashed or loading page has nothing to capture.
      }
    }
    return shots;
  }

  focusPage() {
    const entry = this.activeTab && this.hub.views.get(this.activeTab);
    if (entry?.win === this) entry.view.webContents.focus();
  }

  focusUi() {
    this.ui.webContents.focus();
  }
}
