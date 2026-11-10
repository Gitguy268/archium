// The window UI: sidebar, favourites, spaces, the command bar, Glance, find, split view and
// compact mode. Main sends the whole state on every change; this draws it and sends back
// what the user does. The page itself is a separate view on top of #page.
import { getGradient, shouldBeDarkMode, getAccentColorForUI, getColorFromPosition, calculateInitialPosition, calculateCompliments } from "./vendor/zen/gradient.js";
import { glass } from "./vendor/glass/liquid-glass.js";
import { rank } from "./shared/fuzzy.js";
import { looksLikeUrl, prettyUrl, ENGINES } from "./shared/omni.js";

const api = window.archium;
const $ = (s) => document.querySelector(s);
const mac = api.platform === "darwin";
const isPrivate = new URLSearchParams(location.search).has("private");
const key = (s) => (mac ? s : s.replace(/⌘/g, "Ctrl+").replace(/⇧/g, "Shift+").replace(/⌥/g, "Alt+").replace(/⌃/g, "Ctrl+"));
const GAP = 8;

let state = null;
const ui = { command: null, popover: null, find: false, permissions: [], reveal: false, dragging: null, overlay: false, lastSpace: null, glassOff: [] };

document.body.dataset.platform = api.platform;
if (isPrivate) document.body.classList.add("private");

// ---- small helpers ----

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const icon = (name) => `<svg><use href="#i-${name}" /></svg>`;
const call = (channel, ...args) => api.invoke(`archium:${channel}`, ...args);

function letterFor(t) {
  const host = (() => {
    try {
      return new URL(t.url).hostname.replace(/^www\./, "");
    } catch {
      return t.title ?? "?";
    }
  })();
  return (host[0] ?? "?").toUpperCase();
}

// A tab that hasn't loaded yet has no favicon from the page; the site's /favicon.ico usually works.
// Never in private windows: the window UI's session is shared, so that request would link them.
function faviconFor(t) {
  if (t.favicon && /^(https?|data):/.test(t.favicon)) return t.favicon;
  if (isPrivate || t.loaded) return "";
  try {
    const u = new URL(t.url);
    return /^https?:$/.test(u.protocol) ? `${u.origin}/favicon.ico` : "";
  } catch {
    return "";
  }
}

function setFavicon(holder, t) {
  let img = holder.querySelector("img.favicon");
  let letter = holder.querySelector(".letter");
  const src = faviconFor(t);
  if (src && holder.dataset.badFavicon !== src) {
    letter?.remove();
    if (!img) {
      img = el("img", "favicon");
      img.alt = "";
      img.onerror = () => {
        holder.dataset.badFavicon = img.getAttribute("src");
        img.remove();
        holder.prepend(Object.assign(el("span", "letter"), { textContent: letterFor(t) }));
      };
      holder.prepend(img);
    }
    if (img.getAttribute("src") !== src) img.src = src;
  } else {
    img?.remove();
    if (!letter) holder.prepend((letter = el("span", "letter")));
    letter.textContent = t.url?.startsWith("archium:") ? "H" : letterFor(t);
  }
}

// Keeps a container's children in step with a list, reusing elements by key.
function syncList(container, items, keyOf, create, update) {
  const old = new Map([...container.children].map((c) => [c.dataset.key, c]));
  let prev = null;
  for (const item of items) {
    const k = keyOf(item);
    let node = old.get(k);
    if (node) old.delete(k);
    else {
      node = create(item);
      node.dataset.key = k;
    }
    update(node, item);
    const next = prev ? prev.nextSibling : container.firstChild;
    if (node !== next) container.insertBefore(node, next);
    prev = node;
  }
  for (const node of old.values()) node.remove();
}

// ---- overlay: the UI above the page while something covers it ----

function wantOverlay() {
  return Boolean(ui.command || ui.popover || ui.dragging || ui.reveal || state?.glance);
}

function updateOverlay() {
  const on = wantOverlay();
  document.body.classList.toggle("overlay", on);
  if (on === ui.overlay) return;
  ui.overlay = on;
  call("overlay", on);
  if (!on) call("focus-page");
}

// ---- layout: tell main where the page goes ----

