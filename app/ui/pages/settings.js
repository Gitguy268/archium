// hillium://settings
import { api, h, $ } from "./api.js";

let data = null;

function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

async function set(key, value) {
  try {
    await api("settings.set", { key, value });
    data.settings[key] = value;
  } catch (e) {
    toast(e.message);
  }
}

const row = (label, help, control) => h("div", { class: "row" }, h("div", { class: "label" }, label, help && h("small", {}, help)), control);

const toggle = (key, label, help) =>
  row(
    label,
    help,
    h("input", { type: "checkbox", class: "switch", checked: Boolean(data.settings[key]), onchange: (e) => set(key, e.target.checked) }),
  );

const select = (key, label, help, options) =>
  row(
    label,
    help,
    h(
      "select",
      { onchange: (e) => set(key, isNaN(Number(e.target.value)) || e.target.value === "" ? e.target.value : Number(e.target.value)) },
      options.map(([value, text]) => h("option", { value, selected: String(data.settings[key]) === String(value) }, text)),
    ),
  );

function looks() {
  const items = [
    ["arc", "Arc"],
    ["zen", "Zen"],
    ["glass", "Liquid Glass"],
    ["retro", "Retro 98"],
  ];
  const wrap = h("div", { class: "looks" });
  const draw = () =>
    wrap.replaceChildren(
      ...items.map(([id, name]) =>
        h(
          "button",
          {
            class: `look${data.settings.look === id ? " on" : ""}`,
            onclick: async () => {
              await set("look", id);
              draw();
            },
          },
          h("div", { class: `thumb ${id}` }),
          name,
        ),
      ),
    );
  draw();
  return wrap;
}

function routes() {
  const list = h("div", { class: "card" });
  const draw = () => {
    const spaceName = (id) => data.spaces.find((s) => s.id === id);
    list.replaceChildren(
      ...data.routes.map((r, index) =>
        h(
          "div",
          { class: "row" },
          h("div", { class: "label" }, h("code", {}, r.pattern), "  →  ", spaceName(r.spaceId) ? `${spaceName(r.spaceId).icon} ${spaceName(r.spaceId).name}` : "(removed space)"),
          h("button", { class: "small danger", onclick: async () => ((data.routes = await api("routes.remove", { index })), draw()) }, "Remove"),
        ),
      ),
    );
    const pattern = h("input", { type: "text", placeholder: "github.com or notion.so/team", class: "grow" });
    const space = h("select", {}, data.spaces.map((s) => h("option", { value: s.id }, `${s.icon} ${s.name}`)));
    list.append(
      h(
        "div",
        { class: "row" },
        pattern,
        space,
        h(
          "button",
          {
            class: "primary small",
            onclick: async () => {
              try {
                data.routes = await api("routes.add", { pattern: pattern.value, spaceId: space.value });
                draw();
              } catch (e) {
                toast(e.message);
              }
            },
          },
          "Add",
        ),
      ),
    );
  };
  draw();
  return list;
}

function importer() {
  const today = h("input", { type: "checkbox", class: "switch" });
  const card = h("div", { class: "card", id: "import" });
  card.append(
    row("Also bring open tabs", "Unpinned tabs come in as Today tabs.", today),
    ...data.sources.map((s) =>
      row(
        s.name,
        s.id === "arc" ? "Spaces, pinned tabs, folders and favourites, read from Arc's own sidebar file." : s.id === "zen" ? "Spaces, pinned tabs, folders and essentials." : "Bookmarks, as folders in a space.",
        h(
          "button",
          {
            class: "small",
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                const r = await api("import.run", { source: s.id, includeToday: today.checked });
                toast(r.added ? `${r.added} tabs imported from ${s.name}` : `Nothing new in ${s.name}`);
              } catch (err) {
                toast(err.message);
              }
              e.target.disabled = false;
            },
          },
          "Import",
        ),
      ),
    ),
  );
  if (!data.sources.length) card.append(h("div", { class: "empty" }, "No Arc, Zen or Chromium browser found on this computer."));
  return card;
}

function archivebox() {
  const url = h("input", { type: "url", placeholder: "http://localhost:8000", value: data.settings.archivebox.url, class: "grow" });
  const token = h("input", { type: "password", placeholder: "API key", value: data.settings.archivebox.token, class: "grow" });
  return h(
    "div",
    { class: "card" },
    h("div", { class: "row" }, h("div", { class: "label" }, "Address", h("small", {}, "Your ArchiveBox (0.8 or later). ⇧⌘S archives the page you're on.")), url),
    h("div", { class: "row" }, h("div", { class: "label" }, "API key", h("small", {}, "From ArchiveBox's admin › API Tokens.")), token),
    h(
      "div",
      { class: "row" },
      h("div", { class: "label" }),
      h("button", { class: "primary small", onclick: () => set("archivebox", { url: url.value.trim(), token: token.value }).then(() => toast("Saved")) }, "Save"),
    ),
  );
}

function agents() {
  const cli = data.platform === "linux" ? "hillium-cli" : "node cli/hillium.mjs";
  return h(
    "div",
    { class: "card" },
    toggle("agentAccess", "Allow the CLI and AI agents", "Opens a socket only you can use. Agents can list, open and read tabs. Private windows are never visible."),
    h(
      "div",
      { class: "row" },
      h(
        "div",
        { class: "label" },
        "Use it from a terminal or an MCP client",
        h("small", {}, "MCP clients (Claude, Cursor, …) run the stdio server:"),
        h("pre", {}, `${cli} tabs list\n${cli} open https://example.com --space Work\n${cli} mcp`),
      ),
    ),
  );
}

