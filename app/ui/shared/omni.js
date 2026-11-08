// What the command bar does with typed text: open it as an address or search for it.
// Shared by the window UI and main, so both read input the same way.

export const ENGINES = {
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  brave: { name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
  startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?query=%s" },
  kagi: { name: "Kagi", url: "https://kagi.com/search?q=%s" },
  mojeek: { name: "Mojeek", url: "https://www.mojeek.com/search?q=%s" },
  searxng: { name: "SearXNG (this computer)", url: "http://127.0.0.1:8888/search?q=%s" },
};

export const searchUrl = (query, engine = "duckduckgo") =>
  (ENGINES[engine] ?? ENGINES.duckduckgo).url.replace("%s", encodeURIComponent(query.trim()));

const SCHEME = /^(https?|archium|file|about|data|view-source):/i;
const LOCAL = /^(localhost|\[[0-9a-f:]+\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i;
// A dot, no spaces, and something that looks like a top-level domain.
const DOMAIN = /^[^\s/?#]+\.[a-z][a-z0-9-]{1,62}\.?(:\d+)?([/?#]\S*)?$/i;

// The address to load, or null for empty input.
export function toUrl(input, engine) {
  const text = String(input ?? "").trim();
  if (!text) return null;
  if (/\s/.test(text)) return searchUrl(text, engine);
  if (SCHEME.test(text)) return text;
  if (LOCAL.test(text)) return `http://${text}`;
  if (DOMAIN.test(text)) return `https://${text}`;
  return searchUrl(text, engine);
}

// Is this text an address (not a search)?
export const looksLikeUrl = (input) => {
  const text = String(input ?? "").trim();
  return Boolean(text) && !/\s/.test(text) && (SCHEME.test(text) || LOCAL.test(text) || DOMAIN.test(text));
};

// "https://www.example.com/a?b" → "example.com/a"
export function prettyUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "archium:") return `archium://${u.hostname}`;
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}