let lastRect = "";
function reportLayout() {
  const page = $("#page");
  const r = page.getBoundingClientRect();
  const radius = parseFloat(getComputedStyle(page).borderTopLeftRadius) || 0;
  const rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  const k = JSON.stringify([rect, radius]);
  if (k !== lastRect) {
    lastRect = k;
    call("layout", { rect, radius });
  }
  drawHoles(rect, radius);
  placeGlance(rect);
  placeSplitters(rect);
  const dz = $("#dropzones");
  Object.assign(dz.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
}

// The page views' rectangles, the same way main lays them out.
function viewRects(rect) {
  const n = state?.split?.length && state.split.includes(state.activeTab) ? state.split.length : 1;
  const ratios = ui.ratios?.length === n ? ui.ratios : Array(n).fill(1 / n);
  const usable = rect.width - GAP * (n - 1);
  const rects = [];
  let left = rect.x;
  for (let i = 0; i < n; i++) {
    const w = i === n - 1 ? rect.x + rect.width - left : Math.round(usable * ratios[i]);
    rects.push({ x: Math.round(left), y: rect.y, width: Math.round(w), height: rect.height });
    left += w + GAP;
  }
  return rects;
}

// The space background gets holes where the pages are, so they show through when the UI is on top.
function drawHoles(rect, radius) {
  const W = innerWidth;
  const H = innerHeight;
  const r = radius;
  const paths = viewRects(rect).map(
    ({ x, y, width: w, height: h }) =>
      `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`,
  );
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'><path fill-rule='evenodd' d='M0 0H${W}V${H}H0Z ${paths.join(" ")}'/></svg>`;
  document.body.style.setProperty("--hole", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
}

new ResizeObserver(reportLayout).observe($("#page"));
addEventListener("resize", reportLayout);

// ---- rendering ----

api.on("archium:state", (next) => {
  const prevSpace = state?.spaceId;
  state = next;
  render(prevSpace);
});

function activeSpace() {
  return state.spaces.find((s) => s.id === state.spaceId) ?? state.spaces[0];
}

function activeTabInfo() {
  if (!state.activeTab) return null;
  for (const t of state.favourites) if (t.id === state.activeTab) return t;
  for (const s of state.spaces) {
    for (const i of s.items) {
      if (i.type === "folder") {
        const c = i.children.find((x) => x.id === state.activeTab);
        if (c) return c;
      } else if (i.id === state.activeTab) return i;
    }
    const t = s.today.find((x) => x.id === state.activeTab);
    if (t) return t;
  }
  return null;
}

function applyTheme(space) {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const colors = space.colors?.length ? space.colors : [[124, 108, 242]];
  const look = state.settings.look;
  const opacity = look === "zen" ? 0.35 : look === "glass" ? 0.65 : 0.55;
  document.body.style.setProperty("--space-bg", getGradient(colors, { isDarkMode: dark, opacity }));
  document.body.style.setProperty("--accent", getAccentColorForUI(colors[0], dark));
  const [c1, c2 = c1, c3 = c2] = colors;
  document.body.style.setProperty("--blob1", `rgb(${c1.join(",")})`);
  document.body.style.setProperty("--blob2", `rgb(${c2.join(",")})`);
  document.body.style.setProperty("--blob3", `rgb(${c3.join(",")})`);
  // Light text when it reads better on this space's colour. Zen's check answers "should the
  // toolbar be in dark mode", i.e. use light text.
  const lightInk = look !== "retro" && (dark || shouldBeDarkMode(colors[0], { isDarkMode: dark, opacity }));
  document.body.dataset.ink = lightInk ? "light" : "dark";
}

function setLook(look) {
  if (document.body.dataset.look === look) return;
  document.body.dataset.look = look;
  for (const link of document.querySelectorAll("link[data-look]")) link.disabled = link.dataset.look !== look;
  for (const off of ui.glassOff) off();
  ui.glassOff = [];
  if (look === "glass") {
    ui.glassOff.push(glass($("#sidebar"), { radius: 20, thickness: 40, bezel: 18, blur: 0.8, specularOpacity: 0.6 }));
    ui.glassOff.push(glass($("#url"), { radius: 12, thickness: 30, bezel: 14, blur: 0.4 }));
    ui.glassOff.push(glass($("#toast"), { radius: 10, thickness: 30, bezel: 10 }));
  }
  if (look !== "retro") ui.glassOff.push(glass($("#command"), { radius: 18, thickness: 60, bezel: 24, blur: 0.6 }));
  requestAnimationFrame(reportLayout);
}

// The system traffic lights show only with the "native" window-buttons setting, and in compact
// mode only while the sidebar is out. The glass ones live in the sidebar and come along with it.
// Retro 98 has its own title bar, so it keeps the system buttons.
let nativeLights = null;
function syncTrafficLights() {
  if (!mac || !state) return;
  const glassLights = document.body.dataset.wb === "glass";
  const visible = !glassLights && (ui.reveal || !state.settings.compact);
  if (visible === nativeLights) return;
  nativeLights = visible;
  call("traffic-lights", visible);
}

function render(prevSpace) {
  const s = state.settings;
  setLook(s.look);
  document.body.dataset.fullscreen = String(state.fullscreen);
  document.body.dataset.wb = mac && s.windowButtons !== "native" && s.look !== "retro" ? "glass" : "native";
  $(".window-controls").classList.toggle("glass-lights", document.body.dataset.wb === "glass");
  $(".window-controls").classList.toggle("is-blurred", state.focused === false);
  syncTrafficLights();
  document.body.classList.toggle("compact", s.compact);
  if (!ui.resizing) document.body.style.setProperty("--sidebar-w", `${s.sidebarWidth}px`);
  const space = activeSpace();
  applyTheme(space);

  const active = activeTabInfo();
  document.body.classList.toggle("has-page", Boolean(active?.loaded && !active.elsewhere));
  $("#url-text").textContent = active ? prettyUrl(active.url) : "Search or enter address";
  $("#url-text").classList.toggle("has-url", Boolean(active));
  $("#url-text").title = active?.url ?? "";
  $("#url-copy").hidden = !active;
  const secure = active && /^(https|archium):/.test(active.url);
  $("#url-site").innerHTML = icon(!active ? "search" : secure ? "lock" : "unlock");
  if (active?.blocked) $("#url-site").dataset.blocked = String(active.blocked > 99 ? "99+" : active.blocked);
  else delete $("#url-site").dataset.blocked;
  $("#btn-back").disabled = !active?.canGoBack;
  $("#btn-forward").disabled = !active?.canGoForward;
  $("#retro-caption").textContent = active ? `${active.title} - Archium` : "Archium";
  document.title = active ? `${active.title} – Archium` : "Archium";

  renderFavourites();
  renderSpace(space, prevSpace);
  renderDots();
  renderDownloads();
  renderGlance();
  updateOverlay();
  $("#empty-hint").textContent = isPrivate
    ? "Private window: nothing you do here is saved, and agents can't see it."
    : `${key("⌘T")} to search · ${key("⌘S")} hides the sidebar · ${mac ? "⌥" : "Alt+"}click a link to Glance`;
  requestAnimationFrame(reportLayout);
}

function tabClasses(node, t) {
  node.classList.toggle("active", t.id === state.activeTab);
  node.classList.toggle("loaded", t.loaded && !t.elsewhere);
  node.classList.toggle("unloaded", !t.loaded);
  node.classList.toggle("loading", t.loading);
  node.classList.toggle("audible", t.audible && !t.muted);
  node.classList.toggle("muted", t.muted);
  node.classList.toggle("split-member", Boolean(state.split?.includes(t.id)));
}

function renderFavourites() {
  syncList(
    $("#favourites"),
    state.favourites,
    (t) => t.id,
    () => {
      const node = el("button", "fav");
      node.draggable = true;
      return node;
    },
    (node, t) => {
      node.dataset.id = t.id;
      node.dataset.zone = "favourites";
      node.title = t.title;
      setFavicon(node, t);
      tabClasses(node, t);
    },
  );
}

function makeTab() {
  const node = el(
    "div",
    "tab",
    `<span class="title"></span><span class="actions">
      <button class="icon-btn audio" data-act="mute" title="Mute">${icon("sound")}</button>
      <button class="icon-btn reset" data-act="reset" title="Back to the pinned page" hidden>${icon("back")}</button>
      <button class="icon-btn close" data-act="close">${icon("x")}</button></span>`,
  );
  node.draggable = true;
  return node;
}

function updateTab(node, t, zone, folderId = null) {
  node.dataset.id = t.id;
  node.dataset.zone = zone;
  if (folderId) node.dataset.folder = folderId;
  else delete node.dataset.folder;
  setFavicon(node, t);
  const title = node.querySelector(".title");
  if (title.textContent !== t.title) title.textContent = t.title;
  node.title = t.url;
  tabClasses(node, t);
  node.querySelector(".audio").innerHTML = icon(t.muted ? "muted" : "sound");
  const moved = Boolean(t.pinnedUrl && t.pinnedUrl !== t.url);
  node.querySelector(".reset").hidden = !moved;
  const close = node.querySelector(".close");
  close.title = zone === "today" ? "Close tab" : "Unload tab";
  close.style.visibility = zone !== "today" && !t.loaded ? "hidden" : "";
}

function renderSpace(space, prevSpace) {
  const section = $("#space");
  if (prevSpace && prevSpace !== space.id) {
    const before = state.spaces.findIndex((s) => s.id === prevSpace);
    const after = state.spaces.findIndex((s) => s.id === space.id);
    section.classList.remove("slide-left", "slide-right");
    void section.offsetWidth;
    section.classList.add(after > before ? "slide-left" : "slide-right");
  }
  $("#space-icon").textContent = space.icon || "◆";
  $("#space-name").textContent = space.name;

  syncList(
    $("#pinned"),
    space.items,
    (i) => `${i.type}:${i.id}`,
    (i) => (i.type === "folder" ? makeFolder() : makeTab()),
    (node, i) => (i.type === "folder" ? updateFolder(node, i, space.id) : updateTab(node, i, "pinned")),
  );
  syncList($("#today"), space.today, (t) => t.id, makeTab, (node, t) => updateTab(node, t, "today"));
  $("#clear-today").hidden = !space.today.length;
}

function makeFolder() {
  return el(
    "div",
    "folder",
    `<div class="folder-head"><svg class="chevron"><use href="#i-chevron" /></svg>${icon("folder")}<span class="name"></span></div><div class="children list"></div>`,
  );
}

function updateFolder(node, f, spaceId) {
  node.dataset.folder = f.id;
  node.dataset.space = spaceId;
  node.classList.toggle("open", f.open);
  const name = node.querySelector(".name");
  if (name.getAttribute("contenteditable") !== "true" && name.textContent !== f.name) name.textContent = f.name;
  syncList(node.querySelector(".children"), f.children, (t) => t.id, makeTab, (n, t) => updateTab(n, t, "pinned", f.id));
}

function renderDots() {
  syncList(
    $("#space-dots"),
    state.spaces,
    (s) => s.id,
    () => el("button", "space-dot"),
    (node, s) => {
      node.dataset.space = s.id;
      node.textContent = s.icon || "•";
      node.title = s.name;
      node.classList.toggle("active", s.id === state.spaceId);
    },
  );
  $("#btn-new-space").hidden = isPrivate;
}

function renderDownloads() {
  const d = state.downloads;
  const btn = $("#btn-downloads");
  btn.hidden = !d.active;
  btn.style.setProperty("--progress", d.progress < 0 ? 0.25 : d.progress);
}

// ---- sidebar interaction ----

$("#sidebar").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]");
  const tab = e.target.closest(".tab, .fav");
  if (act && tab) {
    e.stopPropagation();
    const id = tab.dataset.id;
    if (act.dataset.act === "close") call("close", id);
    else if (act.dataset.act === "mute") call("mute", id);
    else if (act.dataset.act === "reset") call("reset-pinned", id);
    return;
  }
  if (tab) return call("activate", tab.dataset.id);
  const head = e.target.closest(".folder-head");
  if (head && !head.querySelector("[contenteditable=true]")) {
    const folder = head.parentElement;
    call("folder-update", { spaceId: folder.dataset.space, folderId: folder.dataset.folder, patch: { open: !folder.classList.contains("open") } });
    return;
  }
  const dot = e.target.closest(".space-dot");
  if (dot) call("space-switch", dot.dataset.space);
});

