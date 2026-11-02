// The local control channel for the `hillium` CLI and AI agents (`hillium mcp`).
// Off until you turn on "Allow the CLI and AI agents" in Settings. It's a Unix socket in
// userData, readable only by you (0600), and every request carries a token from a 0600 file
// next to it. There's no TCP port, so web pages (and DNS rebinding) can't reach it.
// Private windows never show up here.
import { createServer } from "node:net";
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

export const socketPath = (userData) => (process.platform === "win32" ? "\\\\.\\pipe\\hillium-control" : join(userData, "control.sock"));
export const tokenPath = (userData) => join(userData, "control.token");

export function loadToken(userData) {
  const path = tokenPath(userData);
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, token, { mode: 0o600 });
  return token;
}

const same = (a, b) => {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
};

// methods: { name: async (params) => result }. One JSON object per line, both ways.
export function startControl({ userData, methods, log = () => {} }) {
  const token = loadToken(userData);
  const path = socketPath(userData);
  if (process.platform !== "win32" && existsSync(path)) unlinkSync(path);
  const server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", async (chunk) => {
      buffer += chunk;
      if (buffer.length > 1_000_000) return socket.destroy();
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        let req;
        try {
          req = JSON.parse(line);
        } catch {
          socket.write(`${JSON.stringify({ id: null, error: "bad json" })}\n`);
          continue;
        }
        const reply = (body) => !socket.destroyed && socket.write(`${JSON.stringify({ id: req.id ?? null, ...body })}\n`);
        if (!same(req.token, token)) {
          reply({ error: "unauthorized" });
          socket.end();
          return;
        }
        const method = methods[req.method];
        if (!method) {
          reply({ error: `unknown method ${req.method}` });
          continue;
        }
        try {
          reply({ result: (await method(req.params ?? {})) ?? null });
        } catch (e) {
          log(`[hillium] control ${req.method}: ${e.message}`);
          reply({ error: e.message });
        }
      }
    });
    socket.on("error", () => {});
  });
  server.listen(path, () => {
    if (process.platform !== "win32") chmodSync(path, 0o600);
  });
  return {
    path,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        if (process.platform !== "win32" && existsSync(path)) unlinkSync(path);
      }),
  };
}
