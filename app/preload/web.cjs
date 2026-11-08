// Runs in every web page's isolated world (never in archium:// pages' main world).
// - Tells pages about Global Privacy Control before their scripts run.
// - ⌥-click on a link opens it in Glance instead of navigating.
// - Other link clicks are noted, so a pinned tab can tell a click from a redirect.
const { contextBridge, ipcRenderer } = require("electron");

try {
  contextBridge.executeInMainWorld({
    func: () => {
      Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true, configurable: true });
    },
  });
} catch {
  // Older Electron without executeInMainWorld: the Sec-GPC header still goes out.
}

window.addEventListener(
  "click",
  (event) => {
    if (!event.isTrusted || event.button !== 0) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || !/^https?:/.test(link.href)) return;
    if (!event.altKey) return ipcRenderer.send("archium:link-click", link.href);
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send("archium:glance-link", link.href);
  },
  true,
);
