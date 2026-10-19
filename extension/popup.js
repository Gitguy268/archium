import { proxyConfig, withDefaults } from "./lib.js";

const form = document.getElementById("form");
const status = document.getElementById("status");
const fields = ["torPort", "proxyScheme", "proxyHost", "proxyPort", "localSearch", "publicSearch"];

function showRows(mode) {
  for (const row of form.querySelectorAll("[data-for]")) row.hidden = row.dataset.for !== mode;
}

function say(text, isError = false) {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function read() {
  const s = { mode: form.mode.value, blockWebRTC: form.blockWebRTC.checked };
  for (const f of fields) s[f] = form[f].value.trim();
  s.torPort = Number(s.torPort);
  s.proxyPort = Number(s.proxyPort);
  return s;
}

async function load() {
  const s = withDefaults(await chrome.storage.local.get(null));
  form.mode.value = s.mode;
  form.blockWebRTC.checked = s.blockWebRTC;
  for (const f of fields) form[f].value = s[f];
  showRows(s.mode);
  const { error } = await chrome.storage.session.get("error");
  if (error) say(error, true);
}

form.addEventListener("change", async () => {
  const s = read();
  showRows(s.mode);
  // Validate before saving so a half-typed proxy never becomes the active route.
  try {
    proxyConfig(s);
    for (const f of ["localSearch", "publicSearch"]) new URL(s[f]);
  } catch (e) {
    say(e instanceof TypeError ? "Search addresses must be full URLs" : e.message, true);
    return;
  }
  await chrome.storage.local.set(s);
  say("Saved");
});

form.addEventListener("submit", (e) => e.preventDefault());
load();
