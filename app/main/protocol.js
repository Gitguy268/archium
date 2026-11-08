// archium:// pages. Each page is its own host (archium://settings, archium://library, …) and
// gets the files under ui/ at /_/, so everything it loads is same-origin: custom schemes get
// no CORS. Pages that open in tabs run in the web session without Node or a preload; they
// reach main through /api/<name>, which needs the per-launch token written into their HTML.
// Web pages can't read that token (cross-origin), and window.js stops them from opening,
// navigating to or framing archium:// at all.
import { protocol, net } from "electron";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, normalize, extname } from "node:path";

export const SCHEME = "archium";
const UI = fileURLToPath(new URL("../ui/", import.meta.url));
export const TOKEN = randomBytes(24).toString("hex");

// Pages that can open in a tab, and the chrome-only pages (window UI, Little Archium).
export const TAB_PAGES = { settings: "pages/settings.html", library: "pages/library.html", error: "pages/error.html" };
const CHROME_PAGES = { chrome: "chrome.html", mini: "mini.html" };

const CSP =
  "default-src 'self'; img-src 'self' data: https: http:; media-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  ]);
}

const apis = new Map();
// handler(body, { host, webContents? }) → JSON-able result.
export const registerApi = (name, handler) => apis.set(name, handler);

// Resolves a path under ui/, refusing anything that climbs out of it.
function uiFile(rel) {
  const path = normalize(join(UI, rel));
  return path.startsWith(UI) ? path : null;
}

async function respondFile(path, { token = false } = {}) {
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  const headers = { "content-type": type, "content-security-policy": CSP, "x-content-type-options": "nosniff" };
  if (type.startsWith("text/html")) {
    let html = await readFile(path, "utf8");
    html = html.replace("%%TOKEN%%", token ? TOKEN : "");
    return new Response(html, { headers });
  }
  const res = await net.fetch(pathToFileURL(path).href);
  return new Response(res.body, { headers });
}

// chrome: true for the session that holds the window UI (it gets chrome pages, not tab pages).
export function handleScheme(ses, { chrome = false } = {}) {
  ses.protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const host = url.hostname;
    const pages = chrome ? CHROME_PAGES : TAB_PAGES;
    if (!(host in pages)) return new Response("Not found", { status: 404 });
    try {
      if (url.pathname.startsWith("/api/")) {
        if (chrome || url.searchParams.get("t") !== TOKEN || request.method !== "POST") {
          return new Response("Forbidden", { status: 403 });
        }
        const handler = apis.get(url.pathname.slice(5));
        if (!handler) return new Response("Not found", { status: 404 });
        const body = request.headers.get("content-type")?.includes("json") ? await request.json() : {};
        const result = await handler(body ?? {}, { host });
        return Response.json(result ?? null);
      }
      if (url.pathname.startsWith("/_/")) {
        const path = uiFile(decodeURIComponent(url.pathname.slice(3)));
        return path ? await respondFile(path) : new Response("Not found", { status: 404 });
      }
      return await respondFile(uiFile(pages[host]), { token: !chrome });
    } catch (e) {
      return new Response(String(e?.message ?? e), { status: 500 });
    }
  });
}

export const isArchiumUrl = (url) => typeof url === "string" && url.startsWith(`${SCHEME}:`);
