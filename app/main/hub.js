// The running browser: the model, every loaded tab view, the windows, history and downloads.
// The window UI (ipc.js), the menu, the archium:// pages, the CLI and agents (control.js) all
// act through these methods, so they behave the same whichever one asks.
import { app, Menu, clipboard, session as electronSession, shell } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { Model, emptyState } from "./model.js";
import { ArchiumWindow } from "./window.js";
import { createWebView, wasClicked, sameSite } from "./tabs.js";
import { handleScheme, isArchiumUrl } from "./protocol.js";
import { prepareSession, partitionFor } from "./privacy/sessions.js";
import { hostOf } from "./privacy/filter.js";
import { Boosts } from "./boosts.js";
import { toUrl } from "../ui/shared/omni.js";

const WEB_PRELOAD = fileURLToPath(new URL("../preload/web.cjs", import.meta.url));
const HISTORY_LIMIT = 20000;

export class Hub {
  constructor({ stores }) {
    this.stores = stores;
    this.model = new Model(stores.state.data);
    stores.state.data = this.model.data;
    this.model.data.lastTab ??= {};
    this.model.onChange(() => {
      stores.state.save();
      this.schedulePush();
    });
    this.views = new Map(); // tab id → { view, win, model, runtime }
    this.windows = new Set();
    this.minis = new Set();
    this.lastFocused = null;
    this.prepared = new Set();
    this.pendingPermissions = new Map();
    this.privateCount = 0;
    this.pushTimer = null;
    this.boosts = new Boosts(stores.boosts);
    this.uiSession = electronSession.fromPartition("archium-ui");
    handleScheme(this.uiSession, { chrome: true });
  }

  get settings() {
    return this.stores.settings.data;
  }

  saveSettings(patch = {}) {
    Object.assign(this.settings, patch);
    this.stores.settings.save();
    this.schedulePush();
  }

  // ---- sessions ----

  session(partition) {
    const ses = electronSession.fromPartition(partition);
    if (this.prepared.has(ses)) return ses;
    this.prepared.add(ses);
    prepareSession(ses, {
      getSettings: () => this.settings,
      askPermission: (req) => this.askPermission(req),
      onBlocked: (details) => this.countBlocked(details),
      preload: WEB_PRELOAD,
    });
    handleScheme(ses);
    ses.on("will-download", (_e, item, wc) => this.onDownload(item, wc, partition.startsWith("persist:") === false));
    return ses;
  }

  sessionForTab(model, id) {
    if (model.private) return this.session(model.partition);
    const where = model.locate(id);
    return this.session(partitionFor(where?.spaceId ? model.space(where.spaceId) : null));
  }

  // ---- windows ----

  createWindow({ isPrivate = false, spaceId, bounds } = {}) {
    let model = this.model;
    if (isPrivate) {
      model = new Model(emptyState());
      Object.assign(model.data.spaces[0], { name: "Private", icon: "◐", colors: [[40, 40, 52], [88, 72, 140]] });
      model.data.lastTab = {};
      model.private = true;
      model.partition = `archium-private-${++this.privateCount}`;
      model.onChange(() => this.schedulePush());
    }
    const win = new ArchiumWindow(this, { model, isPrivate, spaceId, bounds, uiSession: this.uiSession });
    this.windows.add(win);
    this.lastFocused = win;
    const last = model.data.lastTab?.[win.spaceId];
    if (last && model.tab(last)) this.activate(win, last, { focus: false });
    return win;
  }

  focusedWindow() {
    if (this.lastFocused && !this.lastFocused.closed) return this.lastFocused;
    return [...this.windows].find((w) => !w.closed && !w.isPrivate) ?? null;
  }

  mainWindow() {
    const normal = [...this.windows].filter((w) => !w.closed && !w.isPrivate);
    return normal.includes(this.lastFocused) ? this.lastFocused : normal[0] ?? null;
  }

  windowForUi(webContents) {
    return [...this.windows].find((w) => !w.closed && w.ui.webContents === webContents) ?? null;
  }

