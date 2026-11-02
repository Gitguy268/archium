// Spaces, favourites, pinned tabs, folders and Today tabs, as plain data.
// No Electron here: the windows render this model, and the tests drive it directly.
//
// A tab lives in exactly one place:
//   favourites            shared by every space (Arc's top grid)
//   space.items           pinned tabs and folders ({type:"tab",id} | {type:"folder",id,name,open,children})
//   space.today           unpinned tabs, newest first; they're archived after a while
import { randomUUID } from "node:crypto";

export const DEFAULT_COLORS = [[124, 108, 242], [236, 120, 178]];
const ARCHIVE_LIMIT = 500;

export function emptyState() {
  const id = randomUUID();
  return {
    version: 1,
    spaces: [{ id, name: "Personal", icon: "✦", colors: DEFAULT_COLORS, profile: false, items: [], today: [] }],
    favourites: [],
    tabs: {},
    archive: [],
    splits: [],
    routes: [],
    activeSpace: id,
  };
}

export class Model {
  constructor(data, { now = () => Date.now(), id = randomUUID } = {}) {
    this.data = data?.spaces?.length ? data : emptyState();
    this.now = now;
    this.makeId = id;
    for (const key of ["favourites", "archive", "splits", "routes"]) this.data[key] ??= [];
    this.data.tabs ??= {};
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed() {
    for (const fn of this.listeners) fn();
  }

  get spaces() {
    return this.data.spaces;
  }

  space(id) {
    return this.data.spaces.find((s) => s.id === id);
  }

  tab(id) {
    return this.data.tabs[id];
  }

  // ---- spaces ----

  addSpace({ name = "New Space", icon = "◆", colors = DEFAULT_COLORS, profile = false } = {}) {
    const space = { id: this.makeId(), name, icon, colors, profile, items: [], today: [] };
    this.data.spaces.push(space);
    this.changed();
    return space;
  }

  updateSpace(id, patch) {
    const space = this.space(id);
    if (!space) return;
    for (const key of ["name", "icon", "colors", "profile"]) if (key in patch) space[key] = patch[key];
    this.changed();
  }

  // The space's tabs go to the archive; the last space can't be removed.
  removeSpace(id) {
    if (this.data.spaces.length < 2) return false;
    const space = this.space(id);
    if (!space) return false;
    for (const tabId of this.tabsIn(space)) this.archiveTab(tabId, space.id);
    this.data.spaces = this.data.spaces.filter((s) => s !== space);
    this.data.routes = this.data.routes.filter((r) => r.spaceId !== id);
    if (this.data.activeSpace === id) this.data.activeSpace = this.data.spaces[0].id;
    this.changed();
    return true;
  }

  moveSpace(id, index) {
    const from = this.data.spaces.findIndex((s) => s.id === id);
    if (from < 0) return;
    const [space] = this.data.spaces.splice(from, 1);
    this.data.spaces.splice(Math.max(0, Math.min(index, this.data.spaces.length)), 0, space);
    this.changed();
  }

  // ---- tabs ----

  newTab(spaceId, url, { title = "", select = true } = {}) {
    const space = this.space(spaceId) ?? this.data.spaces[0];
    const id = this.makeId();
    this.data.tabs[id] = { id, url, title, favicon: "", lastActive: this.now(), created: this.now() };
    space.today.unshift(id);
    if (select) this.data.activeSpace = space.id;
    this.changed();
    return this.data.tabs[id];
  }

  update(id, patch) {
    const tab = this.tab(id);
    if (!tab) return;
    let dirty = false;
    for (const key of ["url", "title", "favicon"]) {
      if (key in patch && tab[key] !== patch[key]) {
        tab[key] = patch[key];
        dirty = true;
      }
    }
    if (dirty) this.changed();
  }

  touch(id) {
    const tab = this.tab(id);
    if (tab) tab.lastActive = this.now();
  }

  // Where a tab sits: { zone: "favourites" | "pinned" | "today", spaceId?, folderId?, index }.
  locate(id) {
    const fav = this.data.favourites.indexOf(id);
    if (fav >= 0) return { zone: "favourites", index: fav };
    for (const space of this.data.spaces) {
      const today = space.today.indexOf(id);
      if (today >= 0) return { zone: "today", spaceId: space.id, index: today };
      for (const [index, item] of space.items.entries()) {
        if (item.type === "tab" && item.id === id) return { zone: "pinned", spaceId: space.id, folderId: null, index };
        if (item.type === "folder") {
          const inner = item.children.findIndex((c) => c.id === id);
          if (inner >= 0) return { zone: "pinned", spaceId: space.id, folderId: item.id, index: inner };
        }
      }
    }
    return null;
  }

  // Takes the tab out of wherever it is, without deleting it.
  detach(id) {
    const where = this.locate(id);
    if (!where) return null;
    if (where.zone === "favourites") this.data.favourites.splice(where.index, 1);
    else {
      const space = this.space(where.spaceId);
      if (where.zone === "today") space.today.splice(where.index, 1);
      else if (where.folderId) this.folder(space, where.folderId).children.splice(where.index, 1);
      else space.items.splice(where.index, 1);
    }
    return where;
  }

  // One move for every drag in the sidebar.
  // target: { zone, spaceId?, folderId?, index? }. Index defaults to the end (or the top of Today).
  place(id, target) {
    const tab = this.tab(id);
    if (!tab) return;
    const from = this.detach(id);
    const spaceId = target.spaceId ?? from?.spaceId ?? this.data.activeSpace;
    const space = this.space(spaceId) ?? this.data.spaces[0];
    const clamp = (list, i) => Math.max(0, Math.min(i ?? list.length, list.length));
    if (target.zone === "favourites") {
      this.data.favourites.splice(clamp(this.data.favourites, target.index), 0, id);
    } else if (target.zone === "pinned") {
      const list = target.folderId ? this.folder(space, target.folderId)?.children ?? space.items : space.items;
      list.splice(clamp(list, target.index), 0, { type: "tab", id });
    } else {
      space.today.splice(clamp(space.today, target.index ?? 0), 0, id);
    }
    // A pinned tab or favourite remembers the address it was pinned with, for "Back to pinned page".
    if (target.zone === "today") delete tab.pinnedUrl;
    else tab.pinnedUrl ??= tab.url;
    this.changed();
  }

  pin(id, spaceId) {
    this.place(id, { zone: "pinned", spaceId });
  }

  unpin(id) {
    const where = this.locate(id);
    this.place(id, { zone: "today", spaceId: where?.spaceId ?? this.data.activeSpace, index: 0 });
  }

  favourite(id) {
    this.place(id, { zone: "favourites" });
  }

  resetPinned(id) {
    const tab = this.tab(id);
    if (!tab?.pinnedUrl) return null;
    tab.url = tab.pinnedUrl;
    this.changed();
    return tab.url;
  }

  // Closing a Today tab archives it (so ⇧⌘T and the Library can bring it back).
  // Pinned tabs and favourites stay in the sidebar: closing only unloads them (the window does that).
  closeTab(id) {
    const where = this.locate(id);
    if (!where) return false;
    if (where.zone !== "today") return false;
    this.archiveTab(id, where.spaceId);
    this.changed();
    return true;
  }

  archiveTab(id, spaceId) {
    const tab = this.tab(id);
    if (!tab) return;
    this.detach(id);
    this.unsplit(id);
    if (tab.url && !tab.url.startsWith("hillium://")) {
      this.data.archive.unshift({ url: tab.url, title: tab.title, favicon: tab.favicon, spaceId, archivedAt: this.now() });
      this.data.archive.length = Math.min(this.data.archive.length, ARCHIVE_LIMIT);
    }
    delete this.data.tabs[id];
  }

  // Today tabs not used for `hours` go to the archive. Tabs in `keep` (the ones on screen) never do.
  archiveStale(hours, keep = new Set()) {
    if (!hours) return [];
    const cutoff = this.now() - hours * 3600_000;
    const archived = [];
    for (const space of this.data.spaces) {
      for (const id of [...space.today]) {
        if (keep.has(id)) continue;
        if ((this.tab(id)?.lastActive ?? 0) < cutoff) {
          this.archiveTab(id, space.id);
          archived.push(id);
        }
      }
    }
    if (archived.length) this.changed();
    return archived;
  }

  restoreArchived(index, spaceId) {
    const entry = this.data.archive[index];
    if (!entry) return null;
    this.data.archive.splice(index, 1);
    const target = this.space(spaceId) ? spaceId : this.space(entry.spaceId) ? entry.spaceId : this.data.activeSpace;
    const tab = this.newTab(target, entry.url, { title: entry.title });
    tab.favicon = entry.favicon;
    return tab;
  }

  // ---- folders ----

  folder(space, folderId) {
    return space.items.find((i) => i.type === "folder" && i.id === folderId);
  }

  addFolder(spaceId, name = "New Folder", tabIds = []) {
    const space = this.space(spaceId);
    if (!space) return null;
    const folder = { type: "folder", id: this.makeId(), name, open: true, children: [] };
    space.items.push(folder);
    for (const id of tabIds) this.place(id, { zone: "pinned", spaceId, folderId: folder.id });
    this.changed();
    return folder;
  }

  updateFolder(spaceId, folderId, patch) {
    const folder = this.folder(this.space(spaceId) ?? { items: [] }, folderId);
    if (!folder) return;
    if ("name" in patch) folder.name = patch.name;
    if ("open" in patch) folder.open = Boolean(patch.open);
    this.changed();
  }

  // Its tabs stay pinned, where the folder was.
  removeFolder(spaceId, folderId) {
    const space = this.space(spaceId);
    const index = space?.items.findIndex((i) => i.type === "folder" && i.id === folderId) ?? -1;
    if (index < 0) return;
    const [folder] = space.items.splice(index, 1);
    space.items.splice(index, 0, ...folder.children);
    this.changed();
  }

  // ---- lists ----

  // Every tab id in a space, in sidebar order: pinned (folders flattened), then Today.
  tabsIn(space) {
    const pinned = space.items.flatMap((i) => (i.type === "folder" ? i.children.map((c) => c.id) : [i.id]));
    return [...pinned, ...space.today];
  }

  allTabIds() {
    return [...this.data.favourites, ...this.data.spaces.flatMap((s) => this.tabsIn(s))];
  }

  // ---- split view ----

  splitOf(id) {
    return this.data.splits.find((group) => group.includes(id)) ?? null;
  }

  // Up to four tabs side by side. A tab is in at most one split.
  split(ids) {
    const unique = [...new Set(ids)].filter((id) => this.tab(id)).slice(0, 4);
    if (unique.length < 2) return null;
    for (const id of unique) this.unsplit(id, { quiet: true });
    this.data.splits.push(unique);
    this.changed();
    return unique;
  }

  unsplit(id, { quiet = false } = {}) {
    const group = this.splitOf(id);
    if (!group) return;
    group.splice(group.indexOf(id), 1);
    if (group.length < 2) this.data.splits = this.data.splits.filter((g) => g !== group);
    if (!quiet) this.changed();
  }

  // ---- routing (Arc's Air Traffic Control) ----

  addRoute(pattern, spaceId) {
    this.data.routes.push({ pattern, spaceId });
    this.changed();
  }

  removeRoute(index) {
    this.data.routes.splice(index, 1);
    this.changed();
  }

  // The space a link from another app should open in, or null.
  route(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    for (const { pattern, spaceId } of this.data.routes) {
      if (this.space(spaceId) && matchesRoute(pattern, u)) return spaceId;
    }
    return null;
  }
}

// "github.com" matches the host and its subdomains; "github.com/org" also needs the path prefix;
// "*" works as a wildcard anywhere.
export function matchesRoute(pattern, u) {
  const p = pattern.trim().toLowerCase().replace(/^https?:\/\//, "");
  if (!p) return false;
  const target = (u.hostname + u.pathname).toLowerCase();
  if (p.includes("*")) {
    const re = new RegExp(`^${p.split("*").map(escapeRe).join(".*")}`);
    return re.test(target) || re.test(target.replace(/^www\./, ""));
  }
  const [host, ...rest] = p.split("/");
  const path = rest.length ? `/${rest.join("/")}` : "";
  const hostOk = u.hostname.toLowerCase() === host || u.hostname.toLowerCase().endsWith(`.${host}`);
  return hostOk && u.pathname.toLowerCase().startsWith(path);
}

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
