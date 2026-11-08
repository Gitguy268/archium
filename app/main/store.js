// JSON files in userData, written atomically (temp file + rename) and debounced, so a
// burst of tab changes is one write. Each file keeps its last good copy in memory.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export class JsonFile {
  constructor(path, defaults, { delay = 400 } = {}) {
    this.path = path;
    this.delay = delay;
    this.timer = null;
    let data = {};
    try {
      data = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // Missing or damaged: start from the defaults.
    }
    this.data = structuredClone(defaults);
    Object.assign(this.data, data);
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.path);
  }
}

export const DEFAULT_SETTINGS = {
  look: "arc", // arc | zen | glass | retro
  appearance: "system", // system | light | dark
  searchEngine: "duckduckgo",
  searchSuggestions: false,
  archiveAfterHours: 12, // 12, 24, 168 (a week) or 0 for never
  doh: "quad9", // quad9 | mullvad | cloudflare | off
  dohMode: "automatic", // automatic (falls back to plain DNS) | secure
  adblock: true,
  httpsFirst: true,
  blockThirdPartyCookies: true,
  trimReferrers: true,
  gpc: true,
  blockPings: true,
  siteExceptions: {}, // host → { adblock: false, cookies: false }
  httpAllowed: [], // hosts the user chose to keep on http
  permissions: {}, // "origin|permission" → true | false
  downloadsAsk: false,
  compact: false,
  sidebarWidth: 248,
  archivebox: { url: "", token: "" },
  agentAccess: false,
  linkSpace: "", // space id for links from other apps, or "" for Little Archium
};

export function openStores(userData) {
  return {
    settings: new JsonFile(join(userData, "settings.json"), DEFAULT_SETTINGS),
    state: new JsonFile(join(userData, "state.json"), {}),
    history: new JsonFile(join(userData, "history.json"), { visits: [] }, { delay: 2000 }),
    library: new JsonFile(join(userData, "library.json"), { downloads: [], snapshots: [] }),
    boosts: new JsonFile(join(userData, "boosts.json"), { sites: {} }),
  };
}