$("#sidebar").addEventListener("auxclick", (e) => {
  const tab = e.target.closest(".tab, .fav");
  if (tab && e.button === 1) call("close", tab.dataset.id);
});

$("#sidebar").addEventListener("contextmenu", (e) => {
  const tab = e.target.closest(".tab, .fav");
  if (tab) {
    e.preventDefault();
    call("tab-menu", tab.dataset.id);
    return;
  }
  const head = e.target.closest(".folder-head");
  if (head) {
    e.preventDefault();
    renameFolder(head.parentElement);
  }
});

$("#sidebar").addEventListener("dblclick", (e) => {
  const head = e.target.closest(".folder-head");
  if (head) renameFolder(head.parentElement);
});

function renameFolder(folder) {
  const name = folder.querySelector(".name");
  name.contentEditable = "true";
  name.focus();
  getSelection().selectAllChildren(name);
  const finish = (save) => {
    name.contentEditable = "false";
    name.removeEventListener("keydown", onKey);
    name.removeEventListener("blur", onBlur);
    const value = name.textContent.trim();
    if (save && value) call("folder-update", { spaceId: folder.dataset.space, folderId: folder.dataset.folder, patch: { name: value } });
    else render();
  };
  const onKey = (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      finish(true);
    } else if (ev.key === "Escape") finish(false);
  };
  const onBlur = () => finish(true);
  name.addEventListener("keydown", onKey);
  name.addEventListener("blur", onBlur);
}