function exceptions() {
  const card = h("div", { class: "card" });
  const draw = () => {
    const sites = Object.entries(data.settings.siteExceptions);
    const http = data.settings.httpAllowed;
    card.replaceChildren(
      row(
        "Sites with protection off",
        "Turned off from the site panel (the lock left of the address).",
        sites.length
          ? h(
              "div",
              { class: "chips" },
              sites.map(([host, ex]) =>
                h(
                  "span",
                  { class: "chip" },
                  `${host}${ex.adblock === false ? " · ads" : ""}${ex.cookies === false ? " · cookies" : ""}`,
                  h(
                    "button",
                    {
                      onclick: async () => {
                        const next = { ...data.settings.siteExceptions };
                        delete next[host];
                        await set("siteExceptions", next);
                        draw();
                      },
                    },
                    "×",
                  ),
                ),
              ),
            )
          : h("span", { class: "muted" }, "None"),
      ),
      row(
        "Sites kept on http",
        "You chose to continue without HTTPS here.",
        http.length
          ? h(
              "div",
              { class: "chips" },
              http.map((host) =>
                h(
                  "span",
                  { class: "chip" },
                  host,
                  h("button", { onclick: async () => (await set("httpAllowed", http.filter((x) => x !== host)), draw()) }, "×"),
                ),
              ),
            )
          : h("span", { class: "muted" }, "None"),
      ),
    );
  };
  draw();
  return card;
}

function clearData() {
  const btn = (what, label) =>
    h(
      "button",
      {
        class: "small",
        onclick: async () => {
          await api("data.clear", { what });
          toast("Cleared");
        },
      },
      label,
    );
  return row("Clear browsing data", "Cookies and site data apply to every space's profile.", h("div", { class: "chips" }, btn("history", "History"), btn("cookies", "Cookies"), btn("cache", "Cache"), btn("all", "Everything")));
}

async function main() {
  data = await api("settings.get");
  const app = $("#app");
  app.append(
    h("h2", {}, "Look"),
    looks(),
    h("div", { class: "card", style: "margin-top:12px" }, select("appearance", "Appearance", null, [["system", "Match the system"], ["light", "Light"], ["dark", "Dark"]])),

    h("h2", {}, "Search"),
    h(
      "div",
      { class: "card" },
      select("searchEngine", "Search engine", data.engines.searxng ? "SearXNG needs to run on this computer at 127.0.0.1:8888." : null, Object.entries(data.engines)),
      toggle("searchSuggestions", "Search suggestions", "Sends what you type in the command bar to DuckDuckGo. Off by default."),
    ),

    h("h2", {}, "Tabs"),
    h(
      "div",
      { class: "card" },
      select("archiveAfterHours", "Archive Today tabs after", "Pinned tabs and favourites stay. Archived tabs are in the Library.", [[12, "12 hours"], [24, "24 hours"], [168, "7 days"], [0, "Never"]]),
      select("linkSpace", "Links from other apps open in", "Space rules below come first.", [["", "Little Hillium"], ...data.spaces.map((x) => [x.id, `${x.icon} ${x.name}`])]),
      toggle("downloadsAsk", "Ask where to save each download"),
    ),

    h("h2", {}, "Space rules"),
    h("p", { class: "lede" }, "Links that match open in their space, like Arc's Air Traffic Control."),
    routes(),

    h("h2", {}, "Privacy"),
    h(
      "div",
      { class: "card" },
      toggle("adblock", "Block ads and trackers", "Ghostery's engine with EasyList, EasyPrivacy, uBlock Origin's lists and cookie notices."),
      toggle("httpsFirst", "HTTPS first", "Plain http addresses are tried over HTTPS first."),
      toggle("blockThirdPartyCookies", "Block third-party cookies"),
      toggle("trimReferrers", "Trim referrers across sites", "Other sites only see which site you came from, not the page."),
      toggle("gpc", "Send Global Privacy Control", "Tells sites not to sell or share your data."),
      toggle("blockPings", "Block link-tracking pings and beacons"),
      select("doh", "Secure DNS", null, [["quad9", "Quad9"], ["mullvad", "Mullvad"], ["cloudflare", "Cloudflare"], ["off", "Off (your network's DNS)"]]),
      select("dohMode", "If secure DNS fails", null, [["automatic", "Fall back to your network's DNS"], ["secure", "Don't load the page"]]),
    ),
    h("div", { style: "margin-top:12px" }, exceptions()),

    h("h2", {}, "Import"),
    importer(),

    h("h2", {}, "ArchiveBox"),
    archivebox(),

    h("h2", {}, "Agents"),
    agents(),

    h("h2", {}, "System"),
    h(
      "div",
      { class: "card" },
      row(
        "Default browser",
        data.isDefault ? "Hillium opens your links." : "Links from other apps open in another browser.",
        data.isDefault ? h("span", { class: "muted" }, "✓") : h("button", { class: "small", onclick: async () => toast((await api("default.set")) ? "Done" : "Your system didn't accept it; set it in its settings.") }, "Make default"),
      ),
      clearData(),
      row("About", `Hillium ${data.version} · Electron ${data.electron} · Chromium ${data.chrome}. There's no fingerprint noise like Helium's or Brave's; use Tor Browser when you need to be anonymous.`, null),
    ),
  );
  if (location.hash === "#import") $("#import")?.scrollIntoView();
}

main().catch((e) => {
  document.body.append(h("pre", {}, e.message));
});
