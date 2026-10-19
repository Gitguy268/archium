import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionProxy, sessionWebRTC, KILL_SWITCH } from "../main/privacy.js";
import { toUrl } from "../main/url.js";
import { DEFAULTS } from "../../extension/lib.js";

test("direct, Tor and proxy map to Electron proxy configs", () => {
  assert.deepEqual(sessionProxy({ ...DEFAULTS }).config, { mode: "direct" });
  assert.deepEqual(sessionProxy({ ...DEFAULTS, mode: "tor" }).config, { proxyRules: "socks5://127.0.0.1:9050" });
  assert.deepEqual(sessionProxy({ ...DEFAULTS, mode: "proxy", proxyScheme: "http", proxyHost: "10.0.0.2", proxyPort: 3128 }).config, { proxyRules: "http://10.0.0.2:3128" });
});

test("a broken proxy setting fails closed", () => {
  const { config, error } = sessionProxy({ ...DEFAULTS, mode: "proxy", proxyHost: "" });
  assert.deepEqual(config, KILL_SWITCH);
  assert.match(error, /required/);
  assert.deepEqual(sessionProxy({ ...DEFAULTS, mode: "tor", torPort: 70000 }).config, KILL_SWITCH);
});

test("WebRTC is blocked when asked and always when proxied", () => {
  assert.equal(sessionWebRTC({ ...DEFAULTS, blockWebRTC: true }), "disable_non_proxied_udp");
  assert.equal(sessionWebRTC({ ...DEFAULTS, blockWebRTC: false }), "default_public_interface_only");
  assert.equal(sessionWebRTC({ ...DEFAULTS, blockWebRTC: false, mode: "tor" }), "disable_non_proxied_udp");
});

test("typed text becomes an address or a local search", () => {
  assert.equal(toUrl("example.com", DEFAULTS), "https://example.com");
  assert.equal(toUrl("example.com/a?b=1", DEFAULTS), "https://example.com/a?b=1");
  assert.equal(toUrl("http://x.test", DEFAULTS), "http://x.test");
  assert.equal(toUrl("localhost:8080", DEFAULTS), "http://localhost:8080");
  assert.equal(toUrl("what is tor", DEFAULTS), `${DEFAULTS.localSearch}/search?q=what%20is%20tor`);
  assert.equal(toUrl("node.js", DEFAULTS), "https://node.js");
  assert.equal(toUrl("   ", DEFAULTS), null);
});
