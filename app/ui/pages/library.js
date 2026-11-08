// archium://library: archived tabs, history, downloads, ArchiveBox snapshots and Boosts.
import { api, h, $, when, host } from "./api.js";

const SECTIONS = [
  ["archive", "Archived tabs"],
  ["history", "History"],
  ["downloads", "Downloads"],
  ["snapshots", "ArchiveBox"],
  ["boosts", "Boosts"],
];
const FONTS = [["", "Site's own"], ["system-ui", "System"], ["serif", "Serif"], ["monospace", "Monospace"], ["Georgia", "Georgia"], ["Helvetica Neue", "Helvetica Neue"], ["Inter", "Inter"], ["Iosevka", "Iosevka"], ["Comic Sans MS", "Comic Sans"]];

let data = null;
let section = "archive";
let boostHost = "";

function favicon(entry) {
  return entry.favicon ? h("img", { class: "favicon", src: entry.favicon, alt: "" }) : h("span", { class: "favicon" });
}

function list(items, render, emptyText) {
  return h("div", { class: "card" }, items.length ? items.map(render) : h("div", { class: "empty" }, emptyText));
}

function link(url, text) {
  return h("a", { href: url, class: "grow ellipsis", style: "color:inherit;text-decoration:none" }, text || url);
}

function archiveView() {
  return [
    data.archive.length ? h("div", { style: "text-align:right;margin-bottom:8px" }, h("button", { class: "small danger", onclick: () => api("archive.remove", { index: "all" }).then(load) }, "Clear all")) : null,
    list(
      data.archive,
      (a, index) =>
        h(
          "div",
          { class: "row" },
          favicon(a),
          h("div", { class: "label ellipsis" }, a.title || a.url, h("small", { class: "ellipsis" }, `${host(a.url)} · archived ${when(a.archivedAt)}`)),
          h("button", { class: "small", onclick: () => api("archive.restore", { index }).then(load) }, "Restore"),
          h("button", { class: "small danger", onclick: () => api("archive.remove", { index }).then(load) }, "Remove"),
        ),
      "Closed and archived tabs show up here.",
    ),
  ];
}

function historyView() {
  const search = h("input", { type: "search", placeholder: "Search history" });
  const holder = h("div");
  const draw = () => {
    const q = search.value.toLowerCase();
    const items = data.history.filter((v) => !q || v.url.toLowerCase().includes(q) || (v.title ?? "").toLowerCase().includes(q)).slice(0, 300);
    holder.replaceChildren(
      list(
        items,
        (v) =>
          h(
            "div",
            { class: "row" },
            h("span", { class: "muted", style: "width:64px" }, when(v.at)),
            h("div", { class: "label ellipsis" }, link(v.url, v.title || v.url), h("small", { class: "ellipsis" }, host(v.url))),
            h("button", { class: "small", onclick: () => api("history.remove", { url: v.url }).then(load) }, "Forget"),
          ),
        q ? "Nothing matches." : "Pages you visit show up here. Private windows keep no history.",
      ),
    );
  };
  search.addEventListener("input", draw);
  draw();
  return [
    h("div", { class: "row", style: "padding:0 0 10px;border:0" }, search, h("button", { class: "small danger", onclick: () => api("history.remove", { url: "all" }).then(load) }, "Clear history")),
    holder,
  ];
}

function downloadsView() {
  const size = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
  return [
    data.downloads.length ? h("div", { style: "text-align:right;margin-bottom:8px" }, h("button", { class: "small", onclick: () => api("downloads.clear").then(load) }, "Clear list")) : null,
    list(
      data.downloads,
      (d) =>
        h(
          "div",
          { class: "row" },
          h("div", { class: "label ellipsis" }, d.name, h("small", {}, `${d.state === "completed" ? size(d.received) : d.state === "progressing" ? `${size(d.received)} of ${size(d.total)}` : d.state} · ${when(d.at)}`)),
          d.state === "completed" ? h("button", { class: "small", onclick: () => api("download.show", { path: d.path }) }, "Show") : null,
        ),
      "Nothing downloaded yet.",
    ),
  ];
}

function snapshotsView() {
  if (!data.archivebox) {
    return [h("div", { class: "card" }, h("div", { class: "empty" }, "Set up ArchiveBox in Settings to keep copies of pages. ", h("a", { href: "archium://settings/" }, "Settings")))];
  }
  return [
    list(
      data.snapshots,
      (s) =>
        h(
          "div",
          { class: "row" },
          h("div", { class: "label ellipsis" }, link(s.url, s.title || s.url), h("small", {}, `sent ${when(s.at)}`)),
          h("a", { class: "button small", href: s.link }, "Open in ArchiveBox"),
        ),
      "Pages you archive (⇧⌘S) show up here.",
    ),
  ];
}