$("#new-tab").addEventListener("click", () => openCommand("new"));
$("#empty-search").addEventListener("click", () => openCommand("new"));
$("#url-text").addEventListener("click", () => openCommand(activeTabInfo() ? "edit" : "new"));
$("#url-copy").addEventListener("click", () => call("command", { id: "copy-url" }));
$("#url-site").addEventListener("click", () => (activeTabInfo() ? openSitePanel() : openCommand("new")));
$("#btn-back").addEventListener("click", () => call("nav", "back"));
$("#btn-forward").addEventListener("click", () => call("nav", "forward"));
$("#btn-reload").addEventListener("click", (e) => call("nav", e.shiftKey ? "hard-reload" : "reload"));
$("#btn-sidebar").addEventListener("click", () => call("command", { id: "toggle-sidebar" }));
$("#btn-library").addEventListener("click", () => call("command", { id: "library" }));
$("#btn-downloads").addEventListener("click", () => call("command", { id: "library" }));
$("#btn-new-space").addEventListener("click", () => newSpace());
$("#space-menu").addEventListener("click", (e) => openSpaceEditor(state.spaceId, e.currentTarget));
$("#clear-today").addEventListener("click", () => call("clear-today"));
for (const b of document.querySelectorAll("[data-window]"))
  b.addEventListener("click", (e) => {
    // macOS green button: full screen, or zoom with ⌥, like the system button.
    const glassZoom = b.dataset.window === "maximize" && document.body.dataset.wb === "glass";
    call("window", glassZoom && !e.altKey ? "fullscreen" : b.dataset.window);
  });

// A two-finger swipe across the sidebar changes space.
let swipe = 0;
let swipeTimer = null;
$("#sidebar").addEventListener(
  "wheel",
  (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    swipe += e.deltaX;
    clearTimeout(swipeTimer);
    swipeTimer = setTimeout(() => (swipe = 0), 220);
    if (Math.abs(swipe) > 90) {
      call("space-switch", swipe > 0 ? 1 : -1);
      swipe = -Math.sign(swipe) * 600; // one space per swipe
    }
  },
  { passive: true },
);

// ---- sidebar width ----

$("#resizer").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  ui.resizing = true;
  $("#resizer").setPointerCapture(e.pointerId);
  const move = (ev) => document.body.style.setProperty("--sidebar-w", `${Math.max(200, Math.min(420, ev.clientX + 4))}px`);
  const up = (ev) => {
    ui.resizing = false;
    $("#resizer").removeEventListener("pointermove", move);
    $("#resizer").removeEventListener("pointerup", up);
    call("sidebar-width", ev.clientX + 4);
  };
  $("#resizer").addEventListener("pointermove", move);
  $("#resizer").addEventListener("pointerup", up);
});

// ---- compact mode: the sidebar slides in from the left edge ----

let hideTimer = null;
function reveal(on) {
  clearTimeout(hideTimer);
  if (ui.reveal === on) return;
  ui.reveal = on;
  document.body.classList.toggle("reveal", on);
  $("#sidebar").classList.toggle("zen-toolbar-background", on);
  syncTrafficLights();
  updateOverlay();
}

$("#edge").addEventListener("mouseenter", () => state?.settings.compact && reveal(true));
$("#sidebar").addEventListener("mouseenter", () => clearTimeout(hideTimer));
$("#sidebar").addEventListener("mouseleave", () => {
  if (!state?.settings.compact || ui.popover || ui.dragging) return;
  hideTimer = setTimeout(() => reveal(false), 280);
});

// ---- drag and drop ----

const DRAG_TYPE = "application/x-archium-tab";

document.addEventListener("dragstart", (e) => {
  const tab = e.target.closest?.(".tab, .fav");
  if (!tab) return;
  e.dataTransfer.setData(DRAG_TYPE, tab.dataset.id);
  e.dataTransfer.setData("text/uri-list", tab.title || "");
  e.dataTransfer.effectAllowed = "move";
  ui.dragging = tab.dataset.id;
  document.body.classList.add("dragging");
  // Split targets only make sense next to another page.
  $("#dropzones").hidden = !state.activeTab || state.activeTab === ui.dragging || !document.body.classList.contains("has-page");
  updateOverlay();
});

document.addEventListener("dragend", endDrag);

function endDrag() {
  ui.dragging = null;
  document.body.classList.remove("dragging");
  $("#dropzones").hidden = true;
  clearMarks();
  if (ui.reveal && state.settings.compact) hideTimer = setTimeout(() => reveal(false), 400);
  updateOverlay();
}

function clearMarks() {
  for (const n of document.querySelectorAll(".drop-before, .drop-after, .drop-into, .over")) n.classList.remove("drop-before", "drop-after", "drop-into", "over");
}

// Where a drop at (x, y) over `target` would put the tab, and the element to mark.
function dropTarget(e) {
  const t = e.target;
  const zone = t.closest?.("#dropzones > div");
  if (zone) return { split: zone.dataset.side, mark: zone, cls: "over" };
  const dot = t.closest?.(".space-dot");
  if (dot) return { place: { zone: "today", spaceId: dot.dataset.space, index: 0 }, mark: dot, cls: "drop-into" };
  const fav = t.closest?.(".fav");
  const favs = t.closest?.("#favourites");
  if (fav || favs) {
    const list = [...$("#favourites").children];
    const index = fav ? list.indexOf(fav) + (e.clientX > fav.getBoundingClientRect().left + fav.offsetWidth / 2 ? 1 : 0) : list.length;
    return { place: { zone: "favourites", index }, mark: fav ?? favs, cls: fav ? (index > list.indexOf(fav) ? "drop-after" : "drop-before") : "drop-into" };
  }
  const head = t.closest?.(".folder-head");
  if (head) {
    const folder = head.parentElement;
    return { place: { zone: "pinned", spaceId: state.spaceId, folderId: folder.dataset.folder }, mark: folder, cls: "drop-into" };
  }
  const row = t.closest?.(".tab");
  const pinned = t.closest?.("#pinned");
  const today = t.closest?.("#today, #new-tab, .divider");
  if (row && (pinned || t.closest("#today"))) {
    const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    const parent = row.parentElement;
    const siblings = [...parent.children];
    const index = siblings.indexOf(row) + (after ? 1 : 0);
    const zoneName = pinned ? "pinned" : "today";
    return { place: { zone: zoneName, spaceId: state.spaceId, folderId: row.dataset.folder ?? undefined, index }, mark: row, cls: after ? "drop-after" : "drop-before" };
  }
  if (pinned) return { place: { zone: "pinned", spaceId: state.spaceId }, mark: pinned, cls: "drop-into" };
  if (today) return { place: { zone: "today", spaceId: state.spaceId, index: 0 }, mark: $("#new-tab"), cls: "drop-after" };
  return null;
}

