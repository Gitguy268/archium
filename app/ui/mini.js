// Little Archium's bar: the address, back, copy and "Open in Archium".
import { toUrl } from "./shared/omni.js";

const api = window.archium;
const $ = (s) => document.querySelector(s);
if (api.platform === "darwin") document.body.classList.add("mac");

api.on("archium:mini-state", (s) => {
  if (s.glassLights !== undefined) document.body.classList.toggle("glass", s.glassLights);
  if (s.focused !== undefined) $(".glass-lights").classList.toggle("is-blurred", !s.focused);
  if (s.fullscreen !== undefined) document.body.classList.toggle("fullscreen", s.fullscreen);
  if (s.url !== undefined && document.activeElement !== $("#url")) $("#url").value = s.url === "about:blank" ? "" : s.url;
  if (s.title) document.title = `${s.title} – Little Archium`;
  if (s.url === "about:blank" || s.url === "") $("#url").focus();
});

$("#address").addEventListener("submit", (e) => {
  e.preventDefault();
  const url = toUrl($("#url").value);
  if (url) api.invoke("archium:mini-nav", { load: url });
});
$("#back").addEventListener("click", () => api.invoke("archium:mini-nav", "back"));
$("#copy").addEventListener("click", () => api.invoke("archium:mini-copy"));
$("#move").addEventListener("click", () => api.invoke("archium:mini-move"));
$("#close").addEventListener("click", () => api.invoke("archium:mini-close"));
for (const b of document.querySelectorAll(".glass-lights [data-window]"))
  b.addEventListener("click", (e) => {
    const action = b.dataset.window;
    if (action === "close") api.invoke("archium:mini-close");
    else api.invoke("archium:mini-window", action === "maximize" && !e.altKey ? "fullscreen" : action);
  });
