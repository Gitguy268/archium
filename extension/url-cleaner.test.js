import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rules = JSON.parse(readFileSync(new URL("./url-cleaner.json", import.meta.url)));

test("rule ids are unique", () => {
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
});

test("every removed parameter is caught by some rule's filter", () => {
  const tokens = rules.map((r) => r.condition.urlFilter.slice(1));
  for (const rule of rules) {
    for (const param of rule.action.redirect.transform.queryTransform.removeParams) {
      assert.ok(tokens.some((t) => param.startsWith(t)), `${param} has no matching rule`);
    }
  }
});
