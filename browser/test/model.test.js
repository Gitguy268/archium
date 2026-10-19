import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../main/minicpm-v.json", import.meta.url)));

test("the model is the GGUF build of MiniCPM-V 4.7 1B at a pinned revision", () => {
  assert.equal(manifest.repo, "openbmb/MiniCPM-V-4.7-1B-gguf");
  assert.match(manifest.revision, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(manifest.files), ["MiniCPM-V-4_7-1B-Q4_K_M.gguf", "mmproj-model-f16-4x.gguf"]);
});

test("every file's 64 MiB ranges add up to its size and carry a hash", () => {
  for (const [name, f] of Object.entries(manifest.files)) {
    assert.equal(f.chunks.reduce((n, c) => n + c.size, 0), f.totalSize, name);
    for (const c of f.chunks) assert.match(c.sha256, /^[0-9a-f]{64}$/);
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
  }
});

test("both vendored wllama builds know the MiniCPM-V 4.7 architecture", () => {
  for (const wasm of ["wllama.wasm", "wllama-compat.wasm"]) {
    const bytes = readFileSync(new URL(`../ui/vendor/wllama/${wasm}`, import.meta.url));
    assert.ok(bytes.includes("minicpmv4_7"), wasm);
  }
});
