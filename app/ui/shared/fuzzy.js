// Fuzzy matching for the command bar's tab search (the idea of alfred-browser-tabs, MIT):
// every query character must appear in order. Matches at word starts (including camelCase
// humps, so "gh" finds GitHub), in a row and early in the text score higher.
// Returns null for no match.
const SEPARATOR = /[\s/.\-_:|·]/;

const isBoundary = (text, i) => i === 0 || SEPARATOR.test(text[i - 1]) || (/[A-Z]/.test(text[i]) && /[a-z]/.test(text[i - 1]));

export function fuzzyScore(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  const original = String(text ?? "");
  const t = original.toLowerCase();
  if (!q) return 0;
  if (!t) return null;
  const direct = t.indexOf(q);
  if (direct >= 0) return 600 - Math.min(direct, 200) + (isBoundary(original, direct) ? 400 : 0) + q.length * 10;
  let score = 0;
  let ti = 0;
  let run = 0;
  let allBoundaries = true;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const boundary = isBoundary(original, found);
    allBoundaries &&= boundary;
    run = found === ti ? run + 1 : 0;
    score += 10 + (boundary ? 15 : 0) + run * 5 - Math.min(10, found - ti);
    ti = found + 1;
  }
  // Initials ("gh" → GitHub, "hn" → Hacker News) rank like a word-start match.
  return score + (allBoundaries && q.replace(/ /g, "").length > 1 ? 700 : 0);
}

// Ranks items by the best score over their fields. fields: (item) → [text, weight][]
export function rank(query, items, fields, limit = 8) {
  const q = query.trim();
  const scored = [];
  for (const item of items) {
    let best = null;
    for (const [text, weight = 1] of fields(item)) {
      const s = fuzzyScore(q, text);
      if (s !== null && (best === null || s * weight > best)) best = s * weight;
    }
    if (best !== null) scored.push({ item, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
