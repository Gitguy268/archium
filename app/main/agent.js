// What the CLI and AI agents can do, as plain methods over the hub. Only the normal model is
// reachable: private windows have their own model, so their tabs have no ids here.
// The page tools follow OpenDia's ideas (MIT): read, click, type, links, screenshot.
import { readSource, applyImport } from "./importers/index.js";
import { archive } from "./archivebox.js";

const WORLD = 1002;
const MAX_TEXT = 100_000;

export function agentMethods(hub) {
  const m = hub.model;

  const describe = (id) => {
    const t = m.tab(id);
    const where = m.locate(id);
    const space = where?.spaceId ? m.space(where.spaceId) : null;
    const win = [...hub.windows].find((w) => !w.isPrivate && w.activeTab === id);
    return { id, title: t.title, url: t.url, zone: where?.zone, space: space?.name ?? null, loaded: hub.views.has(id), active: Boolean(win) };
  };

  const win = () => {
    const w = hub.mainWindow() ?? hub.createWindow();
    if (w.isPrivate) throw new Error("no normal window");
    return w;
  };

  // The tab to act on: the given id, or the active tab of the main window.
  const target = (id) => {
    const w = win();
    const tabId = id ?? w.activeTab;
    if (!tabId || !m.tab(tabId)) throw new Error(id ? `no tab ${id}` : "no active tab");
    return { w, tabId };
  };

  // Loads the tab if it's asleep, and waits for the page.
  const contents = async (id) => {
    const { w, tabId } = target(id);
    const entry = hub.views.get(tabId) ?? hub.ensureView(w, tabId);
    const wc = entry.view.webContents;
    // A page that never stops loading (long polling, streaming) still answers after 10 s.
    if (wc.isLoading()) await Promise.race([new Promise((resolve) => wc.once("did-stop-loading", resolve)), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    return { w, tabId, wc };
  };

  const inPage = async (id, fn, ...args) => {
    const { wc } = await contents(id);
    const code = `(${fn})(...${JSON.stringify(args)})`;
    return wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }], true);
  };

  const spaceByName = (name) => {
    if (!name) return null;
    const s = m.spaces.find((x) => x.name.toLowerCase() === String(name).toLowerCase() || x.id === name);
    if (!s) throw new Error(`no space called ${name}`);
    return s;
  };

  return {
    "spaces.list": () => m.spaces.map((s) => ({ id: s.id, name: s.name, icon: s.icon, tabs: m.tabsIn(s).length })),
    "tabs.list": ({ space } = {}) => {
      const s = spaceByName(space);
      const ids = s ? m.tabsIn(s) : m.allTabIds();
      return ids.filter((id) => m.tab(id)).map(describe);
    },
    "tabs.open": ({ url, space, background = false }) => {
      if (!/^https?:/.test(url ?? "")) throw new Error("tabs.open needs an http(s) url");
      const w = win();
      const s = spaceByName(space);
      if (s && !background) hub.switchSpace(w, s.id);
      return describe(hub.newTab(w, url, { background, spaceId: s?.id }).id);
    },
    "tabs.focus": ({ id }) => {
      const { w, tabId } = target(id);
      hub.activate(w, tabId);
      w.base.focus();
      return describe(tabId);
    },
    "tabs.close": ({ id }) => {
      const { w, tabId } = target(id);
      hub.close(w, tabId);
      return { closed: tabId };
    },
    "page.navigate": async ({ id, url }) => {
      if (!/^https?:/.test(url ?? "")) throw new Error("page.navigate needs an http(s) url");
      const { tabId, wc } = await contents(id);
      await wc.loadURL(url).catch(() => {});
      return describe(tabId);
    },
    "page.text": async ({ id } = {}) =>
      inPage(
        id,
        (max) => ({ url: location.href, title: document.title, text: (document.body?.innerText ?? "").slice(0, max) }),
        MAX_TEXT,
      ),
    "page.links": async ({ id } = {}) =>
      inPage(id, () =>
        [...document.querySelectorAll("a[href]")]
          .filter((a) => /^https?:/.test(a.href))
          .slice(0, 300)
          .map((a) => ({ text: a.innerText.trim().slice(0, 120), href: a.href })),
      ),
    "page.click": async ({ id, selector }) =>
      inPage(
        id,
        (sel) => {
          const el = document.querySelector(sel);
          if (!el) return { clicked: false, reason: "no element matches" };
          el.scrollIntoView({ block: "center" });
          el.click();
          return { clicked: true };
        },
        String(selector ?? ""),
      ),
    "page.type": async ({ id, selector, text, submit = false }) =>
      inPage(
        id,
        (sel, value, enter) => {
          const el = document.querySelector(sel);
          if (!el) return { typed: false, reason: "no element matches" };
          el.focus();
          if ("value" in el) {
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
            setter ? setter.call(el, value) : (el.value = value);
          } else el.textContent = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          if (enter && el.form) el.form.requestSubmit();
          else if (enter) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          return { typed: true };
        },
        String(selector ?? ""),
        String(text ?? ""),
        Boolean(submit),
      ),
    "page.screenshot": async ({ id } = {}) => {
      const { w, tabId, wc } = await contents(id);
      if (!w.visibleTabs().includes(tabId)) hub.activate(w, tabId, { focus: false });
      await new Promise((r) => setTimeout(r, 150));
      const image = await wc.capturePage();
      return { mimeType: "image/png", data: image.toPNG().toString("base64") };
    },
    "history.search": ({ query = "", limit = 20 } = {}) => {
      const q = String(query).toLowerCase();
      return hub
        .historyIndex(5000)
        .filter((e) => !q || e.url.toLowerCase().includes(q) || (e.title ?? "").toLowerCase().includes(q))
        .slice(0, Math.min(200, limit))
        .map(({ url, title, at }) => ({ url, title, at }));
    },
    "archive.add": async ({ id, url } = {}) => {
      const page = url ?? m.tab(target(id).tabId).url;
      const result = await archive(hub.settings.archivebox, page, { fetchImpl: (u, init) => hub.session("persist:hillium").fetch(u, init) });
      hub.stores.library.data.snapshots.unshift(result);
      hub.stores.library.save();
      return result;
    },
    "boost.set": ({ host, css, js, font, enabled }) => hub.boosts.set(host, { css, js, font, enabled }),
    "import.run": async ({ source, includeToday = false }) => applyImport(m, await readSource(source), { includeToday }),
  };
}
