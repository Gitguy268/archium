# Helium parity

Hillium runs on Electron's Chromium, not on a Helium build (see [roadmap.md](roadmap.md)). It applies Helium's defaults at the Electron level instead. This page lists each one, where it lives and how it's checked.

| Helium / ungoogled-chromium | Hillium | Where | Checked by |
|---|---|---|---|
| No Google services (Safe Browsing, sync, field trials, component updater, translate) | Electron ships none of them. Hillium turns off domain reliability, background networking and hyperlink-auditing pings, and the Hunspell dictionary download from Google in every session | `main/main.js` | e2e: the network log of a whole run has no Google host |
| uBlock Origin built in | Ghostery's engine with EasyList, EasyPrivacy, uBlock Origin's lists and cookie notices, network and cosmetic filtering | `main/privacy/adblock.js`, `filter.js` | e2e: a tracker script is cancelled and an ad slot hidden |
| Tracking parameters stripped (uBO's `removeparam`) | 68 parameter names and prefixes removed from every navigation | `main/privacy/url-cleaner.json` | unit + e2e |
| HTTPS by default | HTTPS first, with a page that offers http when a site has no HTTPS | `filter.js`, `ui/pages/error.*` | unit + e2e |
| Third-party cookies blocked | Chromium's third-party cookie phase-out, plus `Cookie` stripped from third-party requests and `Set-Cookie` from their responses | `filter.js`, `main/main.js` | unit + e2e, privacytests |
| State partitioning (Brave turns on the same Chromium features) | HTTP and code caches, connections, TLS sessions, Alt-Svc, NEL and storage keyed by the top-level site; favicons fetched per tab, uncached. privacytests still reports the subresource caches, `window.name` and the favicon cache as shared; the cause of the favicon result isn't confirmed | `main/main.js`, `main/hub.js` | privacytests |
| Referrer trimming | Cross-site referers cut to the origin | `filter.js` | unit + e2e |
| Global Privacy Control | `Sec-GPC: 1` and `navigator.globalPrivacyControl` | `filter.js`, `preload/web.cjs` | e2e, privacytests |
| WebRTC IP leak protection | `default_public_interface_only` for every page | `main/tabs.js`, `main/main.js` | – |
| DNS over HTTPS presets | Quad9 (default), Mullvad, Cloudflare; "automatic" or "secure only" | `main/privacy/sessions.js`, Settings | – |
| Reduced user agent | Plain Chrome user agent with no Electron or app name; high-entropy client hints removed | `main/privacy/ua.js`, `filter.js` | unit + e2e |
| Permission prompts | Camera, microphone, location, notifications and more ask in the window; remembered per site if you choose | `sessions.js`, `ui/chrome.js` | e2e |
| No search suggestions by default | Off; when on, they go to DuckDuckGo | Settings | – |
| Fingerprinting protection (Helium's noise patches) | **Not done.** Electron can't add Chromium's fingerprint noise without patching Chromium | – | – |
| Chromium security updates | Follow Electron's releases (Dependabot watches them) | `app/package.json` | – |

The only outside hosts a whole e2e run touched were `raw.githubusercontent.com` (Ghostery's prebuilt lists, cached for a week) and `dns.quad9.net` (secure DNS). On Linux the log also shows `0.0.0.0`: Chromium still asks for a spell-check dictionary, at the address Hillium gives it instead of Google's, which goes nowhere.
