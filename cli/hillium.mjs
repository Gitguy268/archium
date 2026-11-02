#!/usr/bin/env node
// hillium: drive a running Hillium from a terminal or an AI agent (the CLI-Anything idea:
// every command has --json output). `hillium mcp` is a Model Context Protocol server on
// stdio for Claude, Cursor and other MCP clients. Both talk to Hillium over its control
// socket, which is off until you turn on Settings › Agents › "Allow the CLI and AI agents".
// Needs nothing but Node 20 (or Hillium's own binary with ELECTRON_RUN_AS_NODE=1).
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const VERSION = "0.1.0";

export function userDataDir(env = process.env, platform = process.platform) {
  if (env.HILLIUM_USER_DATA) return env.HILLIUM_USER_DATA;
  if (platform === "darwin") return join(homedir(), "Library/Application Support/Hillium");
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData/Roaming"), "Hillium");
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Hillium");
}

// One request over the socket; resolves with the result or rejects with the error text.
export function request(method, params = {}, { dir = userDataDir() } = {}) {
  let token;
  try {
    token = readFileSync(join(dir, "control.token"), "utf8").trim();
  } catch {
    return Promise.reject(new Error("Hillium's agent access is off. Turn it on in Settings › Agents (and keep Hillium running)."));
  }
  const path = process.platform === "win32" ? "\\\\.\\pipe\\hillium-control" : join(dir, "control.sock");
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ id: 1, token, method, params })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const nl = buffer.indexOf("\n");
      if (nl < 0) return;
      socket.end();
      const reply = JSON.parse(buffer.slice(0, nl));
      reply.error ? reject(new Error(reply.error)) : resolve(reply.result);
    });
    socket.on("error", (e) =>
      reject(new Error(e.code === "ENOENT" || e.code === "ECONNREFUSED" ? "Hillium isn't running, or agent access is off (Settings › Agents)." : e.message)),
    );
  });
}

// ---- MCP over stdio (JSON-RPC 2.0, one message per line) ----

const TOOLS = [
  { name: "list_spaces", method: "spaces.list", description: "List Hillium's spaces (like Arc spaces) with their tab counts.", props: {} },
  { name: "list_tabs", method: "tabs.list", description: "List open, pinned and favourite tabs: id, title, url, space, whether it's loaded and active.", props: { space: { type: "string", description: "Only this space (name or id)" } } },
  { name: "open_tab", method: "tabs.open", description: "Open a web address in a new tab.", props: { url: { type: "string" }, space: { type: "string" }, background: { type: "boolean" } }, required: ["url"] },
  { name: "focus_tab", method: "tabs.focus", description: "Switch to a tab.", props: { id: { type: "string" } }, required: ["id"] },
  { name: "close_tab", method: "tabs.close", description: "Close a tab (pinned tabs are only unloaded).", props: { id: { type: "string" } }, required: ["id"] },
  { name: "navigate", method: "page.navigate", description: "Load an address in a tab (default: the active tab).", props: { id: { type: "string" }, url: { type: "string" } }, required: ["url"] },
  { name: "get_page_text", method: "page.text", description: "The title, address and visible text of a page (default: the active tab).", props: { id: { type: "string" } } },
  { name: "get_page_links", method: "page.links", description: "The links on a page, with their text.", props: { id: { type: "string" } } },
  { name: "click", method: "page.click", description: "Click the first element matching a CSS selector.", props: { id: { type: "string" }, selector: { type: "string" } }, required: ["selector"] },
  { name: "type_text", method: "page.type", description: "Type into the element matching a CSS selector; submit presses Enter / submits its form.", props: { id: { type: "string" }, selector: { type: "string" }, text: { type: "string" }, submit: { type: "boolean" } }, required: ["selector", "text"] },
  { name: "screenshot", method: "page.screenshot", description: "A PNG screenshot of a tab.", props: { id: { type: "string" } } },
  { name: "search_history", method: "history.search", description: "Search browsing history.", props: { query: { type: "string" }, limit: { type: "number" } } },
  { name: "archive_page", method: "archive.add", description: "Save a page to the user's ArchiveBox.", props: { id: { type: "string" }, url: { type: "string" } } },
];

export function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: { type: "object", properties: t.props, ...(t.required ? { required: t.required } : {}) },
  }));
}

