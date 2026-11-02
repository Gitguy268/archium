// Address bar suggestions: what was typed, open tabs, bookmarks and history, ranked the way
// people expect from Chrome or Firefox: a site whose address starts with the text first,
// then title matches, with frequent and recent visits ahead. Pure, so the tests drive it.

const bare = (url) => url.replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "");
const hostOf = (url) => {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return "";
  }
};
const DAY = 24 * 3600 * 1000;

function score(entry, q, now) {
  const b = bare(entry.url).toLowerCase();
  const host = hostOf(entry.url).toLowerCase();
  const title = (entry.title ?? "").toLowerCase();
  let s = 0;
  if (b.startsWith(q)) s = 1000 + (b.replace(/\/$/, "") === host ? 200 : 0);
  else if (host.includes(`.${q}`)) s = 600;
  else if (title.split(/[\s\-–—|:·,]+/).some((w) => w.startsWith(q))) s = 400;
  else if (title.includes(q) || b.includes(q)) s = 200;
  if (!s) return 0;
  s += Math.log2((entry.visits ?? 1) + 1) * 30;
  const age = now - (entry.visited ?? entry.added ?? 0);
  if (age < DAY) s += 40;
  else if (age < 7 * DAY) s += 20;
  if (entry.bookmark) s += 150;
  return s;
}

// text: what's in the address field. Returns { inline, items }:
//   inline: { completion, url } to finish the typed text in place, or null
//   items:  [{ kind: "go" | "search" | "tab" | "bookmark" | "history", title, url, id? }]
export function suggest(text, { tabs = [], bookmarks = [], history = [], looksLikeUrl = () => false, now = Date.now() } = {}) {
  const typed = text.trim();
  const q = typed.toLowerCase();
  if (!q) return { inline: null, items: [] };

  const merged = new Map();
  for (const h of history) merged.set(h.url, { ...h });
  for (const b of bookmarks) merged.set(b.url, { ...merged.get(b.url), ...b, bookmark: true, title: b.title });
  const ranked = [...merged.values()]
    .map((e) => ({ e, s: score(e, q, now) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.e);

  // Inline: only for text that could be the start of an address.
  let inline = null;
  if (!/\s/.test(q)) {
    const best = ranked.find((e) => bare(e.url).toLowerCase().startsWith(q));
    if (best) {
      const host = hostOf(best.url);
      if (host.toLowerCase().startsWith(q)) inline = { completion: host, url: `${new URL(best.url).protocol}//${new URL(best.url).host}/` };
      else inline = { completion: bare(best.url), url: best.url };
      // Keep the user's own letters; only the rest is filled in.
      inline.completion = typed + inline.completion.slice(typed.length);
    }
  }

  const items = [];
  const seen = new Set();
  const add = (item) => {
    if (item.url && seen.has(item.url)) return;
    if (item.url) seen.add(item.url);
    items.push(item);
  };
  if (inline) add({ kind: "go", title: inline.completion, url: inline.url });
  add({ kind: looksLikeUrl(typed) && !inline ? "go" : "search", title: typed });
  const tabMatches = tabs.filter((t) => t.title?.toLowerCase().includes(q) || bare(t.url).toLowerCase().includes(q));
  for (const t of tabMatches.slice(0, 3)) add({ kind: "tab", title: t.title || t.url, url: t.url, id: t.id, own: t.own });
  for (const e of ranked) {
    if (items.length >= 9) break;
    add({ kind: e.bookmark ? "bookmark" : "history", title: e.title || e.url, url: e.url });
  }
  return { inline, items };
}

// Most visited sites for the new tab page, one per host.
export function topSites(history, count = 8) {
  const byHost = new Map();
  for (const h of history) {
    const host = hostOf(h.url);
    if (!host) continue;
    const entry = byHost.get(host) ?? { host, url: `${new URL(h.url).protocol}//${new URL(h.url).host}/`, title: "", visits: 0 };
    entry.visits += h.visits ?? 1;
    // The home page's title names the site best; otherwise the most visited page's.
    if (!entry.title || bare(h.url).replace(/\/$/, "") === host) entry.title = h.title;
    byHost.set(host, entry);
  }
  return [...byHost.values()].sort((a, b) => b.visits - a.visits).slice(0, count);
}
