// session.json: [{ url, pinned }]. Older versions saved plain URL strings.
export function normalizeSession(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => (typeof e === "string" ? { url: e, pinned: false } : e && typeof e.url === "string" ? { url: e.url, pinned: Boolean(e.pinned) } : null))
    .filter((e) => e && /^https?:\/\//.test(e.url));
}
