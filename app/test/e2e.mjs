// End-to-end: Playwright drives the real Archium against a local test server.
// Fake hostnames map to 127.0.0.1 (Ghostery skips cosmetic filters on bare IPs).
//   npm run e2e          (PLAYWRIGHT=/path/to/node_modules/playwright if it isn't installed here)
//   SHOTS=1 npm run e2e  also writes README screenshots to test/screenshots/
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { composeWindow } from "./compose.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
// ARCHIUM_BINARY runs an installed build (the Arch test) instead of this source folder.
const PACKAGED = process.env.ARCHIUM_BINARY;
const CLI = process.env.ARCHIUM_CLI ?? join(APP, "../cli/archium.mjs");
const { _electron } = require(process.env.PLAYWRIGHT ?? "playwright");
const SHOTS = process.env.SHOTS === "1";
const SHOT_DIR = join(HERE, "screenshots");

// ---- the test server ----
const seen = []; // { host, path, headers }
const server = createServer((req, res) => {
  const host = (req.headers.host ?? "").split(":")[0];
  seen.push({ host, path: req.url, headers: req.headers });
  const html = (body) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>${host}</title><body style="font:16px system-ui;margin:40px">${body}</body>`);
  };
  if (host === "tracker.example.org" && req.url === "/set") {
    res.writeHead(200, { "set-cookie": "t=1; Path=/; SameSite=None", "content-type": "text/html" });
    return res.end("<title>tracker</title>cookie set");
  }
  if (host === "tracker.example.org") {
    res.writeHead(200, { "set-cookie": "again=1; Path=/", "content-type": "image/gif" });
    return res.end(Buffer.from("R0lGODlhAQABAAAAACw=", "base64"));
  }
  if (req.url.startsWith("/file.bin")) {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="archium-test.bin"' });
    return res.end(Buffer.alloc(2048, 1));
  }
  if (req.url.startsWith("/permission")) {
    return html(`<h1>Permission</h1><script>setTimeout(() => Notification.requestPermission().then((p) => (document.title = "perm:" + p)), 300)</script>`);
  }
  if (req.url.startsWith("/other")) return html(`<h1 id="other">Other page</h1>`);
  html(`<h1 id="title">News article</h1>
    <p id="gpc"></p>
    <div class="adsbygoogle" id="ad-slot" style="display:block;height:90px;background:#fcc">AD</div>
    <img src="http://tracker.example.org:${port}/assets/logo.gif?article=4">
    <a id="link" href="http://news.example.com:${port}/other">Read more</a>
    <a id="away" href="http://other.example.net:${port}/other">Elsewhere</a>
    <a id="download" href="http://news.example.com:${port}/file.bin">Download</a>
    <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
    <script>document.getElementById("gpc").textContent = "gpc:" + navigator.globalPrivacyControl; window.__ua = navigator.userAgent;</script>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const NEWS = `http://news.example.com:${port}/article?id=4&utm_source=e2e&fbclid=x`;

// ---- a fresh profile ----
const userData = mkdtempSync(join(tmpdir(), "archium-e2e-"));
const downloads = mkdtempSync(join(tmpdir(), "archium-dl-"));
writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({ httpAllowed: ["news.example.com", "tracker.example.org", "other.example.net"], agentAccess: true, archiveAfterHours: 12 }),
);
const netlog = join(userData, "netlog.json");

const app = await _electron.launch({
  executablePath: PACKAGED ?? require("electron"),
  args: [...(PACKAGED ? [] : [APP]), ...(process.env.E2E_NO_SANDBOX ? ["--no-sandbox"] : []), "--host-resolver-rules=MAP *.example.com 127.0.0.1, MAP *.example.org 127.0.0.1, MAP *.example.net 127.0.0.1"],
  env: { ...process.env, ARCHIUM_TEST: "1", ARCHIUM_USER_DATA: userData, ARCHIUM_WAIT_ADBLOCK: "1", ARCHIUM_NETLOG: netlog },
});
app.process().stderr.on("data", (d) => {
  const s = String(d);
  if (/Error|error/.test(s) && !/task_policy|sandbox_extension|GPU|gpu|Debugger|Fontconfig|dbus|libva/.test(s)) process.stderr.write(`[app] ${s}`);
});

const main = (fn, arg) => app.evaluate(fn, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// E2E_SLOW stretches every wait (amd64 emulation in the Arch container is several times slower).
const SLOW = Number(process.env.E2E_SLOW ?? 1);
async function until(fn, what, ms = 10000) {
  const end = Date.now() + ms * SLOW;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}
async function pageFor(prefix) {
  return until(() => app.windows().find((p) => p.url().startsWith(prefix)), `page ${prefix}`);
}

const results = [];
async function check(name, fn) {
  try {
    await Promise.race([fn(), sleep(90000 * SLOW).then(() => Promise.reject(new Error("check took too long")))]);
    results.push([true, name]);
    console.log(`✔ ${name}`);
  } catch (e) {
    results.push([false, name, e.message]);
    console.log(`✖ ${name}\n    ${e.message.split("\n")[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await sleep(500);
  writeFileSync(join(SHOT_DIR, `${name}.png`), await composeWindow(app));
}

const ui = await pageFor("archium://chrome");
await main(({ app: a }, dir) => a.setPath("downloads", dir), downloads);
const state = () => ui.evaluate(() => document.body.className);

// The Arch test starts Archium through /usr/bin/archium, which adds its own features.
if (process.env.E2E_EXPECT_FEATURE) {
  await check("features from the launcher are kept next to Archium's", async () => {
    const value = await main(({ app: a }) => a.commandLine.getSwitchValue("enable-features"));
    assert(value.includes(process.env.E2E_EXPECT_FEATURE) && value.includes("SplitCacheByNetworkIsolationKey"), value);
  });
}

await check("the window opens on the empty card", async () => {
  await until(() => ui.evaluate(() => document.querySelector("#empty") && getComputedStyle(document.querySelector("#empty")).display !== "none"), "empty card");
  await shot("empty");
});

await check("a page loads, tracking parameters are gone and GPC is on", async () => {
  await main(({}, url) => {
    const hub = globalThis.__archium;
    hub.newTab([...hub.windows][0], url);
  }, NEWS);
  const page = await pageFor(`http://news.example.com:${port}/article`);
  await until(() => page.evaluate(() => document.getElementById("gpc")?.textContent === "gpc:true"), "navigator.globalPrivacyControl");
  assert(!page.url().includes("utm_source") && !page.url().includes("fbclid"), `tracking params left: ${page.url()}`);
  assert(page.url().includes("id=4"), "kept the real parameter");
  const req = seen.find((s) => s.host === "news.example.com" && s.path.startsWith("/article"));
  assert(req.headers["sec-gpc"] === "1", "Sec-GPC header");
  assert(!/Electron|Archium/.test(req.headers["user-agent"]), `user agent: ${req.headers["user-agent"]}`);
  assert(!/Electron/.test(await page.evaluate(() => window.__ua)), "navigator.userAgent");
});

await check("ads are blocked: the tracker script never loads and the ad slot is hidden", async () => {
  const page = await pageFor(`http://news.example.com:${port}/article`);
  await until(() => page.evaluate(() => getComputedStyle(document.getElementById("ad-slot")).display === "none"), "cosmetic filter on .adsbygoogle");
  const blocked = await main(() => [...globalThis.__archium.views.values()].reduce((n, e) => n + (e.runtime.blocked ?? 0), 0));
  assert(blocked >= 1, `blocked count ${blocked}`);
  await until(() => ui.evaluate(() => document.querySelector("#url-site").dataset.blocked), "blocked badge");
});

await check("third parties get no cookies and only the referring site", async () => {
  // A first-party visit sets the tracker's cookie…
  await main(({}, url) => {
    const hub = globalThis.__archium;
    hub.newTab([...hub.windows][0], url);
  }, `http://tracker.example.org:${port}/set`);
  await pageFor(`http://tracker.example.org:${port}/set`);
  await sleep(300);
  // …which it doesn't get back when embedded in the news page.
  await main(() => {
    const hub = globalThis.__archium;
    const w = [...hub.windows][0];
    const id = w.model.allTabIds().find((t) => w.model.tab(t).url.includes("news.example.com"));
    hub.activate(w, id);
    hub.views.get(id).view.webContents.reload();
  });
  await sleep(1500);
  const pixel = seen.filter((s) => s.host === "tracker.example.org" && s.path.startsWith("/assets/logo.gif")).at(-1);
  assert(pixel, "the pixel was requested");
  assert(!pixel.headers.cookie, `cookie sent: ${pixel.headers.cookie}`);
  assert(pixel.headers.referer === `http://news.example.com:${port}/`, `referer: ${pixel.headers.referer}`);
});

await check("HTTPS first: a site without HTTPS gets the fallback page, and http works after", async () => {
  await main(({}, url) => {
    const hub = globalThis.__archium;
    hub.newTab([...hub.windows][0], url);
  }, `http://plain.example.com:${port}/`);
  const err = await pageFor("archium://error");
  await until(() => err.evaluate(() => !document.getElementById("http").hidden), "Continue on http button");
  await err.click("#http", { force: true });
  await pageFor(`http://plain.example.com:${port}/`);
  const allowed = await main(() => globalThis.__archium.settings.httpAllowed);
  assert(allowed.includes("plain.example.com"), "host remembered");
});

await check("web pages can't open or call archium:// pages", async () => {
  const page = await pageFor(`http://news.example.com:${port}/article`);
  const r = await page.evaluate(async () => {
    const out = {};
    try {
      await fetch("archium://settings/api/settings.get?t=x", { method: "POST" });
      out.fetch = "allowed";
    } catch {
      out.fetch = "blocked";
    }
    location.href = "archium://settings/";
    await new Promise((res) => setTimeout(res, 500));
    out.url = location.href;
    return out;
  });
  assert(r.fetch === "blocked", "fetch to archium:// went through");
  assert(r.url.startsWith("http://news.example.com"), `navigated to ${r.url}`);
});

await check("Settings and Library open as tabs and their data loads", async () => {
  await main(() => {
    const hub = globalThis.__archium;
    hub.openPage([...hub.windows][0], "archium://settings/");
  });
  const settings = await pageFor("archium://settings");
  await until(() => settings.evaluate(() => document.querySelectorAll(".row").length > 10), "settings rows");
  await shot("settings");
  await main(() => {
    const hub = globalThis.__archium;
    hub.openPage([...hub.windows][0], "archium://library/");
  });
  const library = await pageFor("archium://library");
  await until(() => library.evaluate(() => document.querySelector(".tabs-nav button.on")?.textContent === "Archived tabs"), "library");
});

await check("spaces: a new space, switching, pinning, favourites", async () => {
  const r = await main(() => {
    const hub = globalThis.__archium;
    const w = [...hub.windows][0];
    const m = w.model;
    const first = w.spaceId;
    const news = m.allTabIds().find((t) => m.tab(t).url.includes("news.example.com"));
    hub.place(w, news, { zone: "pinned", spaceId: first });
    const tracker = m.allTabIds().find((t) => m.tab(t).url.includes("tracker"));
    hub.place(w, tracker, { zone: "favourites" });
    const work = hub.addSpace(w, { name: "Work", icon: "💼", colors: [[40, 160, 120], [30, 90, 200]] });
    const onWork = w.spaceId === work.id;
    hub.switchSpace(w, first);
    return { onWork, back: w.spaceId === first, pinned: m.locate(news).zone, fav: m.data.favourites.length, spaces: m.spaces.length };
  });
  assert(r.onWork && r.back, "switching");
  assert(r.pinned === "pinned" && r.fav === 1 && r.spaces === 2, JSON.stringify(r));
  await until(() => ui.evaluate(() => document.querySelectorAll(".space-dot").length === 2 && document.querySelectorAll(".fav").length === 1), "sidebar shows it");
  await shot("arc");
});

await check("the command bar finds a tab in another space and switches to it", async () => {
  await main(({}, port) => {
    const hub = globalThis.__archium;
    const w = [...hub.windows][0];
    const work = w.model.spaces.find((s) => s.name === "Work");
    hub.newTab(w, `http://news.example.com:${port}/other`, { spaceId: work.id, background: true });
    w.send("archium:command", { id: "new-tab" });
  }, port);
  await until(() => ui.evaluate(() => !document.getElementById("command").hidden), "command bar");
  await ui.keyboard.type("/other");
  await until(() => ui.evaluate(() => document.querySelector("#results .item.selected .badge")?.textContent.includes("Work")), "tab result in Work");
  await shot("command-bar");
  await ui.keyboard.press("Enter");
  await until(() => main(() => [...globalThis.__archium.windows][0].model.space([...globalThis.__archium.windows][0].spaceId).name === "Work"), "switched to Work");
  await until(() => ui.evaluate(() => document.getElementById("command").hidden), "command bar closed");
});

await check("⌥-click opens Glance; it expands into a tab", async () => {
  await main(() => {
    const hub = globalThis.__archium;
    const w = [...hub.windows][0];
    hub.switchSpace(w, w.model.spaces[0].id);
    const news = w.model.allTabIds().find((t) => w.model.tab(t).url.includes("/article"));
    hub.activate(w, news);
  });
  const page = await pageFor(`http://news.example.com:${port}/article`);
  await page.click("#link", { modifiers: ["Alt"], force: true });
  await until(() => main(() => Boolean([...globalThis.__archium.windows][0].glance)), "glance open");
  await until(() => ui.evaluate(() => !document.getElementById("glance-buttons").hidden), "glance buttons");
  await sleep(800);
  await shot("glance");
  const before = await main(() => [...globalThis.__archium.windows][0].model.allTabIds().length);
  await ui.click("#glance-expand", { force: true });
  await until(() => main(() => ![...globalThis.__archium.windows][0].glance), "glance closed");
  const after = await main(() => [...globalThis.__archium.windows][0].model.allTabIds().length);
  assert(after === before + 1, `tabs ${before} → ${after}`);
});

await check("links from a pinned tab to another site open in Glance (Peek)", async () => {
  await main(() => {
    const hub = globalThis.__archium;
    const w = [...hub.windows][0];
    const news = w.model.allTabIds().find((t) => w.model.tab(t).url.includes("/article"));
    hub.activate(w, news);
  });
  const page = await pageFor(`http://news.example.com:${port}/article`);
  await page.click("#away", { force: true, noWaitAfter: true });
  await until(() => main(() => [...globalThis.__archium.windows][0].glance?.url?.includes("other.example.net")), "peek");
  assert(page.url().includes("news.example.com"), "the pinned tab stayed");
  await main(() => globalThis.__archium.closeGlance([...globalThis.__archium.windows][0]));
});

await check("split view shows two pages side by side", async () => {
  const r = await main(() => {
    const hub = globalThis.__archium;
    const w = [...hub.windows][0];
    const m = w.model;
    const ids = m.tabsIn(m.space(w.spaceId)).filter((t) => /example\.com/.test(m.tab(t).url)).slice(0, 2);
    hub.split(w, ids);
    return ids.map((id) => hub.views.get(id).view.getBounds());
  });
  assert(r.length === 2 && r[0].x + r[0].width < r[1].x && r[0].y === r[1].y, JSON.stringify(r));
  await until(() => ui.evaluate(() => document.querySelectorAll(".zen-split-view-splitter").length === 1), "splitter");
  await shot("split");
  await main(() => {
    const hub = globalThis.__archium;
    const w = [...hub.windows][0];
    hub.unsplit(w, w.activeTab);
  });
});

await check("Today tabs are archived after the set time; pinned ones stay", async () => {
  const r = await main(() => {
    const hub = globalThis.__archium;
    const m = hub.model;
    const w = [...hub.windows][0];
    const today = m.spaces.flatMap((s) => s.today).filter((t) => !w.visibleTabs().includes(t));
    for (const id of m.allTabIds()) m.tab(id).lastActive -= 13 * 3600_000;
    const keep = new Set(w.visibleTabs());
    const archived = m.archiveStale(12, keep);
    for (const id of archived) hub.destroyView(id);
    const pinnedLeft = m.space(w.spaceId).items.length;
    return { expected: today.length, archived: archived.length, pinnedLeft };
  });
  assert(r.archived === r.expected && r.pinnedLeft >= 1, JSON.stringify(r));
});

await check("boosts restyle a site; Zap hides an element", async () => {
  await main(({}, sel) => {
    const hub = globalThis.__archium;
    hub.boosts.set("news.example.com", { css: "h1 { color: rgb(1, 2, 3) !important; }" });
    hub.boosts.addZap("news.example.com", sel);
    const w = [...hub.windows][0];
    const id = w.model.allTabIds().find((t) => w.model.tab(t).url.includes("/article"));
    hub.activate(w, id);
    hub.views.get(id).view.webContents.reload();
  }, "#gpc");
  const page = await pageFor(`http://news.example.com:${port}/article`);
  await until(() => page.evaluate(() => getComputedStyle(document.getElementById("title")).color === "rgb(1, 2, 3)"), "boost CSS");
  await until(() => page.evaluate(() => getComputedStyle(document.getElementById("gpc")).display === "none"), "zapped");
});

await check("site permissions ask in the window", async () => {
  await main(({}, url) => {
    const hub = globalThis.__archium;
    hub.newTab([...hub.windows][0], url);
  }, `http://news.example.com:${port}/permission`);
  await until(() => ui.evaluate(() => !document.getElementById("permission").hidden), "prompt");
  await shot("permission");
  await ui.click("#permission-block", { force: true });
  const page = await pageFor(`http://news.example.com:${port}/permission`);
  // Chromium answers a blocked request with "denied" (or "default" when the prompt is dismissed).
  await until(() => page.evaluate(() => /^perm:(denied|default)$/.test(document.title) && document.title), "answered");
  const saved = await main(() => globalThis.__archium.settings.permissions);
  assert(Object.entries(saved).some(([k, v]) => k.endsWith("|notifications") && v === false), JSON.stringify(saved));
});

await check("downloads go to the downloads folder", async () => {
  const page = await pageFor(`http://news.example.com:${port}/article`);
  await page.click("#download", { force: true });
  await until(() => existsSync(join(downloads, "archium-test.bin")), "file");
  await until(() => main(() => globalThis.__archium.stores.library.data.downloads[0]?.state === "completed"), "recorded");
});

await check("compact mode hides the sidebar; the left edge brings it back", async () => {
  await main(() => globalThis.__archium.saveSettings({ compact: true }));
  await until(() => state().then((c) => c.includes("compact")), "compact");
  // The page follows the UI's layout a frame later.
  await until(
    () =>
      main(() => {
        const hub = globalThis.__archium;
        const w = [...hub.windows][0];
        return hub.views.get(w.activeTab).view.getBounds().x < 30;
      }),
    "the page to fill the window",
  );
  await ui.dispatchEvent("#edge", "mouseenter");
  await until(() => state().then((c) => c.includes("reveal") && c.includes("overlay")), "revealed over the page");
  await shot("compact");
  await main(() => globalThis.__archium.saveSettings({ compact: false }));
  await ui.dispatchEvent("#sidebar", "mouseleave");
});

for (const look of ["zen", "glass", "retro"]) {
  await check(`the ${look} look applies`, async () => {
    await main(({}, look) => globalThis.__archium.saveSettings({ look }), look);
    await until(() => ui.evaluate((l) => document.body.dataset.look === l && !document.querySelector(`link[data-look="${l}"]`).disabled, look), look);
    await shot(`look-${look}`);
  });
}
await main(() => globalThis.__archium.saveSettings({ look: "arc" }));

await check("private windows stay out of agents' sight", async () => {
  await main(({}, url) => {
    const hub = globalThis.__archium;
    const w = hub.createWindow({ isPrivate: true });
    hub.newTab(w, url);
  }, `http://news.example.com:${port}/other?private`);
  // Asked of the app itself: Playwright doesn't always list pages opened after a window closed.
  await until(
    () => main(() => [...globalThis.__archium.views.values()].some((e) => e.model.private && /\?private$/.test(e.view.webContents.getURL()) && !e.view.webContents.isLoading())),
    "the private tab",
  );
  const out = execFileSync(process.execPath, [CLI, "tabs", "--json"], { env: { ...process.env, ARCHIUM_USER_DATA: userData } }).toString();
  const tabs = JSON.parse(out);
  assert(tabs.length > 0, "the CLI sees tabs");
  assert(!out.includes("?private"), "a private tab showed up");
  await main(() => {
    const hub = globalThis.__archium;
    for (const w of hub.windows) if (w.isPrivate) w.base.close();
  });
});

await check("an MCP client reads a page through `archium mcp`", async () => {
  const child = spawn(process.execPath, [CLI, "mcp"], { env: { ...process.env, ARCHIUM_USER_DATA: userData } });
  const replies = [];
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      replies.push(JSON.parse(buf.slice(0, nl)));
      buf = buf.slice(nl + 1);
    }
  });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await main(() => {
    const hub = globalThis.__archium;
    const w = [...hub.windows][0];
    const id = w.model.allTabIds().find((t) => w.model.tab(t).url.includes("/article"));
    hub.activate(w, id);
  });
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_page_text", arguments: {} } });
  await until(() => replies.find((r) => r.id === 2), "tool reply");
  child.kill();
  const text = replies.find((r) => r.id === 2).result.content[0].text;
  assert(replies[0].result.serverInfo.name === "archium", "initialize");
  assert(text.includes("News article"), text.slice(0, 200));
});