document.addEventListener("dragover", (e) => {
  if (!ui.dragging) return;
  const target = dropTarget(e);
  clearMarks();
  if (!target) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  target.mark?.classList.add(target.cls);
});

document.addEventListener("drop", (e) => {
  const id = ui.dragging;
  const target = id && dropTarget(e);
  if (!target) return endDrag();
  e.preventDefault();
  if (target.split) {
    const ids = target.split === "left" ? [id, state.activeTab] : [state.activeTab, id];
    call("split", ids);
  } else {
    call("place", { id, target: target.place });
  }
  endDrag();
});

// ---- split view: drag the gap between pages ----

function placeSplitters(rect) {
  const holder = $("#splitters");
  const inSplit = state?.split?.includes(state.activeTab) && document.body.classList.contains("has-page");
  const rects = inSplit ? viewRects(rect) : [];
  syncList(
    holder,
    rects.slice(0, -1).map((r, i) => ({ i, r })),
    (x) => String(x.i),
    () => el("div", "zen-split-view-splitter"),
    (node, { i, r }) => {
      node.dataset.index = i;
      Object.assign(node.style, { left: `${r.x + r.width}px`, top: `${r.y}px`, width: `${GAP}px`, height: `${r.height}px` });
    },
  );
}

$("#splitters").addEventListener("pointerdown", (e) => {
  const node = e.target.closest(".zen-split-view-splitter");
  if (!node) return;
  e.preventDefault();
  node.setPointerCapture(e.pointerId);
  const page = $("#page").getBoundingClientRect();
  const n = state.split.length;
  const usable = page.width - GAP * (n - 1);
  const i = Number(node.dataset.index);
  const ratios = ui.ratios?.length === n ? [...ui.ratios] : Array(n).fill(1 / n);
  const move = (ev) => {
    const leftEdge = page.left + ratios.slice(0, i).reduce((a, b) => a + b, 0) * usable + GAP * i;
    const pair = ratios[i] + ratios[i + 1];
    const mine = Math.max(0.1, Math.min(pair - 0.1, (ev.clientX - leftEdge) / usable));
    ratios[i] = mine;
    ratios[i + 1] = pair - mine;
    ui.ratios = [...ratios];
    call("split-ratios", ui.ratios);
    reportLayout();
  };
  const up = () => {
    node.removeEventListener("pointermove", move);
    node.removeEventListener("pointerup", up);
  };
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", up);
});

// ---- Glance ----

let lastGlance = "";
function placeGlance(rect) {
  if (!state?.glance) return;
  const w = Math.round(Math.min(rect.width * 0.86, rect.width - 110));
  const h = Math.round(rect.height - 24);
  const x = Math.round(rect.x + (rect.width - w) / 2 - 22);
  const y = Math.round(rect.y + 12);
  const g = { x, y, width: w, height: h };
  const k = JSON.stringify(g);
  if (k !== lastGlance) {
    lastGlance = k;
    call("glance-rect", g);
  }
  Object.assign($("#glance-buttons").style, { left: `${x + w + 12}px`, top: `${y}px` });
}

function renderGlance() {
  const on = Boolean(state.glance);
  document.body.classList.toggle("glance", on);
  $("#glance-buttons").hidden = !on;
  if (!on) lastGlance = "";
  $("#scrim").hidden = !(on || ui.command);
}

$("#glance-close").addEventListener("click", () => call("glance-close"));
$("#glance-expand").addEventListener("click", () => call("glance-expand", { split: false }));
$("#glance-split").addEventListener("click", () => call("glance-expand", { split: true }));
$("#scrim").addEventListener("click", () => {
  if (ui.command) closeCommand();
  else if (state.glance) call("glance-close");
});

// ---- command bar ----

async function openCommand(mode) {
  if (ui.command) {
    if (ui.command.mode === mode) return closeCommand();
    ui.command.mode = mode;
  }
  closePopover();
  const [index, commands, shots] = await Promise.all([call("search-index"), call("commands"), call("snapshot")]);
  ui.command = { mode, index, commands, items: [], selected: 0, suggestions: [] };
  const snaps = $("#snapshots");
  snaps.replaceChildren(
    ...shots.map((s) => {
      const img = new Image();
      img.src = s.src;
      Object.assign(img.style, { left: `${s.x}px`, top: `${s.y}px`, width: `${s.width}px`, height: `${s.height}px`, borderRadius: getComputedStyle($("#page")).borderRadius });
      return img;
    }),
  );
  $("#command").hidden = false;
  $("#scrim").hidden = false;
  $("#command-mode").textContent = mode === "edit" ? `${key("⌘")}↵ new tab` : "";
  updateOverlay();
  const input = $("#command-input");
  input.value = mode === "edit" ? index.current : "";
  input.placeholder = mode === "edit" ? "Edit address or search" : "Search or enter address";
  input.focus();
  input.select();
  computeResults();
}

function closeCommand() {
  if (!ui.command) return;
  ui.command = null;
  $("#command").hidden = true;
  $("#snapshots").replaceChildren();
  $("#scrim").hidden = !state?.glance;
  updateOverlay();
}

