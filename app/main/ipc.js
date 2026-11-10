// The window UI's requests. Each handler finds its window from the sender, so a page in a
// tab (which has no preload) can never reach these.
import { ipcMain } from "electron";
import { runCommand, COMMANDS } from "./commands.js";
import { noteLinkClick } from "./tabs.js";

const UI_SETTINGS = { look: ["arc", "zen", "glass", "retro"], appearance: ["system", "light", "dark"], compact: [true, false] };

export function registerIpc(hub) {
  const on = (channel, fn) =>
    ipcMain.handle(`archium:${channel}`, (event, ...args) => {
      const win = hub.windowForUi(event.sender);
      if (!win) return null;
      return fn(win, ...args);
    });

  on("layout", (win, { rect, radius }) => win.setRect(rect, radius));
  on("overlay", (win, onTop) => win.setOverlay(onTop));
  on("snapshot", (win) => win.snapshot());
  on("focus-page", (win) => win.focusPage());

  on("activate", (win, id) => hub.activate(win, id));
  on("open", (win, { input, newTab }) => hub.open(win, input, { newTab }));
  on("close", (win, id) => hub.close(win, id));
  on("nav", (win, action) => hub.history(win, action));
  on("place", (win, { id, target }) => hub.place(win, id, target));
  on("tab-menu", (win, id) => hub.tabMenu(win, id));
  on("reset-pinned", (win, id) => hub.resetPinned(win, id));
  on("mute", (win, id) => hub.toggleMute(win, id));
  on("restore-archived", (win, index) => hub.restoreArchived(win, index));

  on("space-switch", (win, idOrStep) => hub.switchSpace(win, idOrStep));
  on("space-add", (win, props) => hub.addSpace(win, props)?.id);
  on("space-update", (win, { id, patch }) => win.model.updateSpace(id, patch));
  on("space-remove", (win, id) => hub.removeSpace(win, id));
  on("space-move", (win, { id, index }) => win.model.moveSpace(id, index));

  on("folder-add", (win, { spaceId, name, tabIds }) => win.model.addFolder(spaceId, name, tabIds)?.id);
  on("folder-update", (win, { spaceId, folderId, patch }) => win.model.updateFolder(spaceId, folderId, patch));
  on("folder-remove", (win, { spaceId, folderId }) => win.model.removeFolder(spaceId, folderId));

  on("split", (win, ids) => hub.split(win, ids));
  on("unsplit", (win, id) => hub.unsplit(win, id));
  on("split-ratios", (win, ratios) => {
    win.ratios = Array.isArray(ratios) ? ratios.map(Number) : null;
    win.layout();
  });

  on("glance-rect", (win, rect) => {
    if (!win.glance) return;
    win.glance.rect = rect;
    win.layout();
  });
  on("glance-close", (win) => hub.closeGlance(win));
  on("glance-expand", (win, opts) => hub.expandGlance(win, opts));

  on("find", (win, { text, forward, findNext }) => hub.find(win, text, { forward, findNext }));
  on("find-stop", (win) => hub.stopFind(win));

  on("search-index", (win) => hub.searchIndex(win));
  on("suggest", (_win, query) => hub.suggest(String(query ?? "")));
  on("commands", () => COMMANDS.map(({ id, label, keys }) => ({ id, label, keys })));
  on("command", (win, { id, arg }) => runCommand(hub, win, id, arg));

  on("setting", (win, { key, value }) => {
    if (!UI_SETTINGS[key]?.includes(value)) return;
    hub.saveSettings({ [key]: value });
  });
  on("sidebar-width", (_win, width) => hub.saveSettings({ sidebarWidth: Math.max(200, Math.min(420, Math.round(width))) }));
  on("permission-answer", (_win, answer) => hub.answerPermission(answer));
  on("traffic-lights", (win, visible) => win.base.setWindowButtonVisibility?.(Boolean(visible)));
  on("clear-today", (win) => hub.clearToday(win));
  on("site-exception", (_win, { host, key, value }) => {
    if (typeof host !== "string" || !host || !["adblock", "cookies"].includes(key)) return;
    const all = { ...hub.settings.siteExceptions };
    const site = { ...all[host] };
    if (value) delete site[key];
    else site[key] = false;
    if (Object.keys(site).length) all[host] = site;
    else delete all[host];
    hub.saveSettings({ siteExceptions: all });
  });
  on("window", (win, action) => {
    if (action === "close") win.base.close();
    else if (action === "minimize") win.base.minimize();
    else if (action === "maximize") (win.base.isMaximized() ? win.base.unmaximize() : win.base.maximize());
    else if (action === "fullscreen") win.base.setFullScreen(!win.base.isFullScreen());
  });

  // From the web preload: ⌥-click opens Glance; every trusted link click is noted for pinned-tab Peek.
  ipcMain.on("archium:glance-link", (event, url) => {
    const entry = hub.entryForWebContents(event.sender);
    if (entry && /^https?:/.test(url)) hub.openGlance(entry.win, url, entry.id);
  });
  ipcMain.on("archium:link-click", (event, url) => typeof url === "string" && noteLinkClick(event.sender, url));

  // Little Archium windows.
  const mini = (event) => [...hub.minis].find((m) => m.ui.webContents === event.sender);
  ipcMain.handle("archium:mini-move", (event) => mini(event)?.moveToMain());
  ipcMain.handle("archium:mini-close", (event) => mini(event)?.base.close());
  ipcMain.handle("archium:mini-window", (event, action) => {
    const m = mini(event);
    if (!m) return;
    if (action === "minimize") m.base.minimize();
    else if (action === "maximize") (m.base.isMaximized() ? m.base.unmaximize() : m.base.maximize());
    else if (action === "fullscreen") m.base.setFullScreen(!m.base.isFullScreen());
  });
  ipcMain.handle("archium:mini-nav", (event, action) => mini(event)?.nav(action));
  ipcMain.handle("archium:mini-copy", (event) => mini(event)?.copy());
}