function boostsView() {
  const editor = h("div", { style: "margin-top:14px" });
  const hostInput = h("input", { type: "text", placeholder: "example.com", value: boostHost, class: "grow" });
  const open = (name) => {
    boostHost = name.trim().toLowerCase();
    if (!boostHost) return;
    const b = data.boosts.find((x) => x.host === boostHost) ?? { host: boostHost, enabled: true, css: "", js: "", font: "", zap: [] };
    const css = h("textarea", { placeholder: "/* CSS for this site */\nbody { background: #fdf6e3; }" }, b.css);
    const js = h("textarea", { placeholder: "// JavaScript that runs on every page of this site (it sees the page, not its scripts)" }, b.js);
    const font = h("select", {}, FONTS.map(([v, t]) => h("option", { value: v, selected: v === b.font }, t)));
    const enabled = h("input", { type: "checkbox", class: "switch", checked: b.enabled !== false });
    const zaps = h(
      "div",
      { class: "chips" },
      b.zap.length
        ? b.zap.map((sel) =>
            h(
              "span",
              { class: "chip" },
              h("code", {}, sel.length > 48 ? `${sel.slice(0, 48)}…` : sel),
              h("button", { onclick: () => api("boost.set", { host: boostHost, patch: { zap: b.zap.filter((x) => x !== sel) } }).then(load) }, "×"),
            ),
          )
        : h("span", { class: "muted" }, "Nothing zapped. Right-click a page › Zap an Element."),
    );
    const save = () => api("boost.set", { host: boostHost, patch: { css: css.value, js: js.value, font: font.value, enabled: enabled.checked } }).then(load);
    editor.replaceChildren(
      h(
        "div",
        { class: "card" },
        h("div", { class: "row" }, h("div", { class: "label" }, h("b", {}, boostHost), h("small", {}, "Changes apply the next time a page of this site loads.")), enabled),
        h("div", { class: "row" }, h("div", { class: "label" }, "Font"), font),
        h("div", { class: "row", style: "display:block" }, h("div", { class: "label", style: "margin-bottom:6px" }, "CSS"), css),
        h("div", { class: "row", style: "display:block" }, h("div", { class: "label", style: "margin-bottom:6px" }, "JavaScript"), js),
        h("div", { class: "row" }, h("div", { class: "label" }, "Zapped elements"), zaps),
        h(
          "div",
          { class: "row" },
          h("div", { class: "label" }),
          h("button", { class: "danger small", onclick: () => api("boost.remove", { host: boostHost }).then(() => ((boostHost = ""), load())) }, "Delete boost"),
          h("button", { class: "primary small", onclick: save }, "Save"),
        ),
      ),
    );
  };
  if (boostHost) open(boostHost);
  return [
    list(
      data.boosts,
      (b) =>
        h(
          "div",
          { class: "row" },
          h("div", { class: "label" }, b.host, h("small", {}, [b.css && "CSS", b.js && "JavaScript", b.font && `font: ${b.font}`, b.zap.length && `${b.zap.length} zapped`].filter(Boolean).join(" · ") || "empty")),
          b.enabled === false ? h("span", { class: "muted" }, "off") : null,
          h("button", { class: "small", onclick: () => open(b.host) }, "Edit"),
        ),
      "No boosts yet. A boost changes how one site looks: your CSS, a font, a script, hidden elements.",
    ),
    h("div", { class: "row", style: "border:0;padding:12px 0 0" }, hostInput, h("button", { class: "primary small", onclick: () => open(hostInput.value) }, "New boost")),
    editor,
  ];
}

const VIEWS = { archive: archiveView, history: historyView, downloads: downloadsView, snapshots: snapshotsView, boosts: boostsView };

function draw() {
  const app = $("#app");
  app.replaceChildren(
    h("h1", {}, "Library"),
    h(
      "nav",
      { class: "tabs-nav" },
      SECTIONS.map(([id, label]) =>
        h(
          "button",
          {
            class: id === section ? "on" : "",
            onclick: () => {
              section = id;
              history.replaceState(null, "", `#${id}`);
              draw();
            },
          },
          label,
        ),
      ),
    ),
    ...VIEWS[section]().filter(Boolean),
  );
}

async function load() {
  data = await api("library.get");
  draw();
}

function fromHash() {
  const [id, value] = location.hash.slice(1).split("=");
  if (VIEWS[id]) section = id;
  if (id === "boosts" && value) boostHost = decodeURIComponent(value);
}

addEventListener("hashchange", () => {
  fromHash();
  load();
});
fromHash();
load().catch((e) => document.body.append(h("pre", {}, e.message)));
