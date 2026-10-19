// Pure helpers shared by the service worker, the popup and the tests.

export const DEFAULTS = Object.freeze({
  mode: "direct", // "direct" | "tor" | "proxy"
  torPort: 9050, // 9150 when Tor Browser provides the Tor connection
  proxyScheme: "socks5", // "socks5" | "socks4" | "http" | "https"
  proxyHost: "",
  proxyPort: 1080,
  blockWebRTC: true,
  localSearch: "http://127.0.0.1:8888",
  publicSearch: "https://searx.tiekoetter.com",
});

export const SEARCH_RULE_ID = 1;

export function withDefaults(stored) {
  return { ...DEFAULTS, ...stored };
}

function validPort(port) {
  const n = Number(port);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

// chrome.proxy value for the chosen mode, or null for a direct connection.
// fixed_servers never falls back to DIRECT, so a dead proxy blocks traffic: that is the kill switch.
export function proxyConfig(s) {
  if (s.mode === "tor") {
    const port = validPort(s.torPort);
    if (!port) throw new Error("Invalid Tor port");
    return {
      mode: "fixed_servers",
      rules: { singleProxy: { scheme: "socks5", host: "127.0.0.1", port } },
    };
  }
  if (s.mode === "proxy") {
    const port = validPort(s.proxyPort);
    const host = String(s.proxyHost || "").trim();
    if (!host || !port) throw new Error("Proxy host and port are required");
    if (!["socks5", "socks4", "http", "https"].includes(s.proxyScheme)) {
      throw new Error("Unknown proxy scheme");
    }
    return {
      mode: "fixed_servers",
      rules: { singleProxy: { scheme: s.proxyScheme, host, port } },
    };
  }
  return null;
}

// A proxy or Tor makes WebRTC leaks matter most, so the switch is forced on then.
// null means "clear": fall back to Helium's own default (public interface only), not Chromium's.
export function webrtcPolicy(s) {
  return s.blockWebRTC || s.mode !== "direct" ? "disable_non_proxied_udp" : null;
}

// DNS prefetching can resolve hostnames locally, outside a SOCKS proxy, so it is off while proxied.
// null means "clear" (the browser's own setting).
export function networkPrediction(s) {
  return s.mode === "direct" ? null : false;
}

function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isLocalSearchUrl(url, s) {
  const local = origin(s.localSearch);
  if (!local) return false;
  try {
    const u = new URL(url);
    return u.origin === local && u.pathname === "/search";
  } catch {
    return false;
  }
}

// Same query, sent to the public instance instead of the local one.
export function fallbackUrl(url, s) {
  const target = origin(s.publicSearch);
  if (!target || !isLocalSearchUrl(url, s)) return null;
  return `${target}/search${new URL(url).search}`;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Chromium never proxies loopback, so local SearXNG would query engines from the real IP.
// While Tor or a proxy is on, this rule sends local searches to the public instance instead.
export function searchRedirectRule(s) {
  const local = origin(s.localSearch);
  const target = origin(s.publicSearch);
  if (s.mode === "direct" || !local || !target) return null;
  return {
    id: SEARCH_RULE_ID,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { regexSubstitution: `${target}/search\\1` },
    },
    condition: {
      regexFilter: `^${escapeRegex(local)}/search(\\?.*)?$`,
      resourceTypes: ["main_frame"],
    },
  };
}
