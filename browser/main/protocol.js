// archium:// serves the browser's own pages. It is registered per session:
//   archium://app/…     the toolbar, Glance and assistant pages (UI and AI sessions only)
//   archium://app/models/…  the verified model files (AI session only; same origin as the
//                           assistant, because custom schemes get no CORS)
//   archium://newtab/…  the new tab page, in every session; it can read and edit its quick links
import { protocol, net } from "electron";
import { join, normalize, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { FILES, modelDir, isModelReady } from "./model.js";

export const UI_DIR = fileURLToPath(new URL("../ui/", import.meta.url));

protocol.registerSchemesAsPrivileged([
  {
    scheme: "archium",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "img-src 'self' data: blob: https: http:",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");
const NEWTAB_CSP = "default-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline'; object-src 'none'";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".md": "text/plain; charset=utf-8",
};

function inside(base, path) {
  const full = normalize(join(base, decodeURIComponent(path)));
  return full === base.replace(/[\\/]$/, "") || full.startsWith(base.endsWith(sep) ? base : base + sep) ? full : null;
}

async function serveFile(full, csp, extra = {}) {
  const res = await net.fetch(pathToFileURL(full).href);
  if (!res.ok) return new Response("Not found", { status: 404 });
  const ext = full.slice(full.lastIndexOf("."));
  const headers = { "content-type": TYPES[ext] ?? "application/octet-stream", ...extra };
  if (ext === ".html") headers["content-security-policy"] = csp;
  return new Response(res.body, { status: 200, headers });
}

// hosts: which of "app", "models" (app/models/), "newtab" this session may load. newtab gets the
// newtab/, themes/ and vendor glass files plus its small JSON API.
export function registerProtocol(ses, hosts, newtabApi) {
  ses.protocol.handle("archium", async (req) => {
    const url = new URL(req.url);
    const host = url.hostname;
    if (!hosts.includes(host) || host === "models") return new Response("Forbidden", { status: 403 });

    if (host === "app" && url.pathname.startsWith("/models/")) {
      const name = decodeURIComponent(url.pathname.slice("/models/".length));
      if (!hosts.includes("models") || !FILES.includes(name) || !isModelReady()) return new Response("Not found", { status: 404 });
      return serveFile(join(modelDir(), name), APP_CSP, { "cross-origin-resource-policy": "same-origin" });
    }

    if (host === "app") {
      const full = inside(UI_DIR, url.pathname === "/" ? "/chrome.html" : url.pathname);
      if (!full) return new Response("Forbidden", { status: 403 });
      // Isolated, so the assistant gets SharedArrayBuffer and wllama runs multithreaded.
      return serveFile(full, APP_CSP, {
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "credentialless",
        "cross-origin-resource-policy": "same-origin",
      });
    }

    // newtab
    if (url.pathname === "/state.json" || url.pathname === "/links") {
      // Only the page itself may call this; web pages get no CORS headers and fail the Origin check.
      const origin = req.headers.get("origin");
      if (req.method !== "GET" && origin !== "archium://newtab") return new Response("Forbidden", { status: 403 });
      if (req.method === "POST" && url.pathname === "/links") {
        if (req.headers.get("content-type") !== "application/json") return new Response("Bad request", { status: 400 });
        return Response.json(newtabApi.setLinks(await req.json()));
      }
      return Response.json(newtabApi.state());
    }
    const path = url.pathname === "/" ? "/newtab/newtab.html" : url.pathname;
    if (!/^\/(newtab|themes|vendor\/liquid-glass-web|shared)\//.test(path)) return new Response("Not found", { status: 404 });
    const full = inside(UI_DIR, path);
    return full ? serveFile(full, NEWTAB_CSP) : new Response("Forbidden", { status: 403 });
  });
}
