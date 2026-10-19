// Everything here is local: no fetches, no remote assets. Favicons come from the browser's cache.
const clock = document.getElementById("clock");
const date = document.getElementById("date");
const list = document.getElementById("links");

function tick() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  clock.dateTime = now.toISOString();
  date.textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}
tick();
setInterval(tick, 1000);

document.getElementById("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = e.target.q.value.trim();
  // Uses the default search engine, so local SearXNG and the Tor redirect apply.
  if (text) chrome.search.query({ text, disposition: "CURRENT_TAB" });
});

function faviconUrl(pageUrl) {
  const u = new URL(chrome.runtime.getURL("/_favicon/"));
  u.searchParams.set("pageUrl", pageUrl);
  u.searchParams.set("size", "32");
  return u.href;
}

async function getLinks() {
  return (await chrome.storage.local.get("links")).links ?? [];
}

async function render() {
  const links = await getLinks();
  list.replaceChildren(
    ...links.map((link, i) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = link.url;
      const img = document.createElement("img");
      img.src = faviconUrl(link.url);
      img.alt = "";
      a.append(img, link.title);
      const remove = document.createElement("button");
      remove.className = "remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${link.title}`);
      remove.addEventListener("click", async () => {
        const next = await getLinks();
        next.splice(i, 1);
        await chrome.storage.local.set({ links: next });
      });
      li.append(a, remove);
      return li;
    }),
  );
}

document.getElementById("add-link").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const url = new URL(form.url.value);
  if (!["http:", "https:"].includes(url.protocol)) return;
  const links = await getLinks();
  links.push({ title: form.title.value.trim(), url: url.href });
  await chrome.storage.local.set({ links });
  form.reset();
});

async function showMode() {
  const { mode = "direct" } = await chrome.storage.local.get("mode");
  const el = document.getElementById("mode");
  el.hidden = mode === "direct";
  el.textContent = mode === "tor" ? "Browsing through Tor" : "Browsing through proxy";
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.links) render();
  if (changes.mode) showMode();
});
render();
showMode();