const engineName = () => ENGINES[ui.command?.index.engine]?.name ?? "the web";

function computeResults() {
  const c = ui.command;
  if (!c) return;
  const q = $("#command-input").value.trim();
  const editing = c.mode === "edit" && q === c.index.current;
  const items = [];
  const openUrls = new Set(c.index.tabs.map((t) => t.url));
  const tabItem = (t) => ({
    kind: "tab",
    id: t.id,
    favicon: t.favicon,
    url: t.url,
    main: t.title,
    sub: prettyUrl(t.url),
    badge: t.id === state.activeTab ? "This tab" : `${t.space ? `${t.space.icon} ${t.space.name}` : "Favourites"} · Switch`,
  });
  if (!q || editing) {
    const recent = c.index.tabs.filter((t) => t.loaded && t.id !== state.activeTab).slice(0, 6);
    items.push(...recent.map(tabItem));
    if (!recent.length) items.push(...c.commands.filter((x) => ["new-space", "import", "settings", "library"].includes(x.id)).map((x) => ({ kind: "command", ...x, main: x.label, badge: key(prettyKeys(x.keys)) })));
  } else {
    const url = looksLikeUrl(q);
    if (url) items.push({ kind: "open", input: q, main: q, sub: "Open address", icon: "globe" });
    const tabs = rank(q, c.index.tabs, (t) => [[t.title, 1.2], [t.url, 1]], 6);
    const hist = rank(q, c.index.history.filter((h) => !openUrls.has(h.url)), (h) => [[h.title, 1], [h.url, 1]], 5);
    const commandQuery = q.replace(/^>\s*/, "");
    const cmds = commandQuery ? rank(commandQuery, c.commands, (x) => [[x.label, 1]], q.startsWith(">") ? 12 : 3) : c.commands;
    const spaces = rank(q, c.index.spaces, (s) => [[s.name, 1]], 2);
    const archived = rank(q, c.index.archive, (a) => [[a.title, 0.8], [a.url, 0.8]], 3);
    if (!q.startsWith(">")) {
      if (tabs[0]) items.push(tabItem(tabs[0]));
      if (!url) items.push({ kind: "open", input: q, main: q, sub: `Search ${engineName()}`, icon: "search" });
      items.push(...tabs.slice(1).map(tabItem));
      items.push(...hist.map((h) => ({ kind: "url", url: h.url, main: h.title || h.url, sub: prettyUrl(h.url), badge: "History", icon: "globe" })));
      items.push(...spaces.map((s) => ({ kind: "space", id: s.id, main: `${s.icon} ${s.name}`, badge: "Go to space", icon: "arrow" })));
      items.push(...archived.map((a) => ({ kind: "archived", index: c.index.archive.indexOf(a), main: a.title || a.url, sub: prettyUrl(a.url), badge: "Archived", icon: "library" })));
      items.push(...c.suggestions.filter((s) => s !== q).map((s) => ({ kind: "open", input: s, main: s, sub: `Search ${engineName()}`, icon: "search" })));
    }
    items.push(...cmds.map((x) => ({ kind: "command", id: x.id, main: x.label, badge: key(prettyKeys(x.keys)), icon: "dots" })));
  }
  c.items = items;
  c.selected = Math.min(c.selected, Math.max(0, items.length - 1));
  drawResults();
}

function prettyKeys(keys) {
  if (!keys) return "";
  return keys
    .replace(/CmdOrCtrl\+|Command\+|Cmd\+/g, "⌘")
    .replace(/Control\+|Ctrl\+/g, "⌃")
    .replace(/Shift\+/g, "⇧")
    .replace(/Alt\+/g, "⌥")
    .replace(/Right/, "→")
    .replace(/Left/, "←");
}

function drawResults() {
  const list = $("#results");
  const c = ui.command;
  list.replaceChildren(
    ...c.items.map((item, i) => {
      const li = el("li", `item${i === c.selected ? " selected" : ""}`);
      li.setAttribute("role", "option");
      if (item.kind === "tab") setFavicon(li, { favicon: item.favicon, url: item.url, title: item.main });
      else li.innerHTML = icon(item.icon ?? "dots");
      const text = el("span", "text");
      text.append(Object.assign(el("span", "main"), { textContent: item.main }));
      if (item.sub) text.append(Object.assign(el("span", "sub"), { textContent: item.sub }));
      li.append(text);
      if (item.badge) li.append(Object.assign(el("span", "badge"), { textContent: item.badge }));
      li.addEventListener("mousemove", () => {
        if (c.selected !== i) {
          c.selected = i;
          drawResults();
        }
      });
      li.addEventListener("click", (ev) => runItem(item, ev.metaKey || ev.ctrlKey));
      return li;
    }),
  );
  list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

function runItem(item, forceNew = false) {
  const c = ui.command;
  if (!c || !item) return;
  const newTab = forceNew || c.mode === "new" || !state.activeTab;
  closeCommand();
  if (item.kind === "open") call("open", { input: item.input, newTab });
  else if (item.kind === "url") call("open", { input: item.url, newTab });
  else if (item.kind === "tab") call("activate", item.id);
  else if (item.kind === "space") call("space-switch", item.id);
  else if (item.kind === "archived") call("restore-archived", item.index);
  else if (item.kind === "command") call("command", { id: item.id });
}

let suggestTimer = null;
$("#command-input").addEventListener("input", () => {
  if (!ui.command) return;
  ui.command.selected = 0;
  ui.command.suggestions = [];
  computeResults();
  clearTimeout(suggestTimer);
  const q = $("#command-input").value.trim();
  if (ui.command.index.suggestions && q && !looksLikeUrl(q) && !q.startsWith(">")) {
    suggestTimer = setTimeout(async () => {
      const list = await call("suggest", q);
      if (ui.command && $("#command-input").value.trim() === q) {
        ui.command.suggestions = list;
        computeResults();
      }
    }, 160);
  }
});

$("#command-input").addEventListener("keydown", (e) => {
  const c = ui.command;
  if (!c) return;
  if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
    e.preventDefault();
    c.selected = Math.min(c.items.length - 1, c.selected + 1);
    drawResults();
  } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
    e.preventDefault();
    c.selected = Math.max(0, c.selected - 1);
    drawResults();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const q = $("#command-input").value.trim();
    const forceNew = e.metaKey || e.ctrlKey;
    // Editing the address and pressing Enter goes there, even with a tab result on top.
    if (c.mode === "edit" && q && q !== c.index.current && looksLikeUrl(q)) return runItem({ kind: "open", input: q }, forceNew);
    if (c.mode === "edit" && q === c.index.current) return closeCommand();
    runItem(c.items[c.selected], forceNew);
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeCommand();
  }
});

