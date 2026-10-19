// Archium Browser: app lifecycle, the menu (every keyboard shortcut lives here), Glance's
// global shortcut, and the IPC bridge from Archium's own pages.
import { join } from "node:path";
import { app, BaseWindow, Menu, globalShortcut, ipcMain, shell as desktop, nativeTheme } from "electron";
import "./protocol.js"; // registers the archium:// scheme before ready
import { registerProtocol } from "./protocol.js";
import { setupSessions, applyNetwork, sessions } from "./sessions.js";
import { startAdblock, getBlocker } from "./adblock.js";
import { Shell, icon, nativeGlass } from "./shell.js";
import { Glance } from "./glance.js";
import { getSettings, updateSettings, getBookmarks, toggleBookmark, getHistory, clearHistory, saveSession, loadSession } from "./store.js";
import { ensureModel, isModelReady, MODEL_NAME, TOTAL_BYTES, FILES } from "./model.js";

app.setName("Archium");
// Its own folder: "Archium" already holds the SearXNG install from searxng/install.sh.
app.setPath("userData", process.env.ARCHIUM_USER_DATA || join(app.getPath("appData"), "Archium Browser"));
// Hardening that costs nothing: no remote debugging, no background sync of anything.
app.commandLine.appendSwitch("disable-features", "MediaRouter,OptimizationHints,InterestFeedContentSuggestions");

if (!app.requestSingleInstanceLock()) app.quit();

const shells = new Set();
let glance;
let quitting = false;

const focused = () => {
  const win = BaseWindow.getFocusedWindow();
  return [...shells].find((s) => s.win === win) ?? [...shells].at(-1);
};

function openWindow(urls) {
  const shell = new Shell({
    urls,
    onClosed: (s) => {
      shells.delete(s);
      if (!quitting) persistSession();
    },
  });
  shells.add(shell);
  return shell;
}

function persistSession() {
  saveSession([...shells].flatMap((s) => s.sessionUrls()));
}

function broadcast() {
  for (const s of shells) s.push();
  glance?.push();
}

function refreshLook() {
  for (const s of shells) s.refreshLook();
  glance?.refreshLook();
  rebuildMenu();
}

// Commands from the menu, the toolbar page and the ⌘K palette. Ones the page handles
// itself (address field, find bar, palette) are forwarded to it.
const PAGE_COMMANDS = new Set(["focus-address", "find", "palette", "history", "bookmarks", "settings", "share-qr", "escape"]);

function run(command, arg, shell = focused()) {
  if (PAGE_COMMANDS.has(command)) {
    if (!shell) return;
    if (shell.focusMode && command === "focus-address") shell.setFocusMode(false);
    return shell.ui.webContents.send("command", command);
  }
  const wc = shell?.active?.view.webContents;
  switch (command) {
    case "new-window":
      return openWindow();
    case "new-tab":
      return shell ? shell.createTab(arg) : openWindow();
    case "new-private-tab":
      return (shell ?? openWindow()).createTab(undefined, { private: true });
    case "close-tab":
      return shell?.closeTab(arg);
    case "reopen-tab":
      return shell?.reopenTab();
    case "next-tab":
      return shell?.cycle(1);
    case "prev-tab":
      return shell?.cycle(-1);
    case "tab-index":
      return shell?.tabs[arg === 9 ? shell.tabs.length - 1 : arg - 1] && shell.activate(shell.tabs[arg === 9 ? shell.tabs.length - 1 : arg - 1].id);
    case "back":
      return wc?.navigationHistory.canGoBack() && wc.navigationHistory.goBack();
    case "forward":
      return wc?.navigationHistory.canGoForward() && wc.navigationHistory.goForward();
    case "reload":
      return wc?.reload();
    case "hard-reload":
      return wc?.reloadIgnoringCache();
    case "stop":
      return wc?.stop();
    case "bookmark":
      if (shell?.active && /^https?:/.test(shell.active.url)) toggleBookmark({ url: shell.active.url, title: shell.active.title });
      return broadcast();
    case "tabs-position":
      updateSettings({ tabs: getSettings().tabs === "side" ? "top" : "side" });
      return broadcast();
    case "tabs-visible":
      updateSettings({ tabs: getSettings().tabs === "hidden" ? "top" : "hidden" });
      return broadcast();
    case "focus-mode":
      return shell?.setFocusMode();
    case "assistant":
      return shell?.toggleAssistant();
    case "summarize":
      return shell?.ask({ kind: "summarize" });
    case "look":
      return shell?.ask({ kind: "look" });
    case "glance":
      return glance.toggle();
    case "theme":
      return applySettings({ theme: arg });
    case "zoom-in":
      return shell?.setZoom(1);
    case "zoom-out":
      return shell?.setZoom(-1);
    case "zoom-reset":
      return shell?.setZoom(0);
    case "devtools":
      return wc?.toggleDevTools();
    case "win-min":
      return shell?.win.minimize();
    case "win-max":
      return shell && (shell.win.isMaximized() ? shell.win.unmaximize() : shell.win.maximize());
    case "win-close":
      return shell?.win.close();
    case "downloads":
      return desktop.openPath(app.getPath("downloads"));
  }
}

