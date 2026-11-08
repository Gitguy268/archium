// README pictures: a clean demo profile with real sites, one picture per look, and an
// animated demo (command bar → another space → Glance → split view). Needs the network.
//   PLAYWRIGHT=/path/to/node_modules/playwright node test/shots.mjs
// Writes docs/img/*.png and docs/img/demo.gif (ffmpeg makes the GIF).
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { composeWindow } from "./compose.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const OUT = join(APP, "../docs/img");
const { _electron } = require(process.env.PLAYWRIGHT ?? "playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), "archium-shots-"));
writeFileSync(join(userData, "settings.json"), JSON.stringify({ sidebarWidth: 260 }));
const app = await _electron.launch({
  executablePath: require("electron"),
  args: [APP],
  env: { ...process.env, ARCHIUM_TEST: "1", ARCHIUM_USER_DATA: userData, ARCHIUM_WAIT_ADBLOCK: "1" },
});
await app.firstWindow();
await sleep(1500);
const main = (fn, arg) => app.evaluate(fn, arg);
const ui = app.windows().find((p) => p.url().startsWith("archium://chrome"));

// The demo profile: three spaces, favourites, a folder of pinned tabs and some Today tabs.
await main(async () => {
  const hub = globalThis.__archium;
  const w = [...hub.windows][0];
  w.base.setContentSize(1440, 900);
  const m = w.model;
  const personal = m.spaces[0];
  m.updateSpace(personal.id, { name: "Personal", icon: "✦", colors: [[124, 108, 242], [236, 120, 178]] });
  const work = m.addSpace({ name: "Work", icon: "💼", colors: [[46, 170, 140], [52, 120, 220]] });
  const reading = m.addSpace({ name: "Reading", icon: "📚", colors: [[240, 150, 70], [230, 90, 110]] });
  const add = (space, url, title) => m.newTab(space.id, url, { title, select: false });
  for (const [url, title] of [
    ["https://archlinux.org/", "Arch Linux"],
    ["https://github.com/", "GitHub"],
    ["https://en.wikipedia.org/wiki/Main_Page", "Wikipedia"],
    ["https://www.openstreetmap.org/", "OpenStreetMap"],
  ]) m.place(add(personal, url, title).id, { zone: "favourites" });
  const folder = m.addFolder(personal.id, "Browsers");
  for (const [url, title] of [
    ["https://github.com/zen-browser/desktop", "zen-browser/desktop"],
    ["https://github.com/imputnet/helium", "imputnet/helium"],
  ]) m.place(add(personal, url, title).id, { zone: "pinned", spaceId: personal.id, folderId: folder.id });
  m.place(add(personal, "https://wiki.archlinux.org/title/Installation_guide", "Installation guide - ArchWiki").id, { zone: "pinned", spaceId: personal.id });
  add(personal, "https://en.wikipedia.org/wiki/Helium", "Helium - Wikipedia");
  add(personal, "https://en.wikipedia.org/wiki/Liquid", "Liquid - Wikipedia");
  m.place(add(work, "https://github.com/electron/electron", "electron/electron").id, { zone: "pinned", spaceId: work.id });
  add(work, "https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter", "backdrop-filter - MDN");
  add(work, "https://www.electronjs.org/docs/latest/api/web-contents-view", "WebContentsView | Electron");
  add(reading, "https://news.ycombinator.com/", "Hacker News");
  add(reading, "https://en.wikipedia.org/wiki/Windows_98", "Windows 98 - Wikipedia");
  const liquid = m.space(personal.id).today.find((id) => m.tab(id).url.includes("Liquid"));
  hub.switchSpace(w, personal.id);
  hub.activate(w, liquid);
});
await sleep(6000);

const shot = async (name) => {
  await sleep(700);
  writeFileSync(join(OUT, `${name}.png`), await composeWindow(app));
};
await shot("arc");
for (const look of ["zen", "glass", "retro"]) {
  await main((_, l) => globalThis.__archium.saveSettings({ look: l }), look);
  await shot(`look-${look}`);
}
await main(() => globalThis.__archium.saveSettings({ look: "arc" }));
await sleep(800);

// The animated demo: frames composed from capturePage, joined by ffmpeg.
const frames = mkdtempSync(join(tmpdir(), "archium-frames-"));
let n = 0;
const frame = async (repeat = 1) => {
  const png = await composeWindow(app);
  for (let i = 0; i < repeat; i++) writeFileSync(join(frames, `f${String(n++).padStart(4, "0")}.png`), png);
};
await frame(6);
await main(() => [...globalThis.__archium.windows][0].send("archium:command", { id: "new-tab" }));
await sleep(600);
await frame(3);
for (const ch of "electron") {
  await ui.keyboard.type(ch);
  await sleep(120);
  await frame(1);
}
await frame(5);
await ui.keyboard.press("Enter");
await sleep(2500);
await frame(6);
await main(() => {
  const hub = globalThis.__archium;
  const w = [...hub.windows][0];
  hub.openGlance(w, "https://www.electronjs.org/docs/latest/api/base-window");
});
await sleep(3500);
await frame(8);
await main(() => {
  const hub = globalThis.__archium;
  const w = [...hub.windows][0];
  hub.expandGlance(w, { split: true });
});
await sleep(3500);
await frame(10);

execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-framerate", "4", "-i", join(frames, "f%04d.png"),
  "-vf", "scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192[p];[b][p]paletteuse=dither=sierra2_4a",
  join(OUT, "demo.gif"),
]);
rmSync(frames, { recursive: true, force: true });
await app.close();
console.log(`wrote ${OUT}`);
