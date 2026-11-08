// Archium's entry point: Helium-style switches before the app is ready, then stores, the
// privacy layer, the archium:// pages, the menu and the first window.
import { app, nativeTheme } from "electron";
import { join } from "node:path";
import { openStores } from "./store.js";
import { registerScheme } from "./protocol.js";
import { configureDns, chromeUserAgent } from "./privacy/sessions.js";
import { startAdblock } from "./privacy/adblock.js";
import { hostOf } from "./privacy/filter.js";
import { Hub } from "./hub.js";
import { registerIpc } from "./ipc.js";
import { registerPages } from "./pages.js";
import { buildMenu } from "./menu.js";
import { MiniWindow } from "./mini.js";
import { startAgents } from "./agents-switch.js";

app.setName("Archium");
// ARCHIUM_USER_DATA keeps tests and the CLI pointed at the same folder.
app.setPath("userData", process.env.ARCHIUM_USER_DATA || join(app.getPath("appData"), "Archium"));

// Helium-style defaults Electron doesn't set itself.
const sw = app.commandLine;
// Adds to a feature list instead of replacing it, so flags from the Arch wrapper or the user's
// archium-flags.conf survive (a second appendSwitch would overwrite the first).
const addFeatures = (name, list) => {
  const existing = sw.getSwitchValue(name).split(",").filter(Boolean);
  sw.appendSwitch(name, [...new Set([...existing, ...list])].join(","));
};
addFeatures("disable-features", ["InterestFeedContentSuggestions", "OptimizationHints", "MediaRouter", "AutofillServerCommunication", "SpareRendererForSitePerProcess"]);
// Partition caches, connections and storage by the top-level site (Brave turns on the same
// Chromium features), clear window.name across sites, and phase out third-party cookies.
addFeatures("enable-features", [
  "ReducedSystemInfo",
  "PartitionedCookies",
  "ThirdPartyStoragePartitioning",
  "SplitCacheByNetworkIsolationKey",
  "SplitCodeCacheByNetworkIsolationKey",
  "PartitionConnectionsByNetworkIsolationKey",
  "PartitionSSLSessionsByNetworkIsolationKey",
  "PartitionHttpServerPropertiesByNetworkIsolationKey",
  "PartitionNelAndReportingByNetworkIsolationKey",
  "ClearCrossSiteCrossBrowsingContextGroupWindowName",
]);
sw.appendSwitch("test-third-party-cookie-phaseout");
sw.appendSwitch("disable-domain-reliability");
sw.appendSwitch("no-pings");
sw.appendSwitch("disable-background-networking");
sw.appendSwitch("webrtc-ip-handling-policy", "default_public_interface_only");
if (process.platform === "linux" && !sw.hasSwitch("ozone-platform-hint")) sw.appendSwitch("ozone-platform-hint", "auto");
if (process.env.ARCHIUM_NETLOG) sw.appendSwitch("log-net-log", process.env.ARCHIUM_NETLOG);
app.userAgentFallback = chromeUserAgent();
registerScheme();

const pendingLinks = [];
let hub = null;
const isLink = (s) => typeof s === "string" && /^https?:\/\//i.test(s);
const linksIn = (argv) => argv.slice(1).filter(isLink);

// Every session, including Electron's default one and the window UI's: Chromium's Hunspell
// dictionaries come from Google (redirector.gvt1.com). macOS uses its own spellchecker.
app.on("session-created", (ses) => {
  ses.setSpellCheckerDictionaryDownloadURL("https://0.0.0.0/");
  if (process.platform !== "darwin") ses.setSpellCheckerEnabled(false);
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (hub) hub.openExternalLink(url);
  else pendingLinks.push(url);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    if (!hub) return;
    if (argv.includes("--private")) return hub.createWindow({ isPrivate: true });
    const links = linksIn(argv);
    if (links.length) links.forEach((l) => hub.openExternalLink(l));
    else (hub.mainWindow() ?? hub.createWindow()).base.focus();
  });

  app.whenReady().then(async () => {
    const stores = openStores(app.getPath("userData"));
    hub = new Hub({ stores });
    hub.openMini = (url) => new MiniWindow(hub, url);
    if (process.env.ARCHIUM_TEST) globalThis.__archium = hub;
    nativeTheme.themeSource = stores.settings.data.appearance;
    configureDns(stores.settings.data);
    registerIpc(hub);
    registerPages(hub);
    buildMenu(hub);
    // Blocking starts as soon as the lists load; pages opened before that aren't filtered by it.
    const adblock = startAdblock({
      allowCosmetics: (url) => hub.settings.adblock && hub.settings.siteExceptions[hostOf(url)]?.adblock !== false,
    });
    if (process.env.ARCHIUM_WAIT_ADBLOCK) await adblock;
    if (stores.settings.data.agentAccess) startAgents(hub);

    hub.createWindow();
    if (process.argv.includes("--private")) hub.createWindow({ isPrivate: true });
    for (const url of [...pendingLinks, ...linksIn(process.argv)]) hub.openExternalLink(url);
    pendingLinks.length = 0;

    // Today tabs move to the archive after the chosen time; checked every ten minutes.
    const sweep = () => {
      const keep = new Set();
      for (const w of hub.windows) for (const id of w.visibleTabs()) keep.add(id);
      for (const [id, entry] of hub.views) if (entry.runtime.audible) keep.add(id);
      for (const id of hub.model.archiveStale(hub.settings.archiveAfterHours, keep)) hub.destroyView(id);
    };
    sweep();
    setInterval(sweep, 10 * 60 * 1000).unref();

    nativeTheme.on("updated", () => hub.schedulePush());
    app.on("activate", () => {
      if (![...hub.windows].some((w) => !w.closed)) hub.createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (!hub) return;
  for (const store of Object.values(hub.stores)) if (store.timer) store.flush();
});
