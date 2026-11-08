import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { startControl, tokenPath, socketPath } from "../main/control.js";
import { request, handleMcp, toolList, userDataDir } from "../../cli/archium.mjs";

const ask = (path, line) =>
  new Promise((resolve, reject) => {
    const s = connect(path);
    let buf = "";
    s.on("connect", () => s.write(`${line}\n`));
    s.on("data", (d) => {
      buf += d;
      if (buf.includes("\n")) {
        s.end();
        resolve(JSON.parse(buf.split("\n")[0]));
      }
    });
    s.on("error", reject);
  });

test("the control socket wants the token, and is private to this user", async () => {
  const dir = mkdtempSync(join(tmpdir(), "archium-"));
  const control = startControl({ userData: dir, methods: { "tabs.list": () => [{ id: "1" }], boom: () => { throw new Error("nope"); } } });
  await new Promise((r) => setTimeout(r, 100));
  try {
    const token = readFileSync(tokenPath(dir), "utf8");
    assert.equal(statSync(tokenPath(dir)).mode & 0o777, 0o600);
    assert.equal(statSync(socketPath(dir)).mode & 0o777, 0o600);
    assert.deepEqual(await ask(socketPath(dir), JSON.stringify({ id: 1, method: "tabs.list" })), { id: 1, error: "unauthorized" });
    assert.deepEqual(await ask(socketPath(dir), JSON.stringify({ id: 2, token: "x".repeat(64), method: "tabs.list" })), { id: 2, error: "unauthorized" });
    assert.deepEqual(await ask(socketPath(dir), JSON.stringify({ id: 3, token, method: "tabs.list" })), { id: 3, result: [{ id: "1" }] });
    assert.deepEqual(await ask(socketPath(dir), JSON.stringify({ id: 4, token, method: "boom" })), { id: 4, error: "nope" });
    // The CLI finds the same folder and token.
    assert.deepEqual(await request("tabs.list", {}, { dir }), [{ id: "1" }]);
  } finally {
    await control.close();
  }
  await assert.rejects(request("tabs.list", {}, { dir }), /isn't running|agent access/);
});

test("the CLI looks where Electron keeps Archium's data", () => {
  assert.equal(userDataDir({ XDG_CONFIG_HOME: "/x" }, "linux"), "/x/Archium");
  assert.equal(userDataDir({ ARCHIUM_USER_DATA: "/y" }, "darwin"), "/y");
  assert.match(userDataDir({}, "darwin"), /Library\/Application Support\/Archium$/);
});

test("MCP: initialize, list tools, call one, report errors as tool errors", async () => {
  const init = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.result.serverInfo.name, "archium");
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const list = await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.ok(list.result.tools.some((t) => t.name === "get_page_text"));
  assert.ok(toolList().every((t) => t.inputSchema.type === "object"));
  const calls = [];
  const fake = async (method, params) => (calls.push([method, params]), method === "page.screenshot" ? { data: "AAA", mimeType: "image/png" } : [{ id: "t" }]);
  const r = await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_tabs", arguments: { space: "Work" } } }, fake);
  assert.deepEqual(calls[0], ["tabs.list", { space: "Work" }]);
  assert.match(r.result.content[0].text, /"t"/);
  const shot = await handleMcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "screenshot" } }, fake);
  assert.equal(shot.result.content[0].type, "image");
  const err = await handleMcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "open_tab", arguments: {} } }, async () => { throw new Error("needs a url"); });
  assert.equal(err.result.isError, true);
  assert.equal((await handleMcp({ jsonrpc: "2.0", id: 6, method: "nope" })).error.code, -32601);
});
