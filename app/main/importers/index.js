// Brings spaces, pinned tabs, folders and favourites in from Arc and Zen, and bookmarks from
// Chromium browsers. Each reader returns the same shape:
//   { spaces: [{ name, icon?, colors?, pinned: [Entry], today?: [Tab] }], favourites: [Tab] }
//   Entry = Tab | { folder: name, children: [Tab] };  Tab = { title, url }
// Arc's format follows the MIT arc-bookmarks-exporter: the file is Arc's own data, read-only.
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { decodeMozLz4 } from "./mozlz4.js";

const HOME = homedir();
const mac = process.platform === "darwin";
const appSupport = mac ? join(HOME, "Library/Application Support") : process.env.XDG_CONFIG_HOME || join(HOME, ".config");

export const SOURCES = {
  arc: { name: "Arc", paths: [join(HOME, "Library/Application Support/Arc/StorableSidebar.json")] },
  zen: { name: "Zen", paths: mac ? [join(appSupport, "zen")] : [join(HOME, ".zen"), join(HOME, ".var/app/app.zen_browser.zen/.zen")] },
  chrome: { name: "Chrome", paths: [join(appSupport, mac ? "Google/Chrome" : "google-chrome")] },
  brave: { name: "Brave", paths: [join(appSupport, mac ? "BraveSoftware/Brave-Browser" : "BraveSoftware/Brave-Browser")] },
  helium: { name: "Helium", paths: [join(appSupport, mac ? "net.imput.helium" : "net.imput.helium")] },
  vivaldi: { name: "Vivaldi", paths: [join(appSupport, mac ? "Vivaldi" : "vivaldi")] },
  chromium: { name: "Chromium", paths: [join(appSupport, mac ? "Chromium" : "chromium")] },
};

const exists = (p) => stat(p).then(() => true, () => false);

export async function availableSources() {
  const found = [];
  for (const [id, s] of Object.entries(SOURCES)) {
    for (const p of s.paths) if (await exists(p)) {
      found.push({ id, name: s.name });
      break;
    }
  }
  return found;
}

export async function readSource(id, path) {
  const source = SOURCES[id];
  if (!source) throw new Error(`unknown source ${id}`);
  let base = path;
  if (!base) for (const p of source.paths) if (await exists(p)) base = p;
  if (!base) throw new Error(`${source.name} isn't installed here`);
  if (id === "arc") return parseArc(JSON.parse(await readFile(base, "utf8")));
  if (id === "zen") return parseZen(JSON.parse(decodeMozLz4(await readFile(await zenSessions(base)))));
  return parseChromiumBookmarks(JSON.parse(await readFile(await chromiumBookmarks(base), "utf8")), source.name);
}

// ---- Arc ----

// Arc keeps lists as [key, value, key, value, …]; this turns them into the values.
const values = (list = []) => list.filter((x) => x && typeof x === "object" && !Array.isArray(x));

function arcIcon(info) {
  const t = info?.iconType ?? {};
  if (typeof t.emoji_v2 === "string") return t.emoji_v2;
  if (typeof t.emoji === "number") return String.fromCodePoint(t.emoji);
  if (typeof t.emoji === "string") return t.emoji;
  return null;
}

// Arc stores theme colours as { red, green, blue } in 0–1. The first two found make the gradient.
function arcColors(info) {
  const found = [];
  const walk = (o) => {
    if (!o || typeof o !== "object" || found.length >= 2) return;
    if (typeof o.red === "number" && typeof o.green === "number" && typeof o.blue === "number") {
      found.push([o.red, o.green, o.blue].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)));
      return;
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(info?.windowTheme);
  return found.length ? found : null;
}

export function parseArc(data) {
  const container = values(data?.sidebar?.containers).find((c) => c.spaces && c.items);
  if (!container) throw new Error("no sidebar in this Arc file");
  const items = new Map(values(container.items).map((i) => [i.id, i]));

  const tab = (item) => {
    const t = item?.data?.tab;
    const url = t?.savedURL;
    return url && /^https?:/.test(url) ? { title: item.title || t.savedTitle || url, url } : null;
  };
  // Folders can nest in Arc; Hillium has one level, so inner folders become siblings ("Outer › Inner").
  const entries = (ids, prefix = "") => {
    const out = [];
    for (const id of ids ?? []) {
      const item = items.get(id);
      if (!item) continue;
      if (item.data?.tab) {
        const t = tab(item);
        if (t) out.push(t);
      } else if (item.data?.splitView) {
        out.push(...entries(item.childrenIds, prefix));
      } else if (item.data?.list) {
        const name = prefix ? `${prefix} › ${item.title || "Folder"}` : item.title || "Folder";
        const inner = entries(item.childrenIds, name);
        const tabs = inner.filter((e) => !e.folder);
        out.push({ folder: name, children: tabs }, ...inner.filter((e) => e.folder));
      }
    }
    return out.filter((e) => !e.folder || e.children.length);
  };

  const spaces = values(container.spaces).map((s) => {
    const ids = s.containerIDs ?? [];
    const pinnedId = ids[ids.indexOf("pinned") + 1];
    const todayId = ids[ids.indexOf("unpinned") + 1];
    return {
      name: s.title || "Arc",
      icon: arcIcon(s.customInfo),
      colors: arcColors(s.customInfo),
      pinned: entries(items.get(pinnedId)?.childrenIds),
      today: entries(items.get(todayId)?.childrenIds).filter((e) => !e.folder),
    };
  });

  const topIds = (container.topAppsContainerIDs ?? []).filter((x) => typeof x === "string");
  const favourites = topIds.flatMap((id) => (items.get(id)?.childrenIds ?? []).map((c) => tab(items.get(c))).filter(Boolean));
  return { spaces, favourites };
}

