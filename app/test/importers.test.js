import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArc, parseZen, parseChromiumBookmarks, applyImport, readSource } from "../main/importers/index.js";
import { decodeMozLz4, decodeLz4Block } from "../main/importers/mozlz4.js";
import { Model } from "../main/model.js";

// A synthetic Arc sidebar in Arc's own shape: [id, item, id, item, …].
const arc = {
  sidebar: {
    containers: [
      { global: {} },
      {
        spaces: ["s1", { id: "s1", title: "Work", customInfo: { iconType: { emoji_v2: "💼" }, windowTheme: { primaryColorPalette: { midTone: { red: 0.5, green: 0.25, blue: 1 } } } }, containerIDs: ["unpinned", "u1", "pinned", "p1"] }],
        topAppsContainerIDs: [{ default: true }, "top"],
        items: [
          "top", { id: "top", childrenIds: ["fav"], data: { itemContainer: {} } },
          "fav", { id: "fav", title: "Mail", data: { tab: { savedURL: "https://mail.example/", savedTitle: "Mail" } } },
          "p1", { id: "p1", childrenIds: ["folder", "docs"], data: { itemContainer: {} } },
          "folder", { id: "folder", title: "Projects", childrenIds: ["proj", "inner", "split"], data: { list: {} } },
          "proj", { id: "proj", title: null, data: { tab: { savedURL: "https://proj.example/", savedTitle: "Proj" } } },
          "inner", { id: "inner", title: "Old", childrenIds: ["old"], data: { list: {} } },
          "old", { id: "old", title: "Old one", data: { tab: { savedURL: "https://old.example/" } } },
          "split", { id: "split", childrenIds: ["s-a"], data: { splitView: {} } },
          "s-a", { id: "s-a", title: "Split A", data: { tab: { savedURL: "https://a.example/" } } },
          "docs", { id: "docs", title: "Docs", data: { tab: { savedURL: "https://docs.example/" } } },
          "u1", { id: "u1", childrenIds: ["today"], data: { itemContainer: {} } },
          "today", { id: "today", title: "News", data: { tab: { savedURL: "https://news.example/" } } },
        ],
      },
    ],
  },
};

test("Arc: spaces, folders (nested ones flattened), favourites and Today", () => {
  const r = parseArc(arc);
  assert.equal(r.spaces.length, 1);
  const s = r.spaces[0];
  assert.equal(s.name, "Work");
  assert.equal(s.icon, "💼");
  assert.deepEqual(s.colors, [[128, 64, 255]]);
  assert.deepEqual(s.pinned.map((e) => e.folder ?? e.title), ["Projects", "Projects › Old", "Docs"]);
  assert.deepEqual(s.pinned[0].children.map((t) => t.url), ["https://proj.example/", "https://a.example/"]);
  assert.deepEqual(s.today.map((t) => t.url), ["https://news.example/"]);
  assert.deepEqual(r.favourites, [{ title: "Mail", url: "https://mail.example/" }]);
});

// The LZ4 block format with literals only: valid input for the decoder.
function lz4Literals(bytes) {
  const out = [];
  let n = bytes.length;
  if (n >= 15) {
    out.push(0xf0);
    n -= 15;
    while (n >= 255) {
      out.push(255);
      n -= 255;
    }
    out.push(n);
  } else out.push(n << 4);
  return Uint8Array.from([...out, ...bytes]);
}

function mozLz4(json) {
  const body = new TextEncoder().encode(JSON.stringify(json));
  const size = body.length;
  return Uint8Array.from([...new TextEncoder().encode("mozLz40\0"), size & 255, (size >> 8) & 255, (size >> 16) & 255, size >>> 24, ...lz4Literals(body)]);
}

test("LZ4: back-references copy from the output", () => {
  // "abcabcabc": 3 literals, then a match of length 6 at offset 3.
  const block = Uint8Array.from([(3 << 4) | 2, 97, 98, 99, 3, 0]);
  assert.equal(new TextDecoder().decode(decodeLz4Block(block, 9)), "abcabcabc");
  assert.throws(() => decodeMozLz4(new Uint8Array(20)));
});

test("Zen: spaces, pinned tabs in folders and essentials", () => {
  const data = {
    spaces: [{ uuid: "{w}", name: "Home", icon: "🏠", theme: { gradientColors: [{ c: [10, 20, 30] }] } }],
    folders: [{ id: "f1", name: "Reading", workspaceId: "{w}" }],
    tabs: [
      { zenWorkspace: "{w}", pinned: true, groupId: "f1", index: 1, entries: [{ url: "https://read.example/", title: "Read" }] },
      { zenWorkspace: "{w}", pinned: true, index: 2, entries: [{ url: "https://x.example/1" }, { url: "https://x.example/2", title: "X" }] },
      { zenWorkspace: "{w}", pinned: false, index: 1, entries: [{ url: "https://open.example/" }] },
      { zenWorkspace: "{w}", zenEssential: true, pinned: true, index: 1, entries: [{ url: "https://ess.example/", title: "E" }] },
      { zenWorkspace: "{w}", pinned: true, index: 1, entries: [{ url: "about:blank" }] },
    ],
  };
  const r = parseZen(JSON.parse(decodeMozLz4(mozLz4(data))));
  const s = r.spaces[0];
  assert.equal(s.icon, "🏠");
  assert.deepEqual(s.colors, [[10, 20, 30]]);
  assert.deepEqual(s.pinned, [{ folder: "Reading", children: [{ title: "Read", url: "https://read.example/" }] }, { title: "X", url: "https://x.example/2" }]);
  assert.deepEqual(s.today.map((t) => t.url), ["https://open.example/"]);
  assert.deepEqual(r.favourites.map((t) => t.url), ["https://ess.example/"]);
});

test("Chromium bookmarks become folders in one space", () => {
  const r = parseChromiumBookmarks(
    {
      roots: {
        bookmark_bar: { name: "Bookmarks bar", children: [{ type: "url", name: "A", url: "https://a.example/" }, { type: "folder", name: "Dev", children: [{ type: "url", name: "B", url: "https://b.example/" }, { type: "url", name: "JS", url: "javascript:alert(1)" }] }] },
        other: { name: "Other", children: [] },
      },
    },
    "Brave",
  );
  assert.equal(r.spaces[0].name, "Brave");
  assert.deepEqual(r.spaces[0].pinned.map((f) => [f.folder, f.children.length]), [["Bookmarks bar", 1], ["Bookmarks bar › Dev", 1]]);
});

test("importing merges spaces by name and skips addresses already there", () => {
  const m = new Model(null);
  const work = m.addSpace({ name: "Work" });
  const t = m.newTab(work.id, "https://docs.example/");
  m.pin(t.id, work.id);
  const first = applyImport(m, parseArc(arc), { includeToday: true });
  assert.equal(first.added, 5);
  assert.equal(m.spaces.length, 2);
  assert.equal(m.data.favourites.length, 1);
  assert.equal(applyImport(m, parseArc(arc), { includeToday: true }).added, 0);
});

const realArc = join(homedir(), "Library/Application Support/Arc/StorableSidebar.json");
test("reads this computer's Arc sidebar without changing it", { skip: !existsSync(realArc) }, async () => {
  const r = await readSource("arc");
  assert.ok(Array.isArray(r.spaces) && r.spaces.length >= 1);
});
