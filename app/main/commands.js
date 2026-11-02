// Named commands, shared by the menu (keyboard shortcuts), the command bar and the CLI.
// Commands the window UI draws itself (command bar, find bar) are sent to it.
import { app, clipboard } from "electron";
import { hostOf } from "./privacy/filter.js";
import { archive } from "./archivebox.js";

export const COMMANDS = [
  { id: "new-tab", label: "New Tab", keys: "CmdOrCtrl+T" },
  { id: "edit-url", label: "Edit Address", keys: "CmdOrCtrl+L" },
  { id: "close-tab", label: "Close Tab", keys: "CmdOrCtrl+W" },
  { id: "reopen-tab", label: "Reopen Closed Tab", keys: "CmdOrCtrl+Shift+T" },
  { id: "new-window", label: "New Window", keys: "CmdOrCtrl+N" },
  { id: "private-window", label: "New Private Window", keys: "CmdOrCtrl+Shift+N" },
  { id: "little", label: "New Little Hillium Window", keys: "CmdOrCtrl+Alt+N" },
  { id: "toggle-sidebar", label: "Toggle Sidebar", keys: "CmdOrCtrl+S" },
  { id: "pin-tab", label: "Pin or Unpin Tab", keys: "CmdOrCtrl+D" },
  { id: "favourite-tab", label: "Add to Favourites", keys: "CmdOrCtrl+Shift+D" },
  { id: "split", label: "Split View with Next Tab", keys: "Control+Shift+=" },
  { id: "unsplit", label: "Leave Split View", keys: "Control+Shift+-" },
  { id: "find", label: "Find in Page", keys: "CmdOrCtrl+F" },
  { id: "copy-url", label: "Copy Address", keys: "CmdOrCtrl+Shift+C" },
  { id: "archive-page", label: "Archive Page in ArchiveBox", keys: "CmdOrCtrl+Shift+S" },
  { id: "zap", label: "Zap an Element", keys: "CmdOrCtrl+Alt+Z" },
  { id: "boost", label: "Boost This Site…", keys: "CmdOrCtrl+Alt+B" },
  { id: "new-space", label: "New Space", keys: "" },
  { id: "next-space", label: "Next Space", keys: process.platform === "darwin" ? "Control+Alt+Right" : "Alt+Shift+Right" },
  { id: "previous-space", label: "Previous Space", keys: process.platform === "darwin" ? "Control+Alt+Left" : "Alt+Shift+Left" },
  { id: "next-tab", label: "Next Tab", keys: "Control+Tab" },
  { id: "previous-tab", label: "Previous Tab", keys: "Control+Shift+Tab" },
  { id: "library", label: "Library", keys: "CmdOrCtrl+Y" },
  { id: "settings", label: "Settings", keys: "CmdOrCtrl+," },
  { id: "import", label: "Import from Arc, Zen or Chrome…", keys: "" },
  { id: "look-arc", label: "Look: Arc", keys: "" },
  { id: "look-zen", label: "Look: Zen", keys: "" },
  { id: "look-glass", label: "Look: Liquid Glass", keys: "" },
  { id: "look-retro", label: "Look: Retro 98", keys: "" },
  { id: "devtools", label: "Developer Tools", keys: process.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I" },
];

// Tab order of a window's sidebar: favourites, then the space's pinned tabs and Today.
function sidebarOrder(win) {
  const m = win.model;
  const space = m.space(win.spaceId);
  return [...m.data.favourites, ...(space ? m.tabsIn(space) : [])];
}

export async function runCommand(hub, win, id, arg) {
  if (!win || win.closed) win = hub.focusedWindow() ?? hub.createWindow();
  const m = win.model;
  const active = win.activeTab;
  switch (id) {
    case "new-tab":
    case "edit-url":
    case "find":
      win.send("hillium:command", { id });
      return;
    case "close-tab":
      if (win.glance) return hub.closeGlance(win);
      return hub.close(win);
    case "reopen-tab":
      return hub.reopen(win);
    case "new-window":
      return hub.createWindow();
    case "private-window":
      return hub.createWindow({ isPrivate: true });
    case "little":
      return hub.openMini?.("");
    case "toggle-sidebar":
      return hub.saveSettings({ compact: !hub.settings.compact });
    case "pin-tab": {
      if (!active) return;
      const where = m.locate(active);
      return hub.place(win, active, where?.zone === "today" ? { zone: "pinned", spaceId: where.spaceId } : { zone: "today", spaceId: where?.spaceId ?? win.spaceId, index: 0 });
    }
    case "favourite-tab":
      return active && hub.place(win, active, { zone: "favourites" });
    case "split": {
      if (!active) return;
      const order = sidebarOrder(win).filter((t) => t !== active);
      const next = arg ?? order.find((t) => !m.splitOf(active)?.includes(t));
      return next && hub.split(win, [...(m.splitOf(active) ?? [active]), next]);
    }
    case "unsplit":
      return active && hub.unsplit(win, active);
    case "next-tab":
    case "previous-tab": {
      const order = sidebarOrder(win);
      if (!order.length) return;
      const i = order.indexOf(active);
      const step = id === "next-tab" ? 1 : -1;
      return hub.activate(win, order[(i + step + order.length) % order.length]);
    }
    case "tab-number": {
      const order = sidebarOrder(win);
      const target = arg === 9 ? order.at(-1) : order[arg - 1];
      return target && hub.activate(win, target);
    }
    case "space-number": {
      const space = m.spaces[arg - 1];
      return space && hub.switchSpace(win, space.id);
    }
    case "next-space":
      return hub.switchSpace(win, 1);
    case "previous-space":
      return hub.switchSpace(win, -1);
    case "new-space":
      return win.send("hillium:command", { id: "new-space" });
    case "copy-url": {
      const url = hub.copyUrl(win);
      if (url) win.send("hillium:toast", { text: "Address copied" });
      return;
    }
    case "archive-page": {
      const tab = active && m.tab(active);
      if (!tab) return;
      try {
        const result = await archive(hub.settings.archivebox, tab.url, { fetchImpl: (u, init) => hub.session("persist:hillium").fetch(u, init) });
        hub.stores.library.data.snapshots.unshift({ ...result, title: tab.title });
        hub.stores.library.save();
        win.send("hillium:toast", { text: "Sent to ArchiveBox" });
      } catch (e) {
        win.send("hillium:toast", { text: e.message, error: true });
      }
      return;
    }
    case "zap":
      return active && hub.zap(active);
    case "boost": {
      const tab = active && m.tab(active);
      return hub.openPage(win, `hillium://library/#boosts${tab ? `=${encodeURIComponent(hostOf(tab.url))}` : ""}`);
    }
    case "library":
      return hub.openPage(win, "hillium://library/");
    case "settings":
      return hub.openPage(win, "hillium://settings/");
    case "import":
      return hub.openPage(win, "hillium://settings/#import");
    case "look-arc":
    case "look-zen":
    case "look-glass":
    case "look-retro":
      return hub.saveSettings({ look: id.slice(5) });
    case "devtools": {
      const wc = hub.webContentsOf(win);
      return wc ? wc.toggleDevTools() : win.ui.webContents.toggleDevTools();
    }
    case "copy":
      return clipboard.writeText(String(arg ?? ""));
    case "quit":
      return app.quit();
    default:
      throw new Error(`unknown command ${id}`);
  }
}
