// A subset of privacytests.org's tests (MIT, https://github.com/privacytests/privacytests),
// run against Hillium and against stock Electron. It opens privacytests' own test pages
// and collects their results through privacytests' results server, the way their runner
// does. Results go to test/privacy/results/ and docs/privacy-results.md.
//   PLAYWRIGHT=/path/to/node_modules/playwright node test/privacy/run.mjs
// Categories run: the main state/navigation/query/misc page, the top-level GPC check and
// the two HTTPS checks. Not run: cross-session state, HSTS, tracking cookies (needs
// privacytests' cookie proxy), fingerprinting supplementary and IP tests.
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "../..");
const { _electron } = require(process.env.PLAYWRIGHT ?? "playwright");

const SAME = "https://test-pages.privacytests2.org";
const LIVE = "https://test-pages.privacytests2.org/live";
const INSECURE = "http://insecure.privacytests3.org";
const UPGRADABLE = "http://upgradable.privacytests2.org";

function results() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://results.privacytests.org/ws");
    const queue = [];
    const waiting = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.sessionId && !ws.sessionId) {
        ws.sessionId = msg.sessionId;
        ws.keepAlive = setInterval(() => ws.send('{"message":"ping"}'), 30000);
        return resolve(ws);
      }
      if (msg.data === undefined) return;
      const w = waiting.shift();
      w ? w(msg.data) : queue.push(msg.data);
    };
    ws.onerror = () => reject(new Error("can't reach results.privacytests.org"));
    ws.drain = () => queue.splice(0);
    ws.next = (timeout = 90000) =>
      queue.length
        ? Promise.resolve(queue.shift())
        : new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error("timed out")), timeout);
            waiting.push((d) => {
              clearTimeout(t);
              res(d);
            });
          });
  });
}

async function launch(browser) {
  const userData = mkdtempSync(join(tmpdir(), `pt-${browser}-`));
  if (browser === "hillium") {
    const app = await _electron.launch({
      executablePath: require("electron"),
      args: [APP],
      env: { ...process.env, HILLIUM_TEST: "1", HILLIUM_USER_DATA: userData, HILLIUM_WAIT_ADBLOCK: "1" },
    });
    await app.firstWindow();
    const open = (url) =>
      app.evaluate((_, u) => {
        const hub = globalThis.__hillium;
        hub.newTab([...hub.windows][0], u);
      }, url);
    return { app, open };
  }
  const app = await _electron.launch({ executablePath: require("electron"), args: [join(HERE, "stock/main.cjs")], env: { ...process.env, STOCK_USER_DATA: userData } });
  const open = (url) => app.evaluate((_, u) => globalThis.openPage(u), url);
  return { app, open };
}

const withSession = (url, id) => `${url}${url.includes("?") ? "&" : "?"}sessionId=${id}`;

async function run(browser) {
  const ws = await results();
  const { app, open } = await launch(browser);
  const page = async (url, timeout) => {
    const next = ws.next(timeout);
    await open(withSession(url, ws.sessionId));
    return next;
  };
  const out = {};
  try {
    const signal = await page(`${SAME}/supercookies.html?mode=write&thirdparty=same`);
    if (!signal.supercookie_write_finished) throw new Error("supercookie write didn't finish");
    Object.assign(out, await page(`${SAME}/supercookies.html?mode=read&thirdparty=same`, 180000));
    const top = await page(`${LIVE}/toplevel.html`);
    out.misc = { ...out.misc, "GPC enabled first-party": top["GPC enabled first-party"] };
    out.https = { ...(await page(`${UPGRADABLE}/upgradable.html?source=address`)) };
    // Only the insecure page's own result counts: a late message from an earlier page must not.
    ws.drain();
    try {
      await open(withSession(`${INSECURE}/insecure.html`, ws.sessionId));
      const end = Date.now() + 8000;
      for (;;) {
        const data = await ws.next(Math.max(1, end - Date.now()));
        if (data && "Insecure website warning" in data) break;
      }
      out.https["Insecure website warning"] = { passed: false, result: "Insecure website loaded" };
    } catch {
      out.https["Insecure website warning"] = { passed: true, result: "Insecure website never loaded" };
    }
  } finally {
    clearInterval(ws.keepAlive);
    ws.close();
    await app.close();
  }
  return out;
}

// privacytests marks most results with `passed`; state tests compare what a second site read.
function verdict(r) {
  if (!r || typeof r !== "object") return null;
  if (typeof r.passed === "boolean") return r.passed;
  if ("readDifferentFirstParty" in r && "readSameFirstParty" in r) {
    if (r.unsupported || r.readSameFirstParty === null) return null;
    return r.readDifferentFirstParty !== r.readSameFirstParty;
  }
  return null;
}

const browsers = (process.env.BROWSERS ?? "hillium,electron").split(",");
const all = {};
for (const b of browsers) {
  console.log(`running ${b}…`);
  all[b] = await run(b);
}
mkdirSync(join(HERE, "results"), { recursive: true });
writeFileSync(join(HERE, "results", `results-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(all, null, 2));

const rows = [];
const categories = new Set(browsers.flatMap((b) => Object.keys(all[b])));
for (const cat of categories) {
  const names = new Set(browsers.flatMap((b) => Object.keys(all[b][cat] ?? {})));
  for (const name of names) rows.push([cat, name, ...browsers.map((b) => verdict(all[b][cat]?.[name]))]);
}
const mark = (v) => (v === true ? "✅" : v === false ? "❌" : "–");
const score = (i) => `${rows.filter((r) => r[i] === true).length}/${rows.filter((r) => r[i] !== null).length}`;
const md = [
  "# Privacy test results",
  "",
  `A subset of [privacytests.org](https://privacytests.org)'s tests, run on ${new Date().toISOString().slice(0, 10)} with \`app/test/privacy/run.mjs\` against Hillium and against Electron with its defaults (the same Chromium, without Hillium). ✅ passed, ❌ failed, – not applicable or not supported.`,
  "",
  `**Passed:** ${browsers.map((b, i) => `${b === "hillium" ? "Hillium" : "Stock Electron"} ${score(i + 2)}`).join(" · ")}`,
  "",
  "Run: the main state-partitioning, navigation, query-parameter and misc page; the top-level GPC check; HTTPS upgrade and the insecure-site check. Not run: cross-session state, HSTS cache, tracking cookies (it needs privacytests' cookie proxy), font fingerprinting and IP tests. Hillium adds no fingerprint noise, so no fingerprinting results are claimed here.",
  "",
  `| Category | Test | ${browsers.map((b) => (b === "hillium" ? "Hillium" : "Stock Electron")).join(" | ")} |`,
  `|---|---|${browsers.map(() => ":-:").join("|")}|`,
  ...rows.map(([c, n, ...v]) => `| ${c} | ${n} | ${v.map(mark).join(" | ")} |`),
  "",
];
writeFileSync(join(APP, "../docs/privacy-results.md"), md.join("\n"));
console.log(`Hillium ${score(2)}${browsers.length > 1 ? `, stock Electron ${score(3)}` : ""}`);
process.exit(0);
