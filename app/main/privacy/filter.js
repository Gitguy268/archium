// The one place web requests are changed. Electron keeps a single listener per webRequest
// event and session, so a second registration silently replaces the first: Ghostery, the URL
// cleaner, HTTPS-first and the header rules all run from these three functions, in that order.
// Everything here is pure apart from the callbacks, so the tests drive it with plain objects.
import { readFileSync } from "node:fs";
import { getDomain, getHostname } from "tldts-experimental";

const LIST = JSON.parse(readFileSync(new URL("./url-cleaner.json", import.meta.url), "utf8")).params;
const EXACT = new Set(LIST.filter((p) => !p.endsWith("*")).map((p) => p.toLowerCase()));
const PREFIXES = LIST.filter((p) => p.endsWith("*")).map((p) => p.slice(0, -1).toLowerCase());

const INTERNAL = /^(hillium|devtools|chrome|chrome-extension|data|blob|file|about):/;
const DOCUMENTS = new Set(["mainFrame", "subFrame"]);
// High-entropy client hints: version, OS build, CPU and device details.
const HIGH_ENTROPY_HINTS = [
  "sec-ch-ua-full-version",
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-platform-version",
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
  "sec-ch-ua-model",
  "sec-ch-ua-wow64",
  "sec-ch-ua-form-factors",
];

export const isTrackingParam = (name) => {
  const n = name.toLowerCase();
  return EXACT.has(n) || PREFIXES.some((p) => n.startsWith(p));
};

// The URL without tracking parameters, or null when there's nothing to remove.
export function cleanUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!u.search) return null;
  // Works on the raw pairs: URLSearchParams would re-encode the ones it keeps (%20 → +).
  const pairs = u.search.slice(1).split("&");
  const kept = pairs.filter((pair) => {
    try {
      return !isTrackingParam(decodeURIComponent(pair.split("=")[0]));
    } catch {
      return true;
    }
  });
  if (kept.length === pairs.length) return null;
  u.search = kept.length ? `?${kept.join("&")}` : "";
  return u.href;
}

// The registrable domain ("news.bbc.co.uk" → "bbc.co.uk"), or the host for IPs and local names.
export function siteOf(url) {
  try {
    return getDomain(url) || getHostname(url) || new URL(url).hostname;
  } catch {
    return "";
  }
}

export const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

// Hosts that don't do HTTPS by nature: loopback, private ranges, IPs, single-label and local names.
export function isLocalHost(host) {
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]") return true;
  if (!host.includes(".")) return true;
  if (/\.(local|lan|home|internal|test|onion|i2p)$/.test(host)) return true;
  // Bare IPs (public ones too) stay on http: they rarely have a certificate.
  return /^\[/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

// The page the request belongs to: the tab's address, or the request itself for a navigation.
function topUrl(details) {
  if (details.resourceType === "mainFrame") return details.url;
  try {
    return details.webContents?.getURL?.() || details.referrer || "";
  } catch {
    return details.referrer || "";
  }
}

export function isThirdParty(details) {
  const top = topUrl(details);
  if (!top || details.resourceType === "mainFrame") return false;
  const a = siteOf(top);
  const b = siteOf(details.url);
  return Boolean(a && b && a !== b);
}

const exceptionFor = (settings, url, key) => settings.siteExceptions?.[hostOf(url)]?.[key] === false;

// HTTPS-first: http navigations go to https unless the host is local or the user kept it on http.
export function upgradeUrl(url, settings) {
  if (!settings.httpsFirst || !url.startsWith("http://")) return null;
  const host = hostOf(url);
  if (isLocalHost(host) || settings.httpAllowed?.includes(host)) return null;
  return `https://${url.slice("http://".length)}`;
}

// What to do with a request Ghostery let through.
export function decide(details, settings, upgraded = new Set()) {
  if (INTERNAL.test(details.url)) return {};
  if (details.resourceType === "ping" && settings.blockPings) return { cancel: true };
  if (!DOCUMENTS.has(details.resourceType)) return {};
  const clean = cleanUrl(details.url);
  const target = clean ?? details.url;
  const https = details.resourceType === "mainFrame" ? upgradeUrl(target, settings) : null;
  if (https) {
    upgraded.add(https);
    return { redirectURL: https };
  }
  return clean ? { redirectURL: clean } : {};
}

// Request headers: no cookies to third parties, referers trimmed across sites, GPC on,
// high-entropy client hints removed.
export function rewriteRequestHeaders(details, settings) {
  const headers = { ...details.requestHeaders };
  const names = Object.keys(headers);
  const drop = (lower) => {
    for (const n of names) if (n.toLowerCase() === lower) delete headers[n];
  };
  for (const hint of HIGH_ENTROPY_HINTS) drop(hint);
  if (INTERNAL.test(details.url)) return headers;
  const third = isThirdParty(details);
  const top = topUrl(details);
  if (third && settings.blockThirdPartyCookies && !exceptionFor(settings, top, "cookies")) drop("cookie");
  if (settings.trimReferrers) {
    const refName = names.find((n) => n.toLowerCase() === "referer");
    if (refName && headers[refName]) {
      const ref = headers[refName];
      if (siteOf(ref) !== siteOf(details.url)) {
        try {
          headers[refName] = `${new URL(ref).origin}/`;
        } catch {
          delete headers[refName];
        }
      }
    }
  }
  if (settings.gpc) headers["Sec-GPC"] = "1";
  return headers;
}

// Response headers: third parties can't set cookies.
export function rewriteResponseHeaders(details, settings, headers) {
  if (!settings.blockThirdPartyCookies || INTERNAL.test(details.url)) return null;
  if (!isThirdParty(details) || exceptionFor(settings, topUrl(details), "cookies")) return null;
  const names = Object.keys(headers ?? {}).filter((n) => n.toLowerCase() === "set-cookie");
  if (!names.length) return null;
  const out = { ...headers };
  for (const n of names) delete out[n];
  return out;
}

// getBlocker() → Ghostery's engine or null (lists still loading, or blocking off).
// onBlocked(details) hears about every request the blocker cancels or redirects.
export function createFilter({ getSettings, getBlocker, onBlocked = () => {} }) {
  const upgraded = new Set();
  const adblockOn = (details) => {
    const s = getSettings();
    return s.adblock && !exceptionFor(s, topUrl(details), "adblock") ? getBlocker() : null;
  };

  const onBeforeRequest = (details, callback) => {
    if (INTERNAL.test(details.url)) return callback({});
    const next = () => callback(decide(details, getSettings(), upgraded));
    const blocker = adblockOn(details);
    if (!blocker) return next();
    let answered = false;
    blocker.onBeforeRequest(details, (res) => {
      if (answered) return;
      answered = true;
      if (res?.cancel || res?.redirectURL) {
        onBlocked(details);
        return callback(res);
      }
      next();
    });
  };

  const onBeforeSendHeaders = (details, callback) => {
    callback({ requestHeaders: rewriteRequestHeaders(details, getSettings()) });
  };

  const onHeadersReceived = (details, callback) => {
    const finish = (res = {}) => {
      const base = res.responseHeaders ?? details.responseHeaders;
      const stripped = rewriteResponseHeaders(details, getSettings(), base);
      callback(stripped ? { responseHeaders: stripped } : res);
    };
    const blocker = adblockOn(details);
    if (!blocker) return finish();
    blocker.onHeadersReceived(details, finish);
  };

  // Whether a page was upgraded by HTTPS-first, so a failed load can offer http.
  const wasUpgraded = (url) => upgraded.has(url);
  return { onBeforeRequest, onBeforeSendHeaders, onHeadersReceived, wasUpgraded };
}