function rebuildMenu() {
  const theme = getSettings().theme;
  const item = (label, accelerator, command, arg) => ({ label, accelerator, click: () => run(command, arg) });
  const template = [
    {
      label: "Archium",
      submenu: [
        { role: "about" },
        { type: "separator" },
        item("Settings…", "CmdOrCtrl+,", "settings"),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        item("New Tab", "CmdOrCtrl+T", "new-tab"),
        item("New Window", "CmdOrCtrl+N", "new-window"),
        item("New Private Tab", "Shift+CmdOrCtrl+N", "new-private-tab"),
        // Shown only: the global shortcut below already handles ⌃⌥Space, in every app.
        { ...item("Glance", "Control+Alt+Space", "glance"), registerAccelerator: false },
        { type: "separator" },
        item("Open Location…", "CmdOrCtrl+L", "focus-address"),
        item("Share Page as QR Code…", undefined, "share-qr"),
        { type: "separator" },
        item("Close Tab", "CmdOrCtrl+W", "close-tab"),
        item("Reopen Closed Tab", "Shift+CmdOrCtrl+T", "reopen-tab"),
        { label: "Close Window", accelerator: "Shift+CmdOrCtrl+W", click: () => focused()?.win.close() },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "selectAll" },
        { type: "separator" },
        item("Find…", "CmdOrCtrl+F", "find"),
      ],
    },
    {
      label: "View",
      submenu: [
        item("Commands…", "CmdOrCtrl+K", "palette"),
        { type: "separator" },
        {
          label: "Look",
          submenu: [
            ["normal", "Normal"],
            ["win98", "Windows 98"],
            ["glass", "Liquid Glass"],
          ].map(([id, label]) => ({ label, type: "radio", checked: theme === id, click: () => run("theme", id) })),
        },
        item("Move Tabs to Side or Top", "CmdOrCtrl+S", "tabs-position"),
        item("Show or Hide Tabs", "Shift+CmdOrCtrl+S", "tabs-visible"),
        item("Focus Mode", "Shift+CmdOrCtrl+B", "focus-mode"),
        { type: "separator" },
        item("Reload", "CmdOrCtrl+R", "reload"),
        item("Reload Ignoring Cache", "Shift+CmdOrCtrl+R", "hard-reload"),
        item("Stop", "CmdOrCtrl+.", "stop"),
        { type: "separator" },
        item("Zoom In", "CmdOrCtrl+Plus", "zoom-in"),
        { ...item("Zoom In", "CmdOrCtrl+=", "zoom-in"), visible: false, acceleratorWorksWhenHidden: true },
        item("Zoom Out", "CmdOrCtrl+-", "zoom-out"),
        item("Actual Size", "CmdOrCtrl+0", "zoom-reset"),
        { type: "separator" },
        item("Developer Tools", "Alt+CmdOrCtrl+I", "devtools"),
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "History",
      submenu: [
        item("Back", "CmdOrCtrl+[", "back"),
        item("Forward", "CmdOrCtrl+]", "forward"),
        { type: "separator" },
        item("Show History", "CmdOrCtrl+Y", "history"),
      ],
    },
    {
      label: "Bookmarks",
      submenu: [item("Bookmark This Page", "CmdOrCtrl+D", "bookmark"), item("Show Bookmarks", "Alt+CmdOrCtrl+B", "bookmarks")],
    },
    {
      label: "Assistant",
      submenu: [
        item("Show Assistant", "Shift+CmdOrCtrl+A", "assistant"),
        item("Summarize Page", "Shift+CmdOrCtrl+U", "summarize"),
        item("Look at This Page", "Shift+CmdOrCtrl+L", "look"),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        item("Next Tab", "Control+Tab", "next-tab"),
        item("Previous Tab", "Shift+Control+Tab", "prev-tab"),
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ ...item(`Tab ${n === 9 ? "(last)" : n}`, `CmdOrCtrl+${n}`, "tab-index", n), visible: false, acceleratorWorksWhenHidden: true })),
        item("Downloads", "Shift+CmdOrCtrl+J", "downloads"),
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function applySettings(patch) {
  const before = getSettings();
  const after = updateSettings(patch);
  const network = ["mode", "torPort", "proxyScheme", "proxyHost", "proxyPort", "blockWebRTC"].some((k) => before[k] !== after[k]);
  if (network) await applyNetwork();
  if (before.theme !== after.theme) refreshLook();
  if (before.restoreSession !== after.restoreSession) persistSession();
  broadcast();
  return after;
}

// --- IPC from Archium's pages -------------------------------------------------

const isOwnPage = (frame) => frame?.url.startsWith("archium://app/");

ipcMain.on("archium", (e, command, arg) => {
  if (!isOwnPage(e.senderFrame)) return;
  if (glance?.owns(e.sender)) return glance.handle(command, arg);
  const shell = [...shells].find((s) => s.owns(e.sender));
  if (!shell) return;
  switch (command) {
    case "ready":
      return shell.push();
    case "layout":
      return shell.setLayout(arg);
    case "overlay":
      return shell.setOverlay(arg);
    case "navigate":
      return shell.navigate(String(arg ?? ""));
    case "activate":
      return shell.activate(arg);
    case "move-tab":
      return shell.moveTab(arg?.id, arg?.to);
    case "find":
      if (arg?.text) shell.active?.view.webContents.findInPage(String(arg.text), { forward: arg.forward !== false, findNext: Boolean(arg.next) });
      return;
    case "stop-find":
      return shell.active?.view.webContents.stopFindInPage("clearSelection");
    case "focus-mode":
      return shell.setFocusMode(Boolean(arg));
    case "assistant-close":
      return shell.toggleAssistant(false);
    case "focus-page":
      return shell.active?.view.webContents.focus();
    default:
      return run(command, arg, shell);
  }
});

ipcMain.handle("archium", async (e, command, arg) => {
  if (!isOwnPage(e.senderFrame)) throw new Error("Not allowed");
  const shell = [...shells].find((s) => s.owns(e.sender));
  switch (command) {
    case "settings":
      return getSettings();
    case "set-settings":
      return applySettings(arg);
    case "search": {
      // ⌘K: open tabs, bookmarks and history matching the text.
      const q = String(arg ?? "").toLowerCase().trim();
      const match = (x) => !q || x.title?.toLowerCase().includes(q) || x.url.toLowerCase().includes(q);
      const tabs = [...shells].flatMap((s) => s.tabs.map((t) => ({ kind: "tab", id: t.id, title: t.title, url: t.url, private: t.private, own: s === shell }))).filter(match);
      return {
        tabs: tabs.slice(0, 8),
        bookmarks: getBookmarks().filter(match).slice(0, 8),
        history: getHistory().filter(match).slice(0, 12),
      };
    }
    case "remove-bookmark":
      if (getBookmarks().some((b) => b.url === arg)) toggleBookmark({ url: arg });
      broadcast();
      return getBookmarks();
    case "clear-history":
      clearHistory();
      return [];
    case "page-text":
      if (!shell) throw new Error("No window");
      return shell.pageText();
    case "capture":
      if (!shell) throw new Error("No window");
      return shell.capture();
    case "model-status":
      return { name: MODEL_NAME, ready: isModelReady(), total: TOTAL_BYTES, files: FILES };
    case "model-download": {
      const sender = e.sender;
      await ensureModel((p) => !sender.isDestroyed() && sender.send("model-progress", p));
      return { ready: isModelReady(), files: FILES };
    }
  }
  throw new Error(`Unknown command ${command}`);
});

// --- lifecycle --------------------------------------------------------------

app.on("second-instance", () => {
  const shell = focused() ?? openWindow();
  shell.win.focus();
});

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock?.setIcon(icon());
  nativeTheme.themeSource = "system";
  await setupSessions((kind, id) => {
    if (kind === "blocked") {
      for (const s of shells) if (s.active?.view.webContents.id === id) s.push();
    } else broadcast();
  });

  const newtabApi = {
    state: () => {
      const s = getSettings();
      return { theme: s.theme, links: s.links, mode: s.mode, localSearch: s.localSearch };
    },
    setLinks: (links) => {
      const clean = (Array.isArray(links) ? links : [])
        .filter((l) => l && typeof l.title === "string" && typeof l.url === "string" && /^https?:\/\//.test(l.url))
        .slice(0, 24)
        .map((l) => ({ title: l.title.slice(0, 40), url: l.url.slice(0, 2000) }));
      updateSettings({ links: clean });
      return { links: clean };
    },
  };
  registerProtocol(sessions.ui, ["app", "newtab"], newtabApi);
  registerProtocol(sessions.ai, ["app", "models"], newtabApi); // "models": archium://app/models/
  registerProtocol(sessions.tabs, ["newtab"], newtabApi);
  registerProtocol(sessions.private, ["newtab"], newtabApi);

  glance = new Glance({ openInTab: (url) => (focused() ?? openWindow()).createTab(url) });
  rebuildMenu();
  if (!globalShortcut.register("Control+Alt+Space", () => glance.toggle())) {
    console.warn("[archium] ⌃⌥Space is taken by another app; Glance is still in the File menu");
  }

  const restored = loadSession();
  openWindow(restored.length ? restored : undefined);
  void startAdblock();
});

app.on("activate", () => {
  if (!shells.size) openWindow();
});

app.on("before-quit", () => {
  quitting = true;
  persistSession();
});

app.on("window-all-closed", () => {
  // Like other Mac browsers, Archium stays running with no windows; Glance still works.
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => globalShortcut.unregisterAll());

// Test hook: Playwright drives commands without synthesising menu shortcuts.
if (process.env.ARCHIUM_TEST) {
  globalThis.__archium = {
    run,
    shells,
    get glance() {
      return glance;
    },
    getSettings,
    setSettings: applySettings,
    history: getHistory,
    blockerReady: () => Boolean(getBlocker()),
    blocker: getBlocker,
    nativeGlass,
    ensureModel,
  };
}
