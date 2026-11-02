// The data behind hillium://settings, hillium://library and hillium://error (token-checked
// in protocol.js). Settings writes go through one allow-list with a check per key.
import { app, session as electronSession } from "electron";
import { execFile } from "node:child_process";
import { registerApi } from "./protocol.js";
import { DEFAULT_SETTINGS } from "./store.js";
import { configureDns } from "./privacy/sessions.js";
import { availableSources, readSource, applyImport } from "./importers/index.js";
import { snapshots } from "./archivebox.js";
import { ENGINES } from "../ui/shared/omni.js";
import { startAgents, stopAgents } from "./agents-switch.js";

const oneOf = (...values) => (v) => values.includes(v);
const bool = (v) => typeof v === "boolean";
const SETTINGS = {
  look: oneOf("arc", "zen", "glass", "retro"),
  appearance: oneOf("system", "light", "dark"),
  searchEngine: (v) => v in ENGINES,
  searchSuggestions: bool,
  archiveAfterHours: oneOf(0, 12, 24, 168),
  doh: oneOf("quad9", "mullvad", "cloudflare", "off"),
  dohMode: oneOf("automatic", "secure"),
  adblock: bool,
  httpsFirst: bool,
  blockThirdPartyCookies: bool,
  trimReferrers: bool,
  gpc: bool,
  blockPings: bool,
  downloadsAsk: bool,
  compact: bool,
  agentAccess: bool,
  linkSpace: (v) => typeof v === "string",
  archivebox: (v) => v && typeof v.url === "string" && typeof v.token === "string" && (!v.url || /^https?:\/\//.test(v.url)),
  httpAllowed: (v) => Array.isArray(v) && v.every((h) => typeof h === "string"),
  siteExceptions: (v) => v && typeof v === "object",
  permissions: (v) => v && typeof v === "object",
};

function isDefaultBrowser() {
  return app.isDefaultProtocolClient("https");
}

function makeDefaultBrowser() {
  if (process.platform === "linux") {
    return new Promise((resolve) => execFile("xdg-settings", ["set", "default-web-browser", "hillium.desktop"], (err) => resolve(!err)));
  }
  return app.setAsDefaultProtocolClient("http") && app.setAsDefaultProtocolClient("https");
}

export function registerPages(hub) {
  const m = hub.model;
  const fetchVia = (u, init) => hub.session("persist:hillium").fetch(u, init);

  registerApi("settings.get", async () => ({
    settings: { ...hub.settings, archivebox: { url: hub.settings.archivebox.url, token: hub.settings.archivebox.token ? "••••" : "" } },
    defaults: DEFAULT_SETTINGS,
    engines: Object.fromEntries(Object.entries(ENGINES).map(([k, e]) => [k, e.name])),
    sources: await availableSources(),
    spaces: m.spaces.map((s) => ({ id: s.id, name: s.name, icon: s.icon })),
    routes: m.data.routes,
    platform: process.platform,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    isDefault: isDefaultBrowser(),
  }));

  registerApi("settings.set", ({ key, value }) => {
    if (!(key in SETTINGS) || !SETTINGS[key](value)) throw new Error(`can't set ${key}`);
    // The token field shows dots; keep the saved token unless a new one was typed.
    if (key === "archivebox" && value.token === "••••") value = { ...value, token: hub.settings.archivebox.token };
    hub.saveSettings({ [key]: value });
    if (key === "doh" || key === "dohMode") configureDns(hub.settings);
    if (key === "agentAccess") (value ? startAgents : stopAgents)(hub);
    return true;
  });

  registerApi("default.set", () => makeDefaultBrowser());

  registerApi("import.run", async ({ source, includeToday }) => {
    const data = await readSource(source);
    return applyImport(m, data, { includeToday: Boolean(includeToday) });
  });

  registerApi("routes.add", ({ pattern, spaceId }) => {
    if (typeof pattern !== "string" || !pattern.trim() || !m.space(spaceId)) throw new Error("pick a pattern and a space");
    m.addRoute(pattern.trim(), spaceId);
    return m.data.routes;
  });
  registerApi("routes.remove", ({ index }) => {
    m.removeRoute(index);
    return m.data.routes;
  });

  registerApi("data.clear", async ({ what }) => {
    const partitions = ["persist:hillium", ...m.spaces.filter((s) => s.profile).map((s) => `persist:space-${s.id}`)];
    if (what === "history" || what === "all") {
      hub.stores.history.data.visits = [];
      hub.stores.history.save();
    }
    for (const p of partitions) {
      const ses = electronSession.fromPartition(p);
      if (what === "cookies" || what === "all") await ses.clearStorageData();
      if (what === "cache" || what === "all") await ses.clearCache();
    }
    return true;
  });

  // ---- library ----

  registerApi("library.get", () => ({
    archive: m.data.archive,
    downloads: hub.stores.library.data.downloads,
    snapshots: hub.stores.library.data.snapshots,
    boosts: hub.boosts.list(),
    history: hub.stores.history.data.visits.slice(-500).reverse(),
    spaces: m.spaces.map((s) => ({ id: s.id, name: s.name, icon: s.icon })),
    archivebox: Boolean(hub.settings.archivebox.url),
  }));

  registerApi("archive.restore", ({ index }) => {
    const win = hub.mainWindow();
    return win ? hub.restoreArchived(win, index) : false;
  });
  registerApi("archive.remove", ({ index }) => {
    if (index === "all") m.data.archive = [];
    else m.data.archive.splice(index, 1);
    m.changed();
    return true;
  });
  registerApi("download.show", ({ path }) => hub.showDownload(path));
  registerApi("downloads.clear", () => {
    hub.stores.library.data.downloads = hub.stores.library.data.downloads.filter((d) => d.state === "progressing");
    hub.stores.library.save();
    return true;
  });
  registerApi("history.remove", ({ url }) => {
    const h = hub.stores.history.data;
    h.visits = url === "all" ? [] : h.visits.filter((v) => v.url !== url);
    hub.stores.history.save();
    return true;
  });
  registerApi("boost.set", ({ host, patch }) => hub.boosts.set(host, patch));
  registerApi("boost.remove", ({ host }) => hub.boosts.remove(host));
  registerApi("snapshots.list", ({ url }) => snapshots(hub.settings.archivebox, url, { fetchImpl: fetchVia }));

  // ---- error page ----

  registerApi("error.allowHttp", ({ host }) => {
    hub.allowHttp(String(host ?? ""));
    return true;
  });
}
