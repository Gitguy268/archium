# Security and privacy model

## What Archium protects against

- **Tracking across sites:** ads and trackers are blocked, third parties get no cookies, referers are trimmed, tracking parameters are removed, GPC is sent.
- **Network observers on http:** pages are tried over HTTPS first, and the fallback says what http means.
- **Google:** no request goes to Google in normal use (checked by the e2e network log).
- **Web pages reaching the browser:** pages have no Node, run sandboxed with context isolation, can't open, navigate to or frame `archium://`, and can't read the `archium://` API token. The window UI's IPC only answers the UI's own view.
- **Other local users and web pages reaching the agent socket:** it's off by default, it's a 0600 Unix socket (no TCP port, so DNS rebinding can't reach it), and it checks a 0600 token with a constant-time compare.
- **Agents seeing private browsing:** private windows have their own model and session, which the agent API can't reach.

## What it doesn't

- **Fingerprinting.** There's no fingerprint noise like Helium's or Brave's. Use Tor Browser when you need to be anonymous.
- **Your IP address.** There's no built-in VPN or Tor.
- **Anything with your user account.** Software running as you can read your profile and the agent token, as with any browser.
- **Chromium bugs before Electron ships the fix.** Archium follows Electron's releases.

## Checklist used for the review

- `contextIsolation`, `sandbox`, no `nodeIntegration`, no `webviewTag` on every web view (`tabs.js`).
- A content security policy on every `archium://` page (`protocol.js`), no inline scripts.
- `setWindowOpenHandler` and `will-navigate` / `will-frame-navigate` guards on every view; `will-attach-webview` refused.
- Permission request and check handlers on every session; unknown permissions are denied.
- Path traversal refused when serving `ui/` files.
- IPC handlers resolve the window from the sender and ignore unknown senders.
- Settings writes go through an allow-list with a validator per key.
- The Arch package installs `chrome-sandbox` without setuid and relies on user namespaces.
