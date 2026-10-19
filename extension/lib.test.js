import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  networkPrediction,
  fallbackUrl,
  isLocalSearchUrl,
  proxyConfig,
  searchRedirectRule,
  webrtcPolicy,
  withDefaults,
} from "./lib.js";

test("direct mode sets no proxy", () => {
  assert.equal(proxyConfig(DEFAULTS), null);
});

test("tor mode uses socks5 on loopback with the chosen port", () => {
  const cfg = proxyConfig(withDefaults({ mode: "tor", torPort: "9150" }));
  assert.deepEqual(cfg.rules.singleProxy, { scheme: "socks5", host: "127.0.0.1", port: 9150 });
  assert.equal(cfg.mode, "fixed_servers");
});

test("bad ports and missing hosts are rejected", () => {
  assert.throws(() => proxyConfig(withDefaults({ mode: "tor", torPort: 70000 })));
  assert.throws(() => proxyConfig(withDefaults({ mode: "proxy", proxyHost: " " })));
  assert.throws(() => proxyConfig(withDefaults({ mode: "proxy", proxyHost: "h", proxyScheme: "ftp" })));
});

test("custom proxy passes scheme, trimmed host and port", () => {
  const cfg = proxyConfig(withDefaults({ mode: "proxy", proxyScheme: "http", proxyHost: " p.example ", proxyPort: 3128 }));
  assert.deepEqual(cfg.rules.singleProxy, { scheme: "http", host: "p.example", port: 3128 });
});

test("webrtc is blocked when asked or when proxied", () => {
  assert.equal(webrtcPolicy(withDefaults({ blockWebRTC: false })), null);
  assert.equal(webrtcPolicy(withDefaults({ blockWebRTC: true })), "disable_non_proxied_udp");
  assert.equal(webrtcPolicy(withDefaults({ blockWebRTC: false, mode: "tor" })), "disable_non_proxied_udp");
});

test("dns prefetching is off only while proxied", () => {
  assert.equal(networkPrediction(DEFAULTS), null);
  assert.equal(networkPrediction(withDefaults({ mode: "tor" })), false);
  assert.equal(networkPrediction(withDefaults({ mode: "proxy" })), false);
});

test("only the local /search page counts as a local search", () => {
  assert.ok(isLocalSearchUrl("http://127.0.0.1:8888/search?q=a", DEFAULTS));
  assert.ok(!isLocalSearchUrl("http://127.0.0.1:8888/preferences", DEFAULTS));
  assert.ok(!isLocalSearchUrl("http://127.0.0.1:9999/search?q=a", DEFAULTS));
  assert.ok(!isLocalSearchUrl("not a url", DEFAULTS));
});

test("fallback keeps the full query string", () => {
  assert.equal(
    fallbackUrl("http://127.0.0.1:8888/search?q=caf%C3%A9+au+lait&categories=images", DEFAULTS),
    "https://searx.tiekoetter.com/search?q=caf%C3%A9+au+lait&categories=images",
  );
  assert.equal(fallbackUrl("https://example.com/search?q=a", DEFAULTS), null);
});

test("redirect rule exists only while proxied and matches the local origin", () => {
  assert.equal(searchRedirectRule(DEFAULTS), null);
  const rule = searchRedirectRule(withDefaults({ mode: "tor" }));
  const re = new RegExp(rule.condition.regexFilter);
  assert.ok(re.test("http://127.0.0.1:8888/search?q=a"));
  assert.ok(re.test("http://127.0.0.1:8888/search"));
  assert.ok(!re.test("http://127.0.0.1:8888/searchx"));
  assert.ok(!re.test("http://127.0.0.1:88889/search?q=a"));
  const out = "http://127.0.0.1:8888/search?q=a".replace(re, rule.action.redirect.regexSubstitution.replace("\\1", "$1"));
  assert.equal(out, "https://searx.tiekoetter.com/search?q=a");
});
