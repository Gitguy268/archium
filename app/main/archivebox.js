// "Archive this page": sends the address to your own ArchiveBox through its REST API
// (ArchiveBox 0.8+, an API key from its admin page). Nothing is sent until you set a URL.

export function normalizeBase(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("ArchiveBox needs an http(s) address");
  return u.origin + u.pathname.replace(/\/+$/, "");
}

const headers = (token) => ({ "content-type": "application/json", accept: "application/json", "X-ArchiveBox-API-Key": token });

// fetchImpl is Electron's session fetch in the app and a stub in the tests.
export async function archive(config, pageUrl, { fetchImpl = fetch, tag = "hillium" } = {}) {
  if (!config?.url) throw new Error("Set your ArchiveBox address in Settings first");
  if (!/^https?:/.test(pageUrl)) throw new Error("Only web pages can be archived");
  const base = normalizeBase(config.url);
  const res = await fetchImpl(`${base}/api/v1/cli/add`, {
    method: "POST",
    headers: headers(config.token ?? ""),
    body: JSON.stringify({ urls: [pageUrl], tag, depth: 0, update: false, parser: "auto" }),
  });
  if (res.status === 401 || res.status === 403) throw new Error("ArchiveBox refused the API key");
  if (!res.ok) throw new Error(`ArchiveBox answered ${res.status}`);
  const data = await res.json().catch(() => ({}));
  // ArchiveBox answers { succeeded: false, message } (older versions: success) when adding fails.
  if (data?.succeeded === false || data?.success === false) throw new Error(data.message || "ArchiveBox couldn't add the page");
  return { url: pageUrl, at: Date.now(), link: `${base}/admin/core/snapshot/?q=${encodeURIComponent(pageUrl)}` };
}

// The snapshots ArchiveBox has for a page (newest first), for the Library.
export async function snapshots(config, pageUrl, { fetchImpl = fetch } = {}) {
  const base = normalizeBase(config.url);
  const q = new URLSearchParams({ url: pageUrl, limit: "20" });
  const res = await fetchImpl(`${base}/api/v1/core/snapshots?${q}`, { headers: headers(config.token ?? "") });
  if (!res.ok) throw new Error(`ArchiveBox answered ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data) ? data : data.items ?? [];
  return items.map((s) => ({ url: s.url, title: s.title, at: Date.parse(s.bookmarked_at ?? s.created_at ?? s.added ?? "") || null, link: `${base}/archive/${s.timestamp}/index.html` }));
}