// ---- Zen ----

async function zenSessions(base) {
  if (base.endsWith(".jsonlz4")) return base;
  const ini = await readFile(join(base, "profiles.ini"), "utf8").catch(() => "");
  const sections = ini.split(/^\[/m).map((s) => Object.fromEntries(s.split("\n").map((l) => l.split("=")).filter((kv) => kv.length === 2)));
  const preferred = sections.filter((s) => s.Path).sort((a, b) => Number(b.Default === "1") - Number(a.Default === "1"));
  const candidates = [...preferred.map((s) => join(base, s.Path)), ...(await readdir(join(base, "Profiles")).catch(() => [])).map((p) => join(base, "Profiles", p))];
  for (const dir of candidates) {
    for (const name of ["zen-sessions.jsonlz4", "sessionstore.jsonlz4"]) {
      if (await exists(join(dir, name))) return join(dir, name);
    }
  }
  throw new Error("no Zen session file found");
}

export function parseZen(data) {
  const lastEntry = (t) => t.entries?.[(t.index ?? t.entries.length) - 1] ?? t.entries?.at(-1);
  const toTab = (t) => {
    const e = lastEntry(t);
    const url = t._zenPinnedInitialState?.entry?.url ?? e?.url;
    return url && /^https?:/.test(url) ? { title: e?.title || url, url } : null;
  };
  const tabs = data.tabs ?? data.windows?.flatMap((w) => w.tabs ?? []) ?? [];
  const spacesData = data.spaces ?? data.windows?.[0]?.spaces ?? [];
  const folders = new Map((data.folders ?? []).map((f) => [f.id, f]));
  const spaces = spacesData.map((s) => {
    const mine = tabs.filter((t) => t.zenWorkspace === s.uuid && !t.zenEssential);
    const pinned = [];
    const byFolder = new Map();
    for (const t of mine.filter((t) => t.pinned)) {
      const tab = toTab(t);
      if (!tab) continue;
      const folder = t.groupId && folders.get(t.groupId);
      if (folder && !folder.splitViewGroup) {
        if (!byFolder.has(folder.id)) {
          const entry = { folder: folder.name || "Folder", children: [] };
          byFolder.set(folder.id, entry);
          pinned.push(entry);
        }
        byFolder.get(folder.id).children.push(tab);
      } else pinned.push(tab);
    }
    return {
      name: s.name || "Zen",
      icon: s.icon && [...s.icon].length <= 2 ? s.icon : null,
      colors: (s.theme?.gradientColors ?? []).map((c) => c.c).filter((c) => Array.isArray(c) && c.length === 3).slice(0, 3),
      pinned: pinned.filter((e) => !e.folder || e.children.length),
      today: mine.filter((t) => !t.pinned).map(toTab).filter(Boolean),
    };
  });
  const favourites = tabs.filter((t) => t.zenEssential).map(toTab).filter(Boolean);
  return { spaces, favourites };
}

// ---- Chromium bookmarks ----

async function chromiumBookmarks(base) {
  for (const profile of ["Default", "Profile 1"]) {
    const p = join(base, profile, "Bookmarks");
    if (await exists(p)) return p;
  }
  throw new Error("no bookmarks file found");
}

// The bookmarks bar and other bookmarks become folders in one space named after the browser.
export function parseChromiumBookmarks(data, browser = "Chrome") {
  const pinned = [];
  // A folder's own bookmarks come before its subfolders.
  const walk = (node, path) => {
    const tabs = [];
    const subfolders = [];
    for (const child of node.children ?? []) {
      if (child.type === "url" && /^https?:/.test(child.url)) tabs.push({ title: child.name || child.url, url: child.url });
      else if (child.type === "folder") subfolders.push(child);
    }
    if (tabs.length) pinned.push({ folder: path || browser, children: tabs });
    for (const sub of subfolders) walk(sub, path ? `${path} › ${sub.name}` : sub.name);
  };
  for (const root of ["bookmark_bar", "other", "synced"]) {
    const node = data?.roots?.[root];
    if (node) walk(node, node.name || root);
  }
  return { spaces: [{ name: browser, icon: null, colors: null, pinned }], favourites: [] };
}

// Adds an import to the model: spaces with the same name are merged, addresses already there are skipped.
export function applyImport(model, data, { includeToday = false } = {}) {
  const known = new Set(model.allTabIds().map((id) => model.tab(id)?.url));
  let added = 0;
  const addTab = (spaceId, t, target) => {
    if (known.has(t.url)) return;
    known.add(t.url);
    const tab = model.newTab(spaceId, t.url, { title: t.title, select: false });
    model.place(tab.id, target);
    added++;
  };
  for (const s of data.spaces ?? []) {
    const total = (s.pinned?.length ?? 0) + (includeToday ? s.today?.length ?? 0 : 0);
    if (!total) continue;
    let space = model.spaces.find((x) => x.name === s.name);
    if (!space) space = model.addSpace({ name: s.name, icon: s.icon || "◆", ...(s.colors?.length ? { colors: s.colors } : {}) });
    for (const entry of s.pinned ?? []) {
      if (entry.folder) {
        const folder = model.addFolder(space.id, entry.folder);
        for (const t of entry.children) addTab(space.id, t, { zone: "pinned", spaceId: space.id, folderId: folder.id });
        if (!folder.children.length) model.removeFolder(space.id, folder.id);
      } else addTab(space.id, entry, { zone: "pinned", spaceId: space.id });
    }
    if (includeToday) for (const t of s.today ?? []) addTab(space.id, t, { zone: "today", spaceId: space.id });
  }
  for (const t of data.favourites ?? []) addTab(model.data.activeSpace, t, { zone: "favourites" });
  return { added };
}
