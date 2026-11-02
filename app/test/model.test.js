import { test } from "node:test";
import assert from "node:assert/strict";
import { Model, matchesRoute } from "../main/model.js";

const make = () => {
  let t = 1_000_000;
  let n = 0;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const m = new Model(null, { now: clock.now, id: () => `id${++n}` });
  return { m, clock };
};

test("a fresh model has one space and nothing else", () => {
  const { m } = make();
  assert.equal(m.spaces.length, 1);
  assert.equal(m.data.activeSpace, m.spaces[0].id);
  assert.deepEqual(m.allTabIds(), []);
});

test("new tabs go to the top of Today", () => {
  const { m } = make();
  const s = m.spaces[0].id;
  const a = m.newTab(s, "https://a.example");
  const b = m.newTab(s, "https://b.example");
  assert.deepEqual(m.spaces[0].today, [b.id, a.id]);
});

test("place moves a tab between favourites, pinned, folders and Today", () => {
  const { m } = make();
  const s = m.spaces[0].id;
  const a = m.newTab(s, "https://a.example");
  m.place(a.id, { zone: "pinned", spaceId: s });
  assert.equal(m.locate(a.id).zone, "pinned");
  assert.equal(m.tab(a.id).pinnedUrl, "https://a.example");
  const f = m.addFolder(s, "Work");
  m.place(a.id, { zone: "pinned", spaceId: s, folderId: f.id });
  assert.deepEqual(m.locate(a.id), { zone: "pinned", spaceId: s, folderId: f.id, index: 0 });
  m.place(a.id, { zone: "favourites" });
  assert.deepEqual(m.data.favourites, [a.id]);
  assert.equal(f.children.length, 0);
  m.unpin(a.id);
  assert.equal(m.locate(a.id).zone, "today");
  assert.equal(m.tab(a.id).pinnedUrl, undefined);
});

test("closing a Today tab archives it; pinned tabs stay", () => {
  const { m } = make();
  const s = m.spaces[0].id;
  const a = m.newTab(s, "https://a.example", { title: "A" });
  const p = m.newTab(s, "https://p.example");
  m.pin(p.id, s);
  assert.equal(m.closeTab(a.id), true);
  assert.equal(m.tab(a.id), undefined);
  assert.equal(m.data.archive[0].url, "https://a.example");
  assert.equal(m.closeTab(p.id), false);
  assert.ok(m.tab(p.id));
  const back = m.restoreArchived(0, s);
  assert.equal(back.url, "https://a.example");
  assert.equal(m.data.archive.length, 0);
});

test("stale Today tabs are archived, except the ones kept", () => {
  const { m, clock } = make();
  const s = m.spaces[0].id;
  const old = m.newTab(s, "https://old.example");
  const shown = m.newTab(s, "https://shown.example");
  const pinned = m.newTab(s, "https://pinned.example");
  m.pin(pinned.id, s);
  clock.advance(13 * 3600_000);
  const fresh = m.newTab(s, "https://fresh.example");
  const archived = m.archiveStale(12, new Set([shown.id]));
  assert.deepEqual(archived, [old.id]);
  assert.ok(m.tab(shown.id) && m.tab(pinned.id) && m.tab(fresh.id));
  assert.deepEqual(m.archiveStale(0), []);
});

test("removing a folder keeps its tabs pinned where it was", () => {
  const { m } = make();
  const s = m.spaces[0].id;
  const a = m.newTab(s, "https://a.example");
  const b = m.newTab(s, "https://b.example");
  const f = m.addFolder(s, "F", [a.id, b.id]);
  m.removeFolder(s, f.id);
  assert.deepEqual(m.spaces[0].items.map((i) => i.id), [a.id, b.id]);
});

test("split view: up to four, a tab in one group at a time", () => {
  const { m } = make();
  const s = m.spaces[0].id;
  const ids = [1, 2, 3, 4, 5].map((i) => m.newTab(s, `https://${i}.example`).id);
  assert.equal(m.split(ids).length, 4);
  m.split([ids[0], ids[4]]);
  assert.deepEqual(m.splitOf(ids[0]), [ids[0], ids[4]]);
  assert.deepEqual(m.splitOf(ids[1]), [ids[1], ids[2], ids[3]]);
  m.unsplit(ids[4]);
  assert.equal(m.splitOf(ids[0]), null);
  assert.equal(m.split([ids[0]]), null);
});

test("removing a space archives its tabs; the last space stays", () => {
  const { m } = make();
  const first = m.spaces[0].id;
  assert.equal(m.removeSpace(first), false);
  const work = m.addSpace({ name: "Work" });
  m.newTab(work.id, "https://w.example");
  m.data.activeSpace = work.id;
  assert.equal(m.removeSpace(work.id), true);
  assert.equal(m.data.activeSpace, first);
  assert.equal(m.data.archive[0].url, "https://w.example");
});

test("routes send links to their space", () => {
  const { m } = make();
  const work = m.addSpace({ name: "Work" });
  m.addRoute("github.com", work.id);
  m.addRoute("notion.so/team", work.id);
  assert.equal(m.route("https://gist.github.com/x"), work.id);
  assert.equal(m.route("https://notion.so/team/page"), work.id);
  assert.equal(m.route("https://notion.so/other"), null);
  assert.equal(m.route("not a url"), null);
  assert.equal(matchesRoute("*.google.com/maps", new URL("https://www.google.com/maps/x")), true);
  assert.equal(matchesRoute("github.com", new URL("https://notgithub.com")), false);
});
