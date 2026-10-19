// End-to-end checks in the real app, driven by Playwright's Electron support.
// Needs no internet once the ad-block engine is cached (the first run downloads it).
//   npm run e2e            the checks below, plus screenshots in test/screenshots/
//   AI=1 npm run e2e       also loads the real MiniCPM-V model and asks it about a page
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { composeWindow } from "./compose.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(root, "package.json"));
const playwright = process.env.PLAYWRIGHT ? require(process.env.PLAYWRIGHT) : require("playwright");
const shots = join(root, "test", "screenshots");
mkdirSync(shots, { recursive: true });

// A local site: a page with a tracker script and a link carrying tracking parameters.
const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  if (req.url.startsWith("/article")) {
    return res.end(`<!doctype html><title>Archium test article</title><main><h1>Lighthouses</h1>
      <p>A lighthouse is a tower with a bright lamp that guides ships at night and warns them of rocks.</p>
      <p>The Pharos of Alexandria, built around 280 BC, was one of the Seven Wonders of the Ancient World.</p></main>`);
  }
  res.end(`<!doctype html><title>Archium test page</title><h1>Test page</h1>
    <script src="https://www.google-analytics.com/analytics.js"></script>
    <script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>
    <a id="out" href="/article?utm_source=newsletter&id=7&fbclid=abc">Read the article</a>
    <div class="ad_banner" id="slot1" style="width:300px;height:250px">ad</div>
    <div id="carbonads"><span id="slot2">ad</span></div>
    <div id="keep" class="story">story</div>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
// A real-looking name mapped to the local server: Ghostery skips cosmetic rules on bare IPs.
const site = `http://news.example.com:${server.address().port}`;

// A fresh profile each run. The compiled block lists are copied in when this Mac has them,
// so the run needs no internet.
const userData = mkdtempSync(join(tmpdir(), "archium-e2e-"));
const cachedEngine = join(homedir(), "Library", "Application Support", "Archium Browser", "adblock-engine.bin");
if (existsSync(cachedEngine)) copyFileSync(cachedEngine, join(userData, "adblock-engine.bin"));
const app = await playwright._electron.launch({
  executablePath: require("electron"),
  args: [root, "--host-resolver-rules=MAP news.example.com 127.0.0.1"],
  env: { ...process.env, ARCHIUM_TEST: "1", ARCHIUM_USER_DATA: userData },
});
const errors = [];
app.on("window", (p) => p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`)));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const main = (fn, arg) => app.evaluate(fn, arg);
const shell = () => main(() => {
  const s = [...globalThis.__archium.shells][0];
  return { ...s.snapshot(), urls: s.tabs.map((t) => t.url) };
});
const run = (command, arg) => main((_, [c, a]) => globalThis.__archium.run(c, a), [command, arg]);
async function until(check, what, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await wait(200);
  }
}

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}\n    ${e.message}`);
  }
}
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const ui = () => until(() => app.windows().find((w) => w.url() === "archium://app/chrome.html"), "the toolbar page");

