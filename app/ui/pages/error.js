// hillium://error?code=&desc=&url=&https=1
import { api, $ } from "./api.js";

const q = new URLSearchParams(location.search);
const url = q.get("url") ?? "";
const code = Number(q.get("code"));
const upgraded = q.get("https") === "1";
let host = "";
try {
  host = new URL(url).hostname;
} catch {}

const MESSAGES = {
  "-105": `${host || "This site"} couldn't be found. Check the address, or your connection.`,
  "-106": "You're offline.",
  "-102": `${host || "The site"} refused the connection.`,
  "-118": `${host || "The site"} took too long to answer.`,
  "-109": `${host || "The site"} can't be reached.`,
  "-137": "Secure DNS couldn't find the site. Your network may block it; you can pick another provider in Settings.",
  "-20": "Hillium blocked this page.",
};

document.title = host ? `${host} – can't open` : "Can't open this page";
if (upgraded) {
  $("#title").textContent = `${host} doesn't do HTTPS`;
  $("#detail").textContent = "Hillium tried the secure address first and it didn't answer. On http, others on your network can see and change what you send and get.";
  $("#http").hidden = false;
} else {
  $("#detail").textContent = MESSAGES[String(code)] ?? q.get("desc") ?? "Something went wrong loading the page.";
}
$("#code").textContent = `${q.get("desc") || "Error"}${code ? ` (${code})` : ""} · ${url}`;

$("#retry").addEventListener("click", () => location.replace(url));
$("#http").addEventListener("click", async () => {
  await api("error.allowHttp", { host });
  location.replace(url.replace(/^https:/, "http:"));
});
