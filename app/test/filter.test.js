import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanUrl, isLocalHost, upgradeUrl, decide, rewriteRequestHeaders, rewriteResponseHeaders, createFilter, siteOf } from "../main/privacy/filter.js";
import { DEFAULT_SETTINGS } from "../main/store.js";

const settings = (patch = {}) => ({ ...structuredClone(DEFAULT_SETTINGS), ...patch });
const page = (url) => ({ getURL: () => url });

test("tracking parameters are removed, others kept as written", () => {
  assert.equal(cleanUrl("https://a.example/?utm_source=x&q=a%20b&fbclid=1"), "https://a.example/?q=a%20b");
  assert.equal(cleanUrl("https://a.example/?UTM_Medium=x"), "https://a.example/");
  assert.equal(cleanUrl("https://a.example/?q=1"), null);
  assert.equal(cleanUrl("not a url"), null);
});

test("sites are compared by registrable domain", () => {
  assert.equal(siteOf("https://news.bbc.co.uk/x"), "bbc.co.uk");
  assert.equal(siteOf("http://127.0.0.1:8080/"), "127.0.0.1");
});

test("HTTPS first skips local hosts and allowed hosts", () => {
  for (const h of ["localhost", "router", "nas.local", "192.168.1.2", "10.0.0.1", "8.8.8.8", "printer.lan"]) assert.equal(isLocalHost(h), true, h);
  assert.equal(isLocalHost("example.com"), false);
  const s = settings({ httpAllowed: ["old.example"] });
  assert.equal(upgradeUrl("http://example.com/a?b", s), "https://example.com/a?b");
  assert.equal(upgradeUrl("http://old.example/", s), null);
  assert.equal(upgradeUrl("http://localhost:3000/", s), null);
  assert.equal(upgradeUrl("http://example.com/", settings({ httpsFirst: false })), null);
});

test("decide: pings cancelled, navigations cleaned and upgraded, subresources left", () => {
  const upgraded = new Set();
  assert.deepEqual(decide({ url: "https://t.example/p", resourceType: "ping" }, settings()), { cancel: true });
  assert.deepEqual(decide({ url: "http://example.com/?gclid=1", resourceType: "mainFrame" }, settings(), upgraded), { redirectURL: "https://example.com/" });
  assert.ok(upgraded.has("https://example.com/"));
  assert.deepEqual(decide({ url: "https://cdn.example/a.js?utm_x=1", resourceType: "script" }, settings()), {});
  assert.deepEqual(decide({ url: "archium://settings/", resourceType: "mainFrame" }, settings()), {});
});

test("third parties get no cookies, a trimmed referer, GPC and no high-entropy hints", () => {
  const details = {
    url: "https://tracker.example/pixel",
    resourceType: "image",
    webContents: page("https://news.site/article"),
    requestHeaders: { Cookie: "a=1", Referer: "https://news.site/article?id=4", "Sec-CH-UA-Full-Version-List": "x", "Sec-CH-UA": "y" },
  };
  const h = rewriteRequestHeaders(details, settings());
  assert.equal(h.Cookie, undefined);
  assert.equal(h.Referer, "https://news.site/");
  assert.equal(h["Sec-GPC"], "1");
  assert.equal(h["Sec-CH-UA-Full-Version-List"], undefined);
  assert.equal(h["Sec-CH-UA"], "y");
  const first = rewriteRequestHeaders({ ...details, url: "https://cdn.news.site/x" }, settings());
  assert.equal(first.Cookie, "a=1");
  assert.equal(first.Referer, "https://news.site/article?id=4");
  const excepted = rewriteRequestHeaders(details, settings({ siteExceptions: { "news.site": { cookies: false } } }));
  assert.equal(excepted.Cookie, "a=1");
});

test("third parties can't set cookies", () => {
  const details = { url: "https://tracker.example/p", resourceType: "script", webContents: page("https://news.site/") };
  assert.deepEqual(rewriteResponseHeaders(details, settings(), { "Set-Cookie": ["id=1"], "Content-Type": ["x"] }), { "Content-Type": ["x"] });
  assert.equal(rewriteResponseHeaders({ ...details, url: "https://news.site/api" }, settings(), { "Set-Cookie": ["a"] }), null);
});

test("the dispatcher runs Ghostery first, then the cleaner", () => {
  const blocked = [];
  const blocker = {
    onBeforeRequest: (d, cb) => cb(d.url.includes("ads") ? { cancel: true } : {}),
    onHeadersReceived: (d, cb) => cb({}),
  };
  const s = settings();
  const f = createFilter({ getSettings: () => s, getBlocker: () => blocker, onBlocked: (d) => blocked.push(d.url) });
  const run = (details) => new Promise((resolve) => f.onBeforeRequest(details, resolve));
  return (async () => {
    assert.deepEqual(await run({ url: "https://ads.example/x.js", resourceType: "script", webContents: page("https://a.site/") }), { cancel: true });
    assert.deepEqual(blocked, ["https://ads.example/x.js"]);
    assert.deepEqual(await run({ url: "https://a.site/?utm_source=1", resourceType: "mainFrame" }), { redirectURL: "https://a.site/" });
    s.siteExceptions = { "a.site": { adblock: false } };
    assert.deepEqual(await run({ url: "https://ads.example/x.js", resourceType: "script", webContents: page("https://a.site/") }), {});
  })();
});