  onFocus(win) {
    this.lastFocused = win;
    if (!win.isPrivate && this.model.data.activeSpace !== win.spaceId) {
      this.model.data.activeSpace = win.spaceId;
      this.stores.state.save();
    }
  }

  onClosed(win) {
    this.windows.delete(win);
    for (const [id, entry] of [...this.views]) if (entry.win === win) this.destroyView(id);
    if (win.glance) win.glance.view.webContents.close();
    if (win.isPrivate) this.session(win.model.partition).clearStorageData().catch(() => {});
    if (this.lastFocused === win) this.lastFocused = null;
  }

  // ---- state for the window UI ----

  schedulePush() {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      for (const win of this.windows) this.pushState(win);
    }, 16);
  }

  pushState(win) {
    if (win.closed) return;
    win.send("archium:state", this.viewModel(win));
  }

  tabInfo(win, id) {
    const tab = win.model.tab(id);
    if (!tab) return null;
    const entry = this.views.get(id);
    return {
      id,
      url: tab.url,
      title: tab.title || hostOf(tab.url) || tab.url,
      favicon: tab.favicon,
      pinnedUrl: tab.pinnedUrl ?? null,
      loaded: Boolean(entry),
      elsewhere: Boolean(entry && entry.win !== win),
      loading: entry?.runtime.loading ?? false,
      audible: entry?.runtime.audible ?? false,
      muted: entry?.runtime.muted ?? false,
      canGoBack: entry?.runtime.canGoBack ?? false,
      canGoForward: entry?.runtime.canGoForward ?? false,
      blocked: entry?.runtime.blocked ?? 0,
    };
  }

  viewModel(win) {
    const m = win.model;
    const info = (id) => this.tabInfo(win, id);
    const s = this.settings;
    return {
      private: win.isPrivate,
      platform: process.platform,
      fullscreen: win.base.isFullScreen(),
      focused: win.base.isFocused(),
      spaces: m.spaces.map((sp) => ({
        id: sp.id,
        name: sp.name,
        icon: sp.icon,
        colors: sp.colors,
        profile: sp.profile,
        items: sp.items
          .map((item) =>
            item.type === "folder"
              ? { type: "folder", id: item.id, name: item.name, open: item.open, children: item.children.map((c) => info(c.id)).filter(Boolean) }
              : { type: "tab", ...info(item.id) },
          )
          .filter((i) => i.type === "folder" || i.id),
        today: sp.today.map(info).filter(Boolean),
      })),
      favourites: m.data.favourites.map(info).filter(Boolean),
      spaceId: win.spaceId,
      activeTab: win.activeTab,
      split: win.activeTab ? m.splitOf(win.activeTab) : null,
      glance: win.glance ? { url: win.glance.url, title: win.glance.title ?? "" } : null,
      archiveCount: m.data.archive.length,
      downloads: this.downloadSummary(),
      site: this.siteInfo(win),
      settings: {
        look: s.look,
        appearance: s.appearance,
        compact: s.compact,
        windowButtons: s.windowButtons,
        sidebarWidth: s.sidebarWidth,
        searchEngine: s.searchEngine,
        archiveAfterHours: s.archiveAfterHours,
        archivebox: Boolean(s.archivebox?.url),
      },
    };
  }

  siteInfo(win) {
    const tab = win.activeTab && win.model.tab(win.activeTab);
    const host = tab ? hostOf(tab.url) : "";
    const ex = this.settings.siteExceptions[host] ?? {};
    return { host, adblock: ex.adblock !== false, cookies: ex.cookies !== false };
  }

  // ---- tab views ----

  tabHooks(id) {
    const entry = () => this.views.get(id);
    const win = () => entry()?.win;
    return {
      openTab: (url, { background } = {}) => win() && this.newTab(win(), url, { background, after: id }),
      glance: (url) => win() && this.openGlance(win(), url, id),
      splitWith: (url) => win() && this.splitWith(win(), id, url),
      onNavigate: (url) => {
        const e = entry();
        if (!e || url.startsWith("archium://error")) return;
        e.model.update(id, { url });
        e.runtime.blocked = 0;
        if (!e.model.private) this.addHistory(url, e.model.tab(id)?.title ?? "");
        this.schedulePush();
      },
      onUpdate: (patch) => {
        const e = entry();
        if (!e) return;
        if (patch.favicon && /^https?:/.test(patch.favicon)) {
          this.fetchFavicon(e, id, patch.favicon);
          delete patch.favicon;
        }
        e.model.update(id, patch);
        if (patch.title && !e.model.private) this.updateHistoryTitle(e.model.tab(id)?.url, patch.title);
      },
      onState: (patch) => {
        const e = entry();
        if (!e) return;
        Object.assign(e.runtime, patch);
        this.schedulePush();
      },
      onFail: ({ code, description, url }) => this.showError(entry()?.view.webContents, { code, description, url }),
      onFound: (result) => win()?.send("archium:found", result),
      onInput: (event, input) => win() && this.onInput(win(), event, input, entry().view.webContents),
      // Links clicked in a pinned tab or favourite that lead to another site open in Glance (Arc's Peek).
      guardNavigation: (target, wc) => {
        const e = entry();
        const tab = e?.model.tab(id);
        if (!tab?.pinnedUrl || !wasClicked(wc, target) || sameSite(target, tab.pinnedUrl)) return false;
        this.openGlance(e.win, target, id);
        return true;
      },
      menuExtras: () => [
        { label: "Boost This Site…", click: () => win() && this.openPage(win(), `archium://library/#boosts=${encodeURIComponent(hostOf(entry().view.webContents.getURL()))}`) },
        { label: "Zap an Element", click: () => this.zap(id) },
        { type: "separator" },
      ],
    };
  }

  // Favicons are fetched once, uncached, in the tab's own session and kept as data: URLs.
  // Loading them straight into the window UI would share one image cache across every site,
  // which trackers can use as a cross-site identifier (privacytests' "favicon cache").
  async fetchFavicon(entry, id, url) {
    try {
      const res = await entry.view.webContents.session.fetch(url, { cache: "no-store" });
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim() || "image/x-icon";
      const body = Buffer.from(await res.arrayBuffer());
      if (!res.ok || !body.length || body.length > 200_000 || !/^image\//.test(type)) return;
      entry.model.update(id, { favicon: `data:${type};base64,${body.toString("base64")}` });
    } catch {
      // No favicon: the sidebar shows the site's first letter.
    }
  }

  ensureView(win, id) {
    let entry = this.views.get(id);
    if (entry) {
      if (entry.win !== win) {
        const old = entry.win;
        entry.win = win;
        if (!old.closed && old.visibleTabs().includes(id)) {
          if (old.activeTab === id) old.activeTab = null;
          old.apply();
          this.pushState(old);
        }
      }
      return entry;
    }
    const tab = win.model.tab(id);
    if (!tab) return null;
    const view = createWebView({ session: this.sessionForTab(win.model, id), url: tab.url, hooks: this.tabHooks(id) });
    entry = { view, win, model: win.model, runtime: { loading: true, blocked: 0 } };
    this.views.set(id, entry);
    this.watchBoosts(view.webContents);
    return entry;
  }

  watchBoosts(wc) {
    wc.on("dom-ready", () => this.boosts.apply(wc));
  }

  destroyView(id) {
    const entry = this.views.get(id);
    if (!entry) return;
    this.views.delete(id);
    if (!entry.win.closed) entry.win.base.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  }

  entryForWebContents(wc) {
    for (const [id, entry] of this.views) if (entry.view.webContents === wc) return { id, ...entry };
    return null;
  }

  // ---- tab actions ----

  newTab(win, url, { background = false, spaceId, after } = {}) {
    const m = win.model;
    const target = spaceId ?? m.locate(after)?.spaceId ?? win.spaceId;
    const tab = m.newTab(target, url, { select: false });
    if (background) {
      this.ensureView(win, tab.id);
      this.schedulePush();
    } else {
      this.activate(win, tab.id);
    }
    return tab;
  }

  activate(win, id, { focus = true } = {}) {
    const m = win.model;
    const tab = m.tab(id);
    if (!tab) return;
    const where = m.locate(id);
    if (where?.spaceId && where.spaceId !== win.spaceId) win.spaceId = where.spaceId;
    for (const member of m.splitOf(id) ?? [id]) this.ensureView(win, member);
    if (m.splitOf(win.activeTab) !== m.splitOf(id) || !m.splitOf(id)) win.ratios = null;
    win.activeTab = id;
    m.touch(id);
    m.data.lastTab[win.spaceId] = id;
    if (!m.private) {
      m.data.activeSpace = win.spaceId;
      this.stores.state.save();
    }
    win.apply();
    if (focus && !win.overlay) win.focusPage();
    this.schedulePush();
  }

  // The loaded tab next to `id`, for when it closes.
  neighbour(win, id) {
    const m = win.model;
    const where = m.locate(id);
    const list = where?.zone === "favourites" ? m.data.favourites : m.tabsIn(m.space(where?.spaceId ?? win.spaceId));
    const i = list.indexOf(id);
    const loaded = (t) => t !== id && this.views.get(t)?.win === win;
    for (let d = 1; d < list.length; d++) {
      if (loaded(list[i + d])) return list[i + d];
      if (loaded(list[i - d])) return list[i - d];
    }
    return null;
  }

  close(win, id = win.activeTab) {
    if (!id) return;
    const m = win.model;
    const where = m.locate(id);
    const next = win.activeTab === id ? this.neighbour(win, id) : win.activeTab;
    this.destroyView(id);
    if (where?.zone === "today") m.closeTab(id);
    else m.unsplit(id);
    win.activeTab = null;
    if (next) this.activate(win, next);
    else {
      win.apply();
      this.schedulePush();
    }
  }

  reopen(win) {
    const tab = win.model.restoreArchived(0, win.spaceId);
    if (tab) this.activate(win, tab.id);
  }

  // The divider's "Clear": every Today tab in this space goes to the archive.
  clearToday(win) {
    const m = win.model;
    const space = m.space(win.spaceId);
    if (!space) return;
    for (const id of [...space.today]) {
      this.destroyView(id);
      m.archiveTab(id, space.id);
      if (win.activeTab === id) win.activeTab = null;
    }
    m.changed();
    win.apply();
  }

  restoreArchived(win, index) {
    const tab = this.model.restoreArchived(index, win.spaceId);
    if (tab) this.activate(win, tab.id);
    return Boolean(tab);
  }

  // From the command bar: an address or a search, in the current tab or a new one.
  open(win, input, { newTab = false } = {}) {
    const url = toUrl(input, this.settings.searchEngine);
    if (!url) return;
    const entry = win.activeTab && this.views.get(win.activeTab);
    if (newTab || !entry) return this.newTab(win, url);
    entry.view.webContents.loadURL(url).catch(() => {});
    win.focusPage();
  }

  openPage(win, url) {
    const m = win.model;
    for (const id of m.allTabIds()) if (m.tab(id)?.url.split("#")[0] === url.split("#")[0] && isArchiumUrl(url)) {
      this.activate(win, id);
      const wc = this.views.get(id)?.view.webContents;
      if (wc && wc.getURL() !== url) wc.loadURL(url);
      return;
    }
    this.newTab(win, url);
  }

  webContentsOf(win, id = win.activeTab) {
    const entry = id && this.views.get(id);
    return entry && entry.win === win ? entry.view.webContents : null;
  }

  history(win, action) {
    const wc = this.webContentsOf(win);
    if (!wc) return;
    if (action === "back") wc.navigationHistory.goBack();
    else if (action === "forward") wc.navigationHistory.goForward();
    else if (action === "reload") wc.reload();
    else if (action === "hard-reload") wc.reloadIgnoringCache();
    else if (action === "stop") wc.stop();
  }

  resetPinned(win, id) {
    const url = win.model.resetPinned(id);
    const wc = this.webContentsOf(win, id);
    if (url && wc) wc.loadURL(url);
  }

  toggleMute(win, id) {
    const entry = this.views.get(id);
    if (!entry) return;
    const wc = entry.view.webContents;
    wc.setAudioMuted(!wc.isAudioMuted());
    entry.runtime.muted = wc.isAudioMuted();
    this.schedulePush();
  }

  duplicate(win, id) {
    const tab = win.model.tab(id);
    if (tab) this.newTab(win, tab.url, { after: id });
  }

  place(win, id, target) {
    const before = win.model.locate(id);
    win.model.place(id, target);
    // Moving into a space with its own profile means a different cookie jar: reload there.
    const after = win.model.locate(id);
    if (before?.spaceId !== after?.spaceId && this.views.has(id) && !win.model.private) {
      const a = partitionFor(win.model.space(before?.spaceId));
      const b = partitionFor(win.model.space(after?.spaceId));
      if (after?.spaceId && a !== b) {
        const wasActive = win.activeTab === id;
        this.destroyView(id);
        if (wasActive) this.activate(win, id);
      }
    }
    if (after?.spaceId && after.spaceId !== win.spaceId && win.activeTab === id) win.activeTab = null;
    win.apply();
    this.schedulePush();
  }

  // ---- spaces ----

  switchSpace(win, spaceId) {
    const m = win.model;
    if (typeof spaceId === "number") {
      const i = m.spaces.findIndex((s) => s.id === win.spaceId);
      spaceId = m.spaces[(i + spaceId + m.spaces.length) % m.spaces.length]?.id;
    }
    if (!m.space(spaceId) || spaceId === win.spaceId) return;
    win.spaceId = spaceId;
    const last = m.data.lastTab[spaceId];
    const where = last && m.locate(last);
    win.activeTab = null;
    if (where && (where.spaceId === spaceId || where.zone === "favourites")) this.activate(win, last);
    else win.apply();
    if (!m.private) {
      m.data.activeSpace = spaceId;
      this.stores.state.save();
    }
    this.schedulePush();
  }

  addSpace(win, props) {
    const space = win.model.addSpace(props);
    this.switchSpace(win, space.id);
    return space;
  }

  removeSpace(win, spaceId) {
    const m = win.model;
    const ids = m.space(spaceId) ? m.tabsIn(m.space(spaceId)) : [];
    if (!m.removeSpace(spaceId)) return false;
    for (const id of ids) this.destroyView(id);
    for (const w of this.windows) {
      if (w.model === m && w.spaceId === spaceId) {
        w.spaceId = m.spaces[0].id;
        w.activeTab = null;
        w.apply();
      }
    }
    this.schedulePush();
    return true;
  }

  // ---- split view ----

  split(win, ids) {
    const group = win.model.split(ids);
    if (group) this.activate(win, group[0]);
  }

  splitWith(win, sourceId, url) {
    const tab = this.newTab(win, url, { background: true, after: sourceId });
    this.split(win, [sourceId, tab.id]);
  }

  unsplit(win, id) {
    win.model.unsplit(id);
    win.ratios = null;
    win.apply();
    this.schedulePush();
  }

  // ---- Glance ----

  openGlance(win, url, sourceId = win.activeTab) {
    if (win.glance) {
      win.glance.view.webContents.loadURL(url).catch(() => {});
      return;
    }
    const sourceWc = this.webContentsOf(win, sourceId);
    const ses = sourceWc?.session ?? this.session(win.model.private ? win.model.partition : "persist:archium");
    const hooks = {
      openTab: (target) => this.newTab(win, target),
      onNavigate: (target) => win.glance && (win.glance.url = target) && this.schedulePush(),
      onUpdate: ({ title }) => title && win.glance && (win.glance.title = title) && this.schedulePush(),
      onInput: (event, input) => this.onInput(win, event, input, view.webContents),
      onFail: (info) => this.showError(view.webContents, info),
    };
    const view = createWebView({ session: ses, url, hooks });
    this.watchBoosts(view.webContents);
    win.glance = { view, hooks, sourceId, url, rect: null };
    win.apply();
    win.focusUi();
    this.schedulePush();
  }

  closeGlance(win) {
    if (!win.glance) return;
    const { view } = win.glance;
    win.glance = null;
    win.base.contentView.removeChildView(view);
    view.webContents.close();
    win.apply();
    win.focusPage();
    this.schedulePush();
  }

  // Glance becomes a real tab: the page keeps its state.
  expandGlance(win, { split = false } = {}) {
    if (!win.glance) return;
    const { view, hooks, sourceId, url } = win.glance;
    win.glance = null;
    const tab = win.model.newTab(win.spaceId, view.webContents.getURL() || url, { select: false });
    tab.title = view.webContents.getTitle();
    Object.assign(hooks, this.tabHooks(tab.id));
    this.views.set(tab.id, { view, win, model: win.model, runtime: { loading: false, blocked: 0 } });
    if (split && sourceId && win.model.tab(sourceId)) this.split(win, [sourceId, tab.id]);
    else this.activate(win, tab.id);
  }

  // ---- find, zoom, copy ----

  find(win, text, { forward = true, findNext = false } = {}) {
    const wc = this.webContentsOf(win);
    if (!wc) return;
    if (!text) return wc.stopFindInPage("clearSelection");
    wc.findInPage(text, { forward, findNext });
  }

  stopFind(win) {
    this.webContentsOf(win)?.stopFindInPage("keepSelection");
  }

  zoom(win, step) {
    const wc = this.webContentsOf(win);
    if (!wc) return;
    wc.setZoomLevel(step === 0 ? 0 : Math.max(-6, Math.min(9, wc.getZoomLevel() + step)));
  }

  copyUrl(win) {
    const tab = win.activeTab && win.model.tab(win.activeTab);
    if (tab) clipboard.writeText(tab.url);
    return tab?.url ?? null;
  }

  // ---- boosts ----

  async zap(id) {
    const wc = this.views.get(id)?.view.webContents;
    if (!wc) return;
    const selector = await this.boosts.pick(wc);
    if (selector) {
      this.boosts.addZap(hostOf(wc.getURL()), selector);
      this.boosts.apply(wc);
    }
  }

  // ---- history ----

  addHistory(url, title) {
    if (!/^https?:/.test(url)) return;
    const visits = this.stores.history.data.visits;
    visits.push({ url, title, at: Date.now() });
    if (visits.length > HISTORY_LIMIT) visits.splice(0, visits.length - HISTORY_LIMIT);
    this.stores.history.save();
  }

  updateHistoryTitle(url, title) {
    const visits = this.stores.history.data.visits;
    for (let i = visits.length - 1; i >= Math.max(0, visits.length - 20); i--) {
      if (visits[i].url === url) {
        visits[i].title = title;
        this.stores.history.save();
        return;
      }
    }
  }

  // Unique pages, most used and most recent first.
  historyIndex(limit = 3000) {
    const byUrl = new Map();
    for (const v of this.stores.history.data.visits) {
      const e = byUrl.get(v.url) ?? { url: v.url, title: v.title, count: 0, at: 0 };
      e.count++;
      if (v.at >= e.at) {
        e.at = v.at;
        if (v.title) e.title = v.title;
      }
      byUrl.set(v.url, e);
    }
    const now = Date.now();
    const score = (e) => e.count / (1 + (now - e.at) / 86_400_000 / 7);
    return [...byUrl.values()].sort((a, b) => score(b) - score(a)).slice(0, limit);
  }

  // What the command bar searches: every tab in every space, history, archive and commands.
  searchIndex(win) {
    const m = win.model;
    const spaceOf = (id) => m.locate(id)?.spaceId;
    const tabs = m.allTabIds().map((id) => {
      const t = this.tabInfo(win, id);
      const where = m.locate(id);
      const space = m.space(spaceOf(id));
      return { ...t, zone: where?.zone, space: space ? { id: space.id, name: space.name, icon: space.icon } : null };
    });
    return {
      tabs,
      history: m.private ? [] : this.historyIndex(),
      archive: m.private ? [] : m.data.archive.slice(0, 300),
      spaces: m.spaces.map((s) => ({ id: s.id, name: s.name, icon: s.icon })),
      current: win.activeTab ? m.tab(win.activeTab)?.url ?? "" : "",
      engine: this.settings.searchEngine,
      suggestions: this.settings.searchSuggestions,
    };
  }

  async suggest(query) {
    if (!this.settings.searchSuggestions || !query.trim()) return [];
    try {
      const url = `https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(query)}`;
      const res = await this.session("persist:archium").fetch(url, { headers: { accept: "application/json" } });
      const data = await res.json();
      return (data?.[1] ?? []).slice(0, 5);
    } catch {
      return [];
    }
  }

  // ---- errors ----

  showError(wc, { code, description, url }) {
    if (!wc || wc.isDestroyed() || isArchiumUrl(url)) return;
    const upgraded = Boolean(wc.session.wasUpgraded?.(url));
    const q = new URLSearchParams({ code: String(code), desc: description ?? "", url: url ?? "", https: upgraded ? "1" : "" });
    wc.loadURL(`archium://error/?${q}`).catch(() => {});
  }

  allowHttp(host) {
    if (!host || this.settings.httpAllowed.includes(host)) return;
    this.saveSettings({ httpAllowed: [...this.settings.httpAllowed, host] });
  }

  countBlocked(details) {
    const id = details.webContents && this.entryForWebContents(details.webContents)?.id;
    const entry = id && this.views.get(id);
    if (!entry) return;
    entry.runtime.blocked = (entry.runtime.blocked ?? 0) + 1;
    this.schedulePush();
  }

  // ---- permissions ----

  askPermission({ webContents, origin, permission }) {
    const entry = this.entryForWebContents(webContents);
    const win = entry?.win;
    if (!win || win.closed) return Promise.resolve(false);
    return new Promise((resolve) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.pendingPermissions.set(id, { resolve, origin, permission, isPrivate: win.isPrivate });
      if (entry.id !== win.activeTab) this.activate(win, entry.id);
      win.send("archium:permission", { id, origin, permission });
    });
  }

  answerPermission({ id, allow, remember }) {
    const pending = this.pendingPermissions.get(id);
    if (!pending) return;
    this.pendingPermissions.delete(id);
    if (remember && !pending.isPrivate) {
      this.saveSettings({ permissions: { ...this.settings.permissions, [`${pending.origin}|${pending.permission}`]: Boolean(allow) } });
    }
    pending.resolve(Boolean(allow));
  }

  // ---- downloads ----

  onDownload(item, wc, inMemory) {
    const lib = this.stores.library.data;
    if (!this.settings.downloadsAsk) {
      const dir = app.getPath("downloads");
      item.setSavePath(uniquePath(dir, item.getFilename()));
    }
    const record = { id: `${Date.now()}`, name: item.getFilename(), url: item.getURL(), path: "", state: "progressing", received: 0, total: item.getTotalBytes(), at: Date.now() };
    if (!inMemory) lib.downloads.unshift(record);
    lib.downloads.length = Math.min(lib.downloads.length, 200);
    this.activeDownloads = (this.activeDownloads ?? new Map()).set(record.id, record);
    item.on("updated", (_e, state) => {
      record.state = state === "interrupted" ? "interrupted" : "progressing";
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes();
      record.path = item.getSavePath();
      this.schedulePush();
    });
    item.once("done", (_e, state) => {
      record.state = state;
      record.path = item.getSavePath();
      record.received = item.getReceivedBytes();
      this.activeDownloads.delete(record.id);
      this.stores.library.save();
      this.schedulePush();
      if (state === "completed" && process.platform === "darwin") app.dock?.downloadFinished(record.path);
    });
    this.stores.library.save();
  }

  downloadSummary() {
    const active = [...(this.activeDownloads?.values() ?? [])];
    const total = active.reduce((n, d) => n + (d.total || 0), 0);
    const received = active.reduce((n, d) => n + d.received, 0);
    return { active: active.length, progress: total ? received / total : active.length ? -1 : 0 };
  }

  showDownload(path) {
    if (path && existsSync(path)) shell.showItemInFolder(path);
  }

  // ---- menus ----

  tabMenu(win, id) {
    const m = win.model;
    const tab = m.tab(id);
    if (!tab) return;
    const where = m.locate(id);
    const others = m.spaces.filter((s) => s.id !== where?.spaceId);
    const items = [
      where?.zone === "today"
        ? { label: "Pin Tab", click: () => this.place(win, id, { zone: "pinned", spaceId: where.spaceId }) }
        : { label: "Unpin Tab", click: () => this.place(win, id, { zone: "today", spaceId: where?.spaceId ?? win.spaceId, index: 0 }) },
      where?.zone === "favourites"
        ? { label: "Remove from Favourites", click: () => this.place(win, id, { zone: "pinned", spaceId: win.spaceId }) }
        : { label: "Add to Favourites", click: () => this.place(win, id, { zone: "favourites" }) },
      ...(tab.pinnedUrl && tab.pinnedUrl !== tab.url ? [{ label: "Back to Pinned Page", click: () => this.resetPinned(win, id) }] : []),
      { type: "separator" },
      { label: "Open in Split View", enabled: Boolean(win.activeTab && win.activeTab !== id), click: () => this.split(win, [win.activeTab, id]) },
      ...(m.splitOf(id) ? [{ label: "Leave Split View", click: () => this.unsplit(win, id) }] : []),
      { label: "Duplicate", click: () => this.duplicate(win, id) },
      { label: "Copy Link", click: () => clipboard.writeText(tab.url) },
      ...(this.views.has(id) ? [{ label: this.views.get(id).runtime.muted ? "Unmute" : "Mute", click: () => this.toggleMute(win, id) }] : []),
      ...(others.length && where?.zone !== "favourites"
        ? [{ label: "Move to Space", submenu: others.map((s) => ({ label: `${s.icon} ${s.name}`, click: () => this.place(win, id, { zone: where.zone, spaceId: s.id }) })) }]
        : []),
      { type: "separator" },
      where?.zone === "today"
        ? { label: "Close Tab", click: () => this.close(win, id) }
        : { label: this.views.has(id) ? "Unload Tab" : "Remove", click: () => (this.views.has(id) ? this.close(win, id) : this.removeTab(win, id)) },
    ];
    Menu.buildFromTemplate(items).popup({ window: win.base });
  }

  // A pinned tab or favourite taken out of the sidebar for good.
  removeTab(win, id) {
    const m = win.model;
    this.destroyView(id);
    const where = m.locate(id);
    if (!where) return;
    m.archiveTab(id, where.spaceId ?? win.spaceId);
    if (win.activeTab === id) win.activeTab = null;
    m.changed();
    win.apply();
  }

  // ---- input ----

  onInput(win, event, input) {
    if (input.type !== "keyDown") return;
    if (input.key === "Escape" && win.glance) {
      event.preventDefault();
      this.closeGlance(win);
    }
  }

  // ---- links from other apps ----

  openExternalLink(url) {
    const spaceId = this.model.route(url) || (this.model.space(this.settings.linkSpace) ? this.settings.linkSpace : null);
    const win = this.mainWindow() ?? this.createWindow();
    if (spaceId || !this.openMini) {
      if (spaceId) this.switchSpace(win, spaceId);
      this.newTab(win, url, { spaceId: spaceId ?? win.spaceId });
      win.base.focus();
      return;
    }
    this.openMini(url);
  }
}

function uniquePath(dir, name) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let path = join(dir, name);
  for (let i = 1; existsSync(path); i++) path = join(dir, `${stem} (${i})${ext}`);
  return path;
}

