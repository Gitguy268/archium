// Little Hillium's bar: the address, back, copy and "Open in Hillium".
import { toUrl } from "./shared/omni.js";

const api = window.hillium;
const $ = (s) => document.querySelector(s);
if (api.platform === "darwin") document.body.classList.add("mac");

api.on("hillium:mini-state", (s) => {
  if (s.url !== undefined && document.activeElement !== $("#url")) $("#url").value = s.url === "about:blank" ? "" : s.url;
  if (s.title) document.title = `${s.title} – Little Hillium`;
  if (s.url === "about:blank" || s.url === "") $("#url").focus();
});

$("#address").addEventListener("submit", (e) => {
  e.preventDefault();
  const url = toUrl($("#url").value);
  if (url) api.invoke("hillium:mini-nav", { load: url });
});
$("#back").addEventListener("click", () => api.invoke("hillium:mini-nav", "back"));
$("#copy").addEventListener("click", () => api.invoke("hillium:mini-copy"));
$("#move").addEventListener("click", () => api.invoke("hillium:mini-move"));
$("#close").addEventListener("click", () => api.invoke("hillium:mini-close"));
