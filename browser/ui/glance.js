// Glance's header. The page itself is a separate view that main places under it.
const api = window.archium;
const $ = (id) => document.getElementById(id);
let state = { url: "" };

api.on("state", (s) => {
  state = s;
  document.body.dataset.theme = s.settings.theme;
  document.body.toggleAttribute("data-page", Boolean(s.url));
  $("empty").hidden = Boolean(s.url);
  if (document.activeElement !== $("address")) $("address").value = s.url;
  $("pin").setAttribute("aria-pressed", String(s.pinned));
  $("open").disabled = !s.url;
  $("back").disabled = !s.url;
  document.title = s.title || "Glance";
});

api.on("command", (cmd) => {
  if (cmd === "focus-address") {
    $("address").focus();
    $("address").select();
  }
});

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("address").value.trim();
  if (text) api.send("navigate", text);
});
$("back").addEventListener("click", () => api.send("back"));
$("pin").addEventListener("click", () => api.send("pin", !state.pinned));
$("open").addEventListener("click", () => api.send("open-in-tab"));
$("hide").addEventListener("click", () => api.send("hide"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") api.send("hide");
});

new ResizeObserver(() => api.send("header", Math.ceil($("head").getBoundingClientRect().bottom + 6))).observe($("head"));
api.send("ready");
