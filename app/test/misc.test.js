import { test } from "node:test";
import assert from "node:assert/strict";
import { toUrl, looksLikeUrl, prettyUrl, searchUrl } from "../ui/shared/omni.js";
import { fuzzyScore, rank } from "../ui/shared/fuzzy.js";
import { getGradient, shouldBeDarkMode, rgbToHsl, hslToRgb, getColorFromPosition, calculateCompliments } from "../ui/vendor/zen/gradient.js";
import { archive, normalizeBase } from "../main/archivebox.js";
import { Boosts } from "../main/boosts.js";
import { chromeUserAgent } from "../main/privacy/ua.js";

test("the command bar tells addresses from searches", () => {
  assert.equal(toUrl("example.com"), "https://example.com");
  assert.equal(toUrl("localhost:3000/x"), "http://localhost:3000/x");
  assert.equal(toUrl("192.168.1.1"), "http://192.168.1.1");
  assert.equal(toUrl("hillium://settings"), "hillium://settings");
  assert.equal(toUrl("what is arc"), searchUrl("what is arc"));
  assert.equal(toUrl("arc", "brave"), "https://search.brave.com/search?q=arc");
  assert.equal(toUrl("  "), null);
  assert.equal(looksLikeUrl("file.txt"), true);
  assert.equal(looksLikeUrl("hello"), false);
  assert.equal(prettyUrl("https://www.example.com/a?b=1"), "example.com/a");
});

test("fuzzy search: word starts and runs win", () => {
  assert.ok(fuzzyScore("gh", "GitHub") > fuzzyScore("gh", "laughing"));
  assert.equal(fuzzyScore("xyz", "GitHub"), null);
  const items = [{ t: "Hacker News" }, { t: "Liquid - Wikipedia" }, { t: "GitHub" }];
  assert.deepEqual(rank("wiki", items, (i) => [[i.t, 1]]).map((i) => i.t), ["Liquid - Wikipedia"]);
});

test("Zen's colour maths", () => {
  const [h, s, l] = rgbToHsl(255, 0, 0);
  assert.deepEqual([Math.round(h), s, l], [0, 1, 0.5]);
  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0]);
  assert.match(getGradient([[255, 0, 0], [0, 0, 255]]), /linear-gradient/);
  assert.equal(shouldBeDarkMode([20, 20, 30], { opacity: 0.9 }), true);
  assert.equal(shouldBeDarkMode([250, 250, 240], { opacity: 0.9 }), false);
  const dots = calculateCompliments({ x: 150, y: 100 }, "triadic", 200);
  assert.equal(dots.length, 3);
  for (const d of dots) assert.ok(getColorFromPosition(d.x, d.y, 200).every((c) => c >= 0 && c <= 255));
});

test("ArchiveBox: the add call, its key, and refusals", async () => {
  const calls = [];
  const ok = async (url, init) => (calls.push({ url, init }), { ok: true, status: 200, json: async () => ({ success: true }) });
  const r = await archive({ url: "http://localhost:8000/", token: "k" }, "https://a.example/", { fetchImpl: ok });
  assert.equal(calls[0].url, "http://localhost:8000/api/v1/cli/add");
  assert.equal(calls[0].init.headers["X-ArchiveBox-API-Key"], "k");
  assert.deepEqual(JSON.parse(calls[0].init.body).urls, ["https://a.example/"]);
  assert.equal(r.url, "https://a.example/");
  const denied = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(archive({ url: "http://x", token: "" }, "https://a.example/", { fetchImpl: denied }), /refused/);
  await assert.rejects(archive({ url: "" }, "https://a.example/"), /Settings/);
  await assert.rejects(archive({ url: "http://x" }, "hillium://settings/"), /web pages/);
  assert.throws(() => normalizeBase("ftp://x"));
});

test("boosts: zapped elements, font and CSS become one stylesheet", () => {
  const store = { data: { sites: {} }, save() {} };
  const b = new Boosts(store);
  b.set("a.example", { css: "body{color:red}", font: "Georgia" });
  b.addZap("a.example", ".ad");
  b.addZap("a.example", ".ad");
  const css = Boosts.css(b.get("a.example"));
  assert.match(css, /\.ad \{ display: none !important; \}/);
  assert.match(css, /"Georgia"/);
  assert.match(css, /body\{color:red\}/);
  assert.equal(b.set("a.example", { font: "url(evil)" }).font, "");
});

test("the user agent is plain Chrome", () => {
  const ua = chromeUserAgent("linux", "142.0.7444.59");
  assert.equal(ua, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36");
  assert.doesNotMatch(chromeUserAgent("darwin", "142.1"), /Electron|Hillium/);
});