export async function handleMcp(msg, send = request) {
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  if (msg.id === undefined) return null; // notifications need no answer
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "hillium", version: VERSION },
        instructions: "Controls the user's Hillium browser. Private windows are never visible. Ask before closing tabs.",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: toolList() });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, `unknown tool ${msg.params?.name}`);
      try {
        const result = await send(tool.method, msg.params.arguments ?? {});
        if (tool.name === "screenshot") return reply({ content: [{ type: "image", data: result.data, mimeType: result.mimeType }] });
        return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: e.message }], isError: true });
      }
    }
    default:
      return fail(-32601, `method not found: ${msg.method}`);
  }
}

function serveMcp() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`);
        continue;
      }
      const out = await handleMcp(msg);
      if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
    }
  });
}

// ---- the command line ----

const HELP = `hillium ${VERSION}: drive a running Hillium

  hillium spaces                      list spaces
  hillium tabs [--space NAME]         list tabs
  hillium open URL [--space NAME] [--background]
  hillium focus ID | close ID
  hillium text [ID]                   the page's text
  hillium links [ID]                  the page's links
  hillium history [QUERY]
  hillium archive [URL]               save to your ArchiveBox
  hillium import arc|zen|chrome|brave|helium|vivaldi [--today]
  hillium mcp                         MCP server on stdio, for AI agents

  --json   machine-readable output
Needs Settings › Agents › "Allow the CLI and AI agents" in Hillium.`;

function parse(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json" || a === "--background" || a === "--today") flags[a.slice(2)] = true;
    else if (a === "--space") flags.space = argv[++i];
    else if (a === "-h" || a === "--help") flags.help = true;
    else rest.push(a);
  }
  return { flags, rest };
}

function print(result, json) {
  if (json) return console.log(JSON.stringify(result, null, 2));
  if (Array.isArray(result)) {
    for (const r of result) {
      if (r.href) console.log(`${r.text || "(no text)"}\t${r.href}`);
      else if (r.url && r.id) console.log(`${r.active ? "*" : " "} ${r.id.slice(0, 8)}  ${(r.space ?? "★").padEnd(12).slice(0, 12)}  ${r.title.slice(0, 50).padEnd(50)}  ${r.url}`);
      else if (r.url) console.log(`${r.title || ""}\t${r.url}`);
      else if (r.name) console.log(`${r.icon} ${r.name} (${r.tabs} tabs)  ${r.id}`);
      else console.log(r);
    }
    return;
  }
  if (result?.text !== undefined && result?.title !== undefined) return console.log(`${result.title}\n${result.url}\n\n${result.text}`);
  console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
}

// Tab ids are UUIDs; the CLI shows the first 8 characters and accepts them back.
async function fullId(prefix) {
  if (!prefix || prefix.length >= 36) return prefix;
  const tabs = await request("tabs.list");
  const hits = tabs.filter((t) => t.id.startsWith(prefix));
  if (hits.length !== 1) throw new Error(hits.length ? `${prefix} matches more than one tab` : `no tab ${prefix}`);
  return hits[0].id;
}

export async function main(argv = process.argv.slice(2)) {
  const { flags, rest } = parse(argv);
  const [cmd, ...args] = rest;
  if (!cmd || flags.help) return console.log(HELP);
  if (cmd === "mcp") return serveMcp();
  if (cmd === "--version" || cmd === "version") return console.log(VERSION);
  const run = {
    spaces: () => request("spaces.list"),
    tabs: () => request("tabs.list", { space: flags.space }),
    open: () => request("tabs.open", { url: args[0], space: flags.space, background: Boolean(flags.background) }),
    focus: async () => request("tabs.focus", { id: await fullId(args[0]) }),
    close: async () => request("tabs.close", { id: await fullId(args[0]) }),
    text: async () => request("page.text", { id: await fullId(args[0]) }),
    links: async () => request("page.links", { id: await fullId(args[0]) }),
    history: () => request("history.search", { query: args.join(" "), limit: 50 }),
    archive: () => request("archive.add", args[0] ? { url: args[0] } : {}),
    import: () => request("import.run", { source: args[0], includeToday: Boolean(flags.today) }),
  }[cmd];
  if (!run) {
    console.error(`unknown command ${cmd}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  try {
    print(await run(), flags.json);
  } catch (e) {
    console.error(`hillium: ${e.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("hillium.mjs")) main();