// Last: after a window closes, Playwright can lose track of new pages on Linux.
await check("Little Archium opens a link and moves it into the main window", async () => {
  const n = await main(({}, url) => {
    const hub = globalThis.__archium;
    hub.openMini(url);
    return hub.model.allTabIds().length;
  }, `http://news.example.com:${port}/other`);
  await pageFor("archium://mini");
  await until(() => main(() => [...globalThis.__archium.minis][0]?.view.webContents.getURL().includes("/other")), "mini loaded");
  await main(() => [...globalThis.__archium.minis][0].moveToMain());
  await until(() => main((_, n) => globalThis.__archium.model.allTabIds().length === n + 1 && globalThis.__archium.minis.size === 0, n), "moved");
});

const arcFile = join(process.env.HOME ?? "", "Library/Application Support/Arc/StorableSidebar.json");
await check("Arc's sidebar imports (read-only)", async () => {
  if (!existsSync(arcFile)) return console.log("    (Arc isn't installed here: skipped)");
  const before = readFileSync(arcFile, "utf8");
  await main(() => {
    const hub = globalThis.__archium;
    hub.openPage([...hub.windows][0], "archium://settings/");
  });
  const settings = await pageFor("archium://settings");
  const r = await settings.evaluate(async () => {
    const { api } = await import("/_/pages/api.js");
    return api("import.run", { source: "arc" });
  });
  assert(typeof r.added === "number", JSON.stringify(r));
  assert(readFileSync(arcFile, "utf8") === before, "Arc's file changed");
});

// Closing can hang on a slow machine; the network log is complete either way once the process ends.
await Promise.race([app.close(), sleep(20000 * SLOW).then(() => app.process().kill("SIGKILL"))]);
server.close();

await check("no request went to Google", async () => {
  // Scanned as text: the log is large and its last line can be cut short at exit.
  const hosts = new Set();
  for (const [, url] of readFileSync(netlog, "utf8").matchAll(/"url":"(https?:\/\/[^"]+)"/g)) {
    try {
      hosts.add(new URL(url).hostname);
    } catch {}
  }
  const google = [...hosts].filter((h) => /(^|\.)(google|googleapis|gstatic|gvt1|gvt2|googleusercontent|doubleclick|googlesyndication|google-analytics)\./.test(h));
  console.log(`    hosts contacted: ${[...hosts].filter((h) => !/example\.(com|org|net)$/.test(h)).join(", ") || "none"}`);
  assert(google.length === 0, `contacted ${google.join(", ")}`);
});

const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