// ---- find in page ----

function openFind() {
  ui.find = true;
  $("#findbar").hidden = false;
  $("#find-input").focus();
  $("#find-input").select();
  requestAnimationFrame(reportLayout);
}

function closeFind() {
  ui.find = false;
  $("#findbar").hidden = true;
  $("#find-count").textContent = "";
  call("find-stop");
  call("focus-page");
  requestAnimationFrame(reportLayout);
}

$("#find-input").addEventListener("input", () => call("find", { text: $("#find-input").value }));
$("#findbar").addEventListener("submit", (e) => e.preventDefault());
$("#find-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") call("find", { text: $("#find-input").value, forward: !e.shiftKey, findNext: true });
  else if (e.key === "Escape") closeFind();
});
$("#find-next").addEventListener("click", () => call("find", { text: $("#find-input").value, forward: true, findNext: true }));
$("#find-prev").addEventListener("click", () => call("find", { text: $("#find-input").value, forward: false, findNext: true }));
$("#find-close").addEventListener("click", closeFind);
api.on("archium:found", (r) => {
  $("#find-count").textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : $("#find-input").value ? "0/0" : "";
});

// ---- permission prompts ----

const PERMISSION_TEXT = {
  camera: "use your camera",
  microphone: "use your microphone",
  "camera+microphone": "use your camera and microphone",
  geolocation: "know your location",
  notifications: "show notifications",
  midi: "use MIDI devices",
  midiSysex: "control MIDI devices",
  "idle-detection": "know when you're idle",
  "display-capture": "see your screen",
  "window-management": "manage windows on your displays",
};

api.on("archium:permission", (req) => {
  ui.permissions.push(req);
  showPermission();
});

function showPermission() {
  const req = ui.permissions[0];
  $("#permission").hidden = !req;
  if (req) {
    const host = (() => {
      try {
        return new URL(req.origin).host;
      } catch {
        return req.origin;
      }
    })();
    $("#permission-text").textContent = `${host} wants to ${PERMISSION_TEXT[req.permission] ?? req.permission}.`;
  }
  requestAnimationFrame(reportLayout);
}

function answerPermission(allow) {
  const req = ui.permissions.shift();
  if (req) call("permission-answer", { id: req.id, allow, remember: $("#permission-remember").checked });
  showPermission();
}
$("#permission-allow").addEventListener("click", () => answerPermission(true));
$("#permission-block").addEventListener("click", () => answerPermission(false));

// ---- popovers ----

