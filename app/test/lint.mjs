// Lint without dependencies: every script parses, every JSON file parses, and no debug
// logging is left in the app (the CLI and tests print on purpose).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SKIP = new Set(["node_modules", "dist", ".git", "screenshots"]);
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
};
walk(join(ROOT, "app"));
walk(join(ROOT, "cli"));

const problems = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const ext = extname(file);
  if ([".js", ".mjs", ".cjs"].includes(ext)) {
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch (e) {
      problems.push(`${rel}: ${String(e.stderr).split("\n").slice(0, 5).join(" ")}`);
    }
    const app = rel.startsWith("app/main") || rel.startsWith("app/ui") || rel.startsWith("app/preload");
    if (app && /console\.log\(/.test(readFileSync(file, "utf8"))) problems.push(`${rel}: console.log left in`);
  }
  if (ext === ".json" && !rel.endsWith("package-lock.json")) {
    try {
      JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      problems.push(`${rel}: ${e.message}`);
    }
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`lint: ${files.length} files OK`);
