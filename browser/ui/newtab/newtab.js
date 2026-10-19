// The new tab page. Everything is local: no remote assets and no favicons fetched from
// the sites themselves; links get letter tiles. It reads its look and quick links from
// archium://newtab/state.json, which only this page can change.
import { paintClouds, paintAurora } from "/shared/wallpaper.js";
import { glass } from "/shared/glass.js";

const $ = (id) => document.getElementById(id);
let state = { theme: "normal", links: [], mode: "direct", localSearch: "http://127.0.0.1:8888" };

function tick() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("clock").dateTime = now.toISOString();
  $("date").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

function toUrl(text) {
  if (/^https?:\/\//i.test(text)) return text;
  if (!/\s/.test(text) && /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) return `https://${text}`;
  return `${state.localSearch.replace(/\/$/, "")}/search?q=${encodeURIComponent(text)}`;
}

$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("q").value.trim();
  if (text) location.href = toUrl(text);
});

async function saveLinks(links) {
  const res = await fetch("/links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(links) });
  state.links = (await res.json()).links;
  renderLinks();
}

function hue(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

function renderLinks() {
  $("links").replaceChildren(
    ...state.links.map((link, i) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = link.url;
      a.className = "link";
      const tile = document.createElement("span");
      tile.className = "tile";
      tile.textContent = (link.title.trim()[0] ?? "?").toUpperCase();
      tile.style.setProperty("--h", hue(new URL(link.url).host));
      const name = document.createElement("span");
      name.className = "link-name";
      name.textContent = link.title;
      a.append(tile, name);
      const remove = document.createElement("button");
      remove.className = "remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${link.title}`);
      remove.addEventListener("click", () => saveLinks(state.links.filter((_, j) => j !== i)));
      li.append(a, remove);
      return li;
    }),
  );
  if (state.theme === "glass") glass(document.querySelectorAll(".link"), { radius: 18 });
}

$("add-link").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const url = new URL(form.url.value);
  if (!["http:", "https:"].includes(url.protocol)) return;
  saveLinks([...state.links, { title: form.title.value.trim(), url: url.href }]);
  form.reset();
  form.closest("details").open = false;
});

function paint() {
  const canvas = $("wallpaper");
  if (state.theme === "win98") paintClouds(canvas);
  else if (state.theme === "glass") paintAurora(canvas, matchMedia("(prefers-color-scheme: dark)").matches);
}

async function start() {
  try {
    state = await (await fetch("/state.json")).json();
  } catch {
    // Defaults: still a working page.
  }
  document.body.dataset.theme = state.theme;
  const mode = $("mode");
  mode.hidden = state.mode === "direct";
  mode.textContent = state.mode === "tor" ? "Browsing through Tor" : "Browsing through a proxy";
  tick();
  setInterval(tick, 1000);
  paint();
  addEventListener("resize", paint);
  renderLinks();
  if (state.theme === "glass") {
    glass([$("clock-card")], { radius: 28 });
    glass([$("search")], { shape: "pill" });
  }
}
start();
