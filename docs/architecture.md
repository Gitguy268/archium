# How Hillium fits together

```
app/
  main/            Electron main process
    main.js          switches, stores, menu, first window, links from other apps
    hub.js           the running browser: model, tab views, windows, history, downloads
    model.js         spaces, favourites, pinned tabs, folders, Today, archive, splits, rules (no Electron)
    window.js        one window: the UI view, tab views in the card, overlay and Glance stacking
    tabs.js          a web view with its guards (popups, hillium://, mailto:, context menu)
    privacy/         filter.js (the only webRequest listener), adblock.js, sessions.js, ua.js, url-cleaner.json
    protocol.js      hillium:// pages and their token-checked /api
    pages.js         the data behind Settings, Library and the error page
    boosts.js        per-site CSS, JS, font and Zap
    importers/       Arc, Zen (mozLz4), Chromium bookmarks
    agent.js         what the CLI and agents may do; control.js the socket they use
    archivebox.js    ArchiveBox REST client
    mini.js          Little Hillium
  preload/         chrome.cjs (window UI bridge), web.cjs (GPC, ⌥-click to Glance)
  ui/              chrome.html/css/js (sidebar, command bar, Glance frame), themes/, pages/, vendor/
cli/hillium.mjs    the CLI and the MCP server
packaging/arch/    PKGBUILD, wrappers, desktop file
```

## The window

Each window is a `BaseWindow` with a transparent `WebContentsView` for the UI that fills it, and one `WebContentsView` per visible tab placed where the UI's `#page` element is. The UI reports that rectangle whenever it changes; main lays out the tab views (side by side in split view).

When something has to draw over the page (the command bar, the compact sidebar, drag targets, popovers), the UI view moves above the tab views. Its background has holes where the pages are (an SVG mask), so the pages stay visible. The command bar puts a still image of the page behind itself so the liquid glass has something to refract. Glance puts a third view on top.

## Requests

Electron keeps one listener per `webRequest` event and session, so `privacy/filter.js` is the only one. Order: Ghostery, then the URL cleaner, HTTPS first and pings; request headers (third-party cookies, referer, GPC, client hints); response headers (Ghostery's CSP, third-party `Set-Cookie`). Every session gets the same setup in `sessions.js`: the default one, one per space with its own profile, and an in-memory one per private window.

## hillium:// pages

Settings, Library and the error page run in the web session, without Node or a preload. Each host is its own origin and gets the UI files at `/_/`, because custom schemes get no CORS. Their data comes from `/api/<name>`, which needs a per-launch token written into their HTML. Web pages can't read the token, and `tabs.js` stops them opening, navigating to or framing `hillium://` pages.

## The CLI and agents

When agent access is on, `control.js` listens on a Unix socket in the profile folder (mode 0600) and wants a token from a 0600 file next to it. There's no TCP port. `agent.js` only reaches the normal model, so private windows (each with its own model) are invisible to it. `cli/hillium.mjs` speaks that protocol, and `hillium mcp` wraps it as an MCP server on stdio.