function openPopover(node, anchor) {
  const pop = $("#popover");
  closeCommand();
  pop.replaceChildren(...node);
  pop.hidden = false;
  ui.popover = true;
  const a = anchor.getBoundingClientRect();
  const left = Math.min(a.left, innerWidth - pop.offsetWidth - 12);
  const top = Math.min(a.bottom + 6, innerHeight - pop.offsetHeight - 12);
  Object.assign(pop.style, { left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px` });
  if (state.settings.look === "glass") ui.popGlass = glass(pop, { radius: 14, thickness: 40, bezel: 16 });
  updateOverlay();
}

function closePopover() {
  if (!ui.popover) return;
  ui.popover = null;
  ui.popGlass?.();
  ui.popGlass = null;
  $("#popover").hidden = true;
  if (state?.settings.compact && ui.reveal) hideTimer = setTimeout(() => reveal(false), 600);
  updateOverlay();
}

document.addEventListener("pointerdown", (e) => {
  if (ui.popover && !e.target.closest("#popover") && !e.target.closest("#url-site, #space-menu, #btn-new-space")) closePopover();
});

function line(...children) {
  const row = el("div", "line");
  row.append(...children);
  return row;
}

function toggle(label, checked, onChange) {
  const input = Object.assign(el("input", "switch"), { type: "checkbox", checked });
  input.addEventListener("change", () => onChange(input.checked));
  const row = line(Object.assign(el("span"), { textContent: label }), el("span", "grow"), input);
  return row;
}

function button(label, cls, onClick, iconName) {
  const b = el("button", `btn ${cls ?? ""}`, `${iconName ? icon(iconName) : ""}<span></span>`);
  b.querySelector("span").textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function openSitePanel() {
  const t = activeTabInfo();
  if (!t) return;
  let host = "";
  try {
    host = new URL(t.url).hostname;
  } catch {}
  const site = state.site ?? { adblock: true, cookies: true };
  const secure = t.url.startsWith("https:") || t.url.startsWith("archium:");
  const title = Object.assign(el("h3"), { textContent: host || prettyUrl(t.url) });
  const conn = Object.assign(el("div", "muted"), { textContent: secure ? "Connection is secure." : "Connection is not secure: others on the network can see this page." });
  const blocked = Object.assign(el("div", "muted"), { textContent: `${t.blocked || 0} ads and trackers blocked on this page.` });
  const nodes = [title, conn, blocked];
  if (host && /^https?:/.test(t.url)) {
    nodes.push(
      toggle("Block ads and trackers", site.adblock, (v) => call("site-exception", { host, key: "adblock", value: v })),
      toggle("Block third-party cookies", site.cookies, (v) => call("site-exception", { host, key: "cookies", value: v })),
      button("Boost this site", "wide", () => (closePopover(), call("command", { id: "boost" })), "boost"),
      button("Zap an element", "wide", () => (closePopover(), call("command", { id: "zap" })), "zap"),
    );
    if (state.settings.archivebox) nodes.push(button("Archive in ArchiveBox", "wide", () => (closePopover(), call("command", { id: "archive-page" })), "library"));
  }
  openPopover(nodes, $("#url-site"));
}

// ---- spaces: new and edit ----

const EMOJI = ["✦", "◆", "●", "★", "♥", "☀", "☾", "⚡", "🏠", "💼", "🎨", "🎵", "📚", "🧪", "🛒", "🎮", "✈️", "🌱", "🔒", "💬"];
const WHEEL = 200;

function randomColors() {
  const primary = { x: WHEEL / 2 + (Math.random() - 0.5) * 120, y: WHEEL / 2 + (Math.random() - 0.5) * 120 };
  return calculateCompliments(primary, "analogous", WHEEL).map((p) => getColorFromPosition(p.x, p.y, WHEEL));
}

async function newSpace() {
  const id = await call("space-add", { name: `Space ${state.spaces.length + 1}`, icon: EMOJI[state.spaces.length % EMOJI.length], colors: randomColors() });
  if (id) setTimeout(() => openSpaceEditor(id, $("#space-menu"), { fresh: true }), 60);
}

function openSpaceEditor(spaceId, anchor, { fresh = false } = {}) {
  const space = state.spaces.find((s) => s.id === spaceId);
  if (!space) return;
  const update = (patch) => call("space-update", { id: spaceId, patch });
  let harmony = space.colors.length >= 3 ? "analogous" : space.colors.length === 2 ? "complementary" : "floating";

  const title = Object.assign(el("h3"), { textContent: fresh ? "New space" : "Edit space" });
  const iconInput = Object.assign(el("input", "icon-input"), { type: "text", value: space.icon, maxLength: 4 });
  const nameInput = Object.assign(el("input"), { type: "text", value: space.name, placeholder: "Name" });
  iconInput.addEventListener("input", () => iconInput.value.trim() && update({ icon: iconInput.value.trim() }));
  nameInput.addEventListener("input", () => nameInput.value.trim() && update({ name: nameInput.value.trim() }));
  const emojis = el("div", "emoji-row");
  for (const e of EMOJI) {
    const b = Object.assign(el("button"), { textContent: e });
    b.addEventListener("click", () => {
      iconInput.value = e;
      update({ icon: e });
    });
    emojis.append(b);
  }

  const wheel = el("div", "wheel");
  const preview = el("div", "preview");
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  let primary = calculateInitialPosition(space.colors[0] ?? [124, 108, 242], WHEEL);
  const draw = (save) => {
    const dots = calculateCompliments(primary, harmony, WHEEL);
    const colors = dots.map((p) => getColorFromPosition(p.x, p.y, WHEEL)).slice(0, 3);
    wheel.replaceChildren(
      ...dots.map((p, i) => {
        const d = el("div", `dot${i === 0 ? " primary" : ""}`);
        Object.assign(d.style, { left: `${p.x}px`, top: `${p.y}px`, background: `rgb(${colors[i]?.join(",")})` });
        return d;
      }),
    );
    preview.style.background = getGradient(colors, { isDarkMode: dark, opacity: 0.6 });
    if (save) update({ colors });
  };
  const pick = (e) => {
    const r = wheel.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const dx = x - WHEEL / 2;
    const dy = y - WHEEL / 2;
    const dist = Math.min(WHEEL / 2, Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    primary = { x: WHEEL / 2 + dist * Math.cos(a), y: WHEEL / 2 + dist * Math.sin(a) };
    draw(true);
  };
  wheel.addEventListener("pointerdown", (e) => {
    wheel.setPointerCapture(e.pointerId);
    pick(e);
    const move = (ev) => pick(ev);
    const up = () => {
      wheel.removeEventListener("pointermove", move);
      wheel.removeEventListener("pointerup", up);
    };
    wheel.addEventListener("pointermove", move);
    wheel.addEventListener("pointerup", up);
  });
  const harmonies = el("div", "harmonies");
  for (const [type, label] of [
    ["floating", "One"],
    ["complementary", "Two"],
    ["analogous", "Three"],
    ["triadic", "Triad"],
  ]) {
    const b = Object.assign(el("button"), { textContent: label });
    b.classList.toggle("on", type === harmony);
    b.addEventListener("click", () => {
      harmony = type;
      for (const x of harmonies.children) x.classList.toggle("on", x === b);
      draw(true);
    });
    harmonies.append(b);
  }
  draw(false);

  const nodes = [title, line(iconInput, nameInput), emojis, wheel, harmonies, preview];
  const empty = !space.items.length && !space.today.length;
  const profile = toggle("Own cookies and logins", space.profile, (v) => update({ profile: v }));
  if (!empty) {
    profile.querySelector("input").disabled = true;
    profile.title = "Set while the space has no tabs";
  }
  nodes.push(profile);
  if (state.spaces.length > 1) {
    nodes.push(
      button("Delete space", "danger wide", () => {
        closePopover();
        call("space-remove", spaceId);
      }, "x"),
    );
  }
  openPopover(nodes, anchor);
  if (fresh) nameInput.select();
}

// ---- messages from main ----

api.on("archium:command", ({ id }) => {
  if (id === "new-tab") openCommand("new");
  else if (id === "edit-url") openCommand(activeTabInfo() ? "edit" : "new");
  else if (id === "find") (ui.find ? $("#find-input").focus() : openFind());
  else if (id === "new-space") newSpace();
});

let toastTimer = null;
api.on("archium:toast", ({ text, error }) => {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("error", Boolean(error));
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (ui.popover) closePopover();
  else if (ui.command) closeCommand();
  else if (state?.glance) call("glance-close");
  else if (ui.find) closeFind();
});

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state && render());

// ---- the empty card ----

function tick() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}
tick();
$("#empty-search kbd").textContent = key("⌘T");
