import { test } from "node:test";
import assert from "node:assert/strict";
import { agentMethods } from "../main/agent.js";
import { Model } from "../main/model.js";

// A hub with one normal window and one private window, each with its own model.
function fakeHub() {
  const model = new Model(null);
  const privateModel = new Model(null);
  privateModel.private = true;
  const s = model.spaces[0].id;
  const open = model.newTab(s, "https://open.example/", { title: "Open" });
  const secret = privateModel.newTab(privateModel.spaces[0].id, "https://secret.example/", { title: "Secret" });
  const normal = { isPrivate: false, model, activeTab: open.id, visibleTabs: () => [open.id], base: { focus() {} } };
  const priv = { isPrivate: true, model: privateModel, activeTab: secret.id };
  const hub = {
    model,
    windows: new Set([normal, priv]),
    views: new Map(),
    settings: { archivebox: { url: "" } },
    stores: { library: { data: { snapshots: [] }, save() {} } },
    mainWindow: () => normal,
    activate(w, id) {
      w.activeTab = id;
    },
    newTab(w, url) {
      return model.newTab(model.spaces[0].id, url);
    },
    switchSpace() {},
    historyIndex: () => [{ url: "https://h.example/", title: "Hello", at: 1, count: 1 }],
  };
  return { hub, open, secret };
}

test("agents see the normal tabs and never the private window's", () => {
  const { hub, open, secret } = fakeHub();
  const m = agentMethods(hub);
  const tabs = m["tabs.list"]({});
  assert.deepEqual(tabs.map((t) => t.id), [open.id]);
  assert.equal(tabs[0].active, true);
  assert.throws(() => m["tabs.focus"]({ id: secret.id }), /no tab/);
  assert.equal(JSON.stringify(m["history.search"]({ query: "hello" })).includes("secret"), false);
});

test("tabs.open takes http(s) only", () => {
  const { hub } = fakeHub();
  const m = agentMethods(hub);
  assert.throws(() => m["tabs.open"]({ url: "file:///etc/passwd" }), /http/);
  assert.throws(() => m["tabs.open"]({ url: "hillium://settings/" }), /http/);
  assert.equal(m["tabs.open"]({ url: "https://new.example/", background: true }).url, "https://new.example/");
});

test("spaces are found by name, case-insensitively", () => {
  const { hub } = fakeHub();
  hub.model.addSpace({ name: "Work" });
  const m = agentMethods(hub);
  assert.equal(m["tabs.list"]({ space: "work" }).length, 0);
  assert.throws(() => m["tabs.list"]({ space: "Nope" }), /no space/);
});