try {
  await ui();
  await until(() => main(() => [...globalThis.__archium.shells][0]?.tabs.length), "the first tab");

  await check("opens with the new tab page", async () => {
    const s = await shell();
    assert(s.urls[0] === "archium://newtab/", `first tab is ${s.urls[0]}`);
  });

  await check("ad blocker engine is ready", async () => {
    await until(() => main(() => globalThis.__archium.blockerReady()), "Ghostery's engine", 120000);
  });

  await check("blocks trackers on a page", async () => {
    await main((_, url) => [...globalThis.__archium.shells][0].navigate(url), `${site}/`);
    await until(async () => (await shell()).blocked >= 2, "2 blocked requests");
  });

  await check("hides ad slots (cosmetic filtering)", async () => {
    const page = await until(() => app.windows().find((w) => w.url().startsWith(site)), "the test page");
    const shown = await until(() => page.evaluate(() => {
      // An ancestor hidden counts as hidden.
      const visible = (id) => document.getElementById(id).checkVisibility();
      return visible("keep") && !visible("slot1") && !visible("slot2") ? "ok" : null;
    }), "ad slots hidden", 8000);
    assert(shown === "ok", "ad slots still visible");
  });

  await check("strips tracking parameters from links", async () => {
    const page = await until(() => app.windows().find((w) => w.url().startsWith(site)), "the test page");
    await page.click("#out");
    await until(async () => (await shell()).url.includes("/article"), "the article");
    const { url } = await shell();
    assert(url === `${site}/article?id=7`, `got ${url}`);
  });

  for (const theme of ["normal", "win98", "glass"]) {
    await check(`renders the ${theme} look`, async () => {
      await run("theme", theme);
      const page = await ui();
      await until(() => page.evaluate((t) => document.body.dataset.theme === t, theme), `data-theme=${theme}`);
      const s = await shell();
      assert(s.tabs.length === 1 && !s.assistantOpen, `unexpected state: ${s.tabs.length} tabs, assistant ${s.assistantOpen}`);
      if (theme === "glass") {
        const glass = await main(() => ({ native: globalThis.__archium.nativeGlass(), id: [...globalThis.__archium.shells][0].glassId }));
        assert(!glass.native || glass.id >= 0, `native glass supported but not added (id ${glass.id})`);
        console.log(`    window material: ${glass.native ? `native NSGlassEffectView (id ${glass.id})` : "vibrancy fallback"}`);
      }
      await wait(800);
      writeFileSync(join(shots, `look-${theme}-page.png`), await composeWindow(app));
      await run("new-tab");
      await wait(1500);
      writeFileSync(join(shots, `look-${theme}-newtab.png`), await composeWindow(app));
      writeFileSync(join(shots, `look-${theme}-newtab-plain.png`), await composeWindow(app, 0, "plain"));
      await run("close-tab");
    });
  }
  await run("theme", "normal");

  await check("⌘K palette finds the open tab", async () => {
    const page = await ui();
    await run("palette");
    await page.waitForSelector("#palette:not([hidden])");
    await page.fill("#palette-input", "Archium test");
    await page.waitForSelector(".palette-item >> text=Archium test article");
    await wait(300);
    writeFileSync(join(shots, "palette.png"), await composeWindow(app));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#palette", { state: "hidden" });
    assert(!(await main(() => [...globalThis.__archium.shells][0].overlay)), "overlay stayed on");
  });

  await check("tabs move to the side and back", async () => {
    await run("tabs-position");
    const page = await ui();
    await page.waitForSelector("#sidebar .tab");
    await run("tabs-position");
  });

  await check("Focus Mode shows only the page", async () => {
    await run("focus-mode");
    await until(async () => (await main(() => [...globalThis.__archium.shells][0].layout.page.y)) === 0, "the page at the top");
    await run("focus-mode");
    await until(async () => (await main(() => [...globalThis.__archium.shells][0].layout.page.y)) > 0, "the toolbar back");
  });

  await check("Glance opens in the corner and moves its page to a tab", async () => {
    await run("glance");
    const glance = await until(() => app.windows().find((w) => w.url() === "archium://app/glance.html"), "Glance");
    await until(() => main(() => globalThis.__archium.glance.win?.isVisible()), "Glance visible");
    await main((_, url) => globalThis.__archium.glance.navigate(url), `${site}/article`);
    await until(() => main(() => globalThis.__archium.glance.page.webContents.getURL().includes("/article")), "Glance page");
    await glance.click("#open");
    await until(async () => (await shell()).urls.some((u) => u === `${site}/article`), "the page in a tab");
  });

  await check("private tabs stay out of history and the assistant", async () => {
    await run("new-private-tab");
    await main((_, url) => [...globalThis.__archium.shells][0].navigate(url), `${site}/article?private=1`);
    await until(async () => (await shell()).url.includes("private=1"), "the private page");
    const inHistory = await main(() => globalThis.__archium.history().some((h) => h.url.includes("private=1")));
    assert(!inHistory, "private page was saved to history");
    const refused = await main(() => [...globalThis.__archium.shells][0].pageText().then(() => false, () => true));
    assert(refused, "assistant could read a private tab");
    await run("close-tab");
  });

  await check("assistant answers about the page (scripted engine)", async () => {
    await main((_, url) => [...globalThis.__archium.shells][0].navigate(url), `${site}/article`);
    await wait(800);
    await run("assistant");
    const panel = await until(() => app.windows().find((w) => w.url() === "archium://app/assistant.html"), "the assistant");
    await panel.waitForLoadState();
    await panel.evaluate(() => {
      globalThis.__archiumEngineFactory = () => ({
        async chat(messages, onDelta) {
          const last = messages.at(-1).content;
          onDelta(last.includes("Pharos") ? "It is about lighthouses." : "No page text arrived.");
        },
      });
    });
    await panel.fill("#input", "What is this page about?");
    await panel.click("#send");
    await panel.waitForSelector(".msg.assistant:not(.pending)");
    const answer = await panel.textContent(".msg.assistant");
    assert(answer === "It is about lighthouses.", `got “${answer}”`);
    writeFileSync(join(shots, "assistant.png"), await composeWindow(app));
  });

  await check("Tor mode with Tor down fails closed", async () => {
    await main(() => globalThis.__archium.setSettings({ mode: "tor", torPort: 9 }));
    await main(() => [...globalThis.__archium.shells][0].navigate("https://example.com/"));
    await until(async () => (await shell()).status, "the kill-switch banner");
    const { status } = await shell();
    // The address bar shows the failed URL on purpose; the page itself must not have loaded.
    const text = await main(() => [...globalThis.__archium.shells][0].active.view.webContents.executeJavaScript("document.title + ' ' + (document.body?.innerText ?? '')"));
    assert(!/Example Domain/.test(text), "example.com loaded without Tor");
    writeFileSync(join(shots, "kill-switch.png"), await composeWindow(app));
    await main(() => globalThis.__archium.setSettings({ mode: "direct" }));
    console.log(`    banner: ${status}`);
  });

  if (process.env.AI) {
    await check("MiniCPM-V summarizes a page (real model)", async () => {
      await main((_, url) => [...globalThis.__archium.shells][0].navigate(url), `${site}/article`);
      await until(async () => (await shell()).url === `${site}/article`, "the article");
      const panel = app.windows().find((w) => w.url() === "archium://app/assistant.html");
      await panel.evaluate(() => delete globalThis.__archiumEngineFactory);
      await panel.reload();
      await panel.waitForLoadState();
      if (await panel.locator("#download").isVisible()) {
        await panel.click("#download");
        await panel.waitForFunction(() => document.getElementById("setup").hidden, null, { timeout: 900000 });
      }
      await panel.waitForFunction(() => /WebGPU|CPU/.test(document.getElementById("model-line").textContent), null, { timeout: 300000 });
      const ask = async (action) => {
        const before = await panel.locator(".msg").count();
        const started = Date.now();
        await panel.click(`[data-action="${action}"]`);
        await panel.waitForFunction((n) => { const m = [...document.querySelectorAll(".msg")]; return m.length >= n + 2 && !m.at(-1).classList.contains("pending"); }, before, { timeout: 300000 });
        const answer = (await panel.locator(".msg").last().textContent()).replace(/\s+/g, " ");
        console.log(`    ${action} (${((Date.now() - started) / 1000).toFixed(1)} s): ${answer.slice(0, 260)}`);
        return answer;
      };
      console.log(`    ${await panel.textContent("#model-line")}`);
      assert(/lighthouse|ship|pharos|alexandria/i.test(await ask("summarize")), "the summary doesn't mention the page");
      assert((await ask("look")).length > 20, "no description of the screenshot");
      writeFileSync(join(shots, "assistant-real.png"), await composeWindow(app));
    });
  }

  await check("no script errors in Archium's pages", async () => {
    assert(!errors.length, errors.join("\n"));
  });
} finally {
  await app.close().catch(() => {});
  server.close();
  rmSync(userData, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed. Screenshots: test/screenshots/`);
process.exit(failed ? 1 : 0);
