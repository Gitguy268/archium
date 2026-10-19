<div align="center">

<img src="branding/logo.svg" alt="Archium logo" width="112">

# Archium

A privacy layer for the [Helium](https://github.com/imputnet/helium) browser: offline new tab, local search, a Tor switch with a kill switch, and a URL cleaner.

[Install](#install) · [Features](#features) · [Limits](#limits) · [Threat model](docs/threat-model.md) · [Roadmap](docs/roadmap.md) · [Contributing](CONTRIBUTING.md)

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey)
![Based on Helium 0.19](https://img.shields.io/badge/based%20on-Helium%200.19-6b3fa0)

<img src="docs/img/newtab-light.png" alt="The Archium new tab page: a clock, a search box and quick links, with a 'Browsing through Tor' label" width="820">

</div>

> **Status: companion kit.** Archium is not yet a browser you can download. Today it is an extension and a set of scripts that run on top of a stock [Helium](https://helium.computer) release. Archium's own builds (renamed app, icon and defaults) are planned in the [roadmap](docs/roadmap.md).

## Features

| Feature | How | Where |
|---|---|---|
| Offline new tab page | Clock, search box and quick links. It makes no network requests; favicons come from the browser's cache | `extension/` |
| Private search | [SearXNG](https://github.com/searxng/searxng) runs on your Mac at `127.0.0.1:8888` (no Docker). If it isn't running, the same search goes to a public instance | `searxng/`, `extension/` |
| URL cleaner | 27 built-in rules strip `utm_*`, `fbclid`, `gclid`, `msclkid` and other tracking parameters, offline. Once Helium services are on, uBlock Origin's AdGuard URL Tracking list adds more | `extension/url-cleaner.json` |
| Tor / proxy switch | One click routes all traffic through your own Tor (`9050`, or `9150` for Tor Browser) or any SOCKS/HTTP proxy | `extension/` |
| Kill switch | When Tor or the proxy stops, pages fail to load; they never fall back to a direct connection. The toolbar badge turns red | `extension/` |
| WebRTC leak block | Sets `disable_non_proxied_udp`. It's on by default and forced on while proxied. Switched off, it returns to Helium's default (public interface only) | `extension/` |
| Ad blocking | Helium ships uBlock Origin built in | Helium |
| Fingerprint noise | Helium adds noise to canvas, audio and `hardwareConcurrency` | Helium |
| DNS-over-HTTPS presets | Helium's Settings → Privacy → Secure DNS offers Cloudflare, NextDNS, Quad9 and Google. For Mullvad, add the custom address `https://dns.mullvad.net/dns-query` | Helium |
| Your own services | Helium's filter-list mirror, bangs and extension proxy run on your machine instead of imputnet's servers | `services/` |

<img src="docs/img/popup.png" alt="The Archium popup with network mode, WebRTC switch and search addresses" width="260" align="right">

## Install

You need macOS on Apple silicon or Intel, [Helium](https://github.com/imputnet/helium-macos/releases), and [Homebrew](https://brew.sh).

1. **Get the code.** Archium isn't on GitHub yet, so start from a copy of this folder.
2. **Start local search.** Double-click `searxng/install.command`, or run:
   ```sh
   brew install uv
   sh searxng/install.sh
   ```
   SearXNG starts now and at every login. To remove it, run `searxng/uninstall.command`.
3. **Load the extension.** In Helium open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `extension` folder.
4. **Make SearXNG the default search engine.** Go to Settings → Search engine → Manage → Add, and enter:
   - Name: `Archium Search`
   - Shortcut: `sx`
   - URL: `http://127.0.0.1:8888/search?q=%s`

   Then choose **Make default**.
5. **For Tor:** run `brew install tor && brew services start tor`, or keep Tor Browser open and set the port to `9150`. Then pick **Tor** in the Archium toolbar popup.

<details>
<summary><b>Optional: run Helium's services yourself</b></summary>

Helium can fetch filter lists, bangs and extensions through imputnet's servers. To use your own copy instead:

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and mkcert: `brew install mkcert && mkcert -install`. The second command asks for your password once.
2. Run `sh services/run-local.sh`.
3. On Helium's first-run screen, **decline** services. Then go to Settings → Privacy → Services, set the custom origin to `https://localhost`, and only then turn services on. Doing it in this order means Helium never contacts imputnet.

[services/README.md](services/README.md) covers stopping the stack, updating it and moving it to a server.

</details>

<details>
<summary><b>How the pieces fit together</b></summary>

- **The new tab** (`newtab.html`) uses `chrome.search.query`, so typed searches go to whatever default engine you chose.
- **The background worker** (`background.js`) holds no state of its own. It reads `chrome.storage.local` and applies it on startup and after every change:
  - the proxy (`chrome.proxy`, `fixed_servers`);
  - the WebRTC policy (`chrome.privacy`);
  - DNS prefetching, which it turns off while proxied, because it could resolve hostnames outside the SOCKS proxy;
  - a redirect rule (`declarativeNetRequest`), which persists across restarts so it's in place before the worker wakes.
- **Kill switch.** Chromium never falls back to a direct connection from `fixed_servers`, so a dead Tor blocks traffic. If the stored settings are invalid, the worker points the proxy at a closed port and shows a red `!`. It does not go direct.
- **Searches in Tor mode.** Chromium never sends loopback traffic through a proxy, so local SearXNG would query Google and Bing from your real IP even in Tor mode. To prevent that, a redirect rule sends local searches to the public instance while Tor or a proxy is on, and that request goes through Tor.
- **Fallback.** If SearXNG isn't running, `webNavigation.onErrorOccurred` sends the failed search to the public instance.
- **Permissions.** The extension asks for access to all sites because Chromium only lets redirect rules (the URL cleaner and the search redirect) act on sites the extension has access to. It never reads page content and has no content scripts.

</details>

## Limits

- **Tor through a Chromium browser is not Tor Browser.** It hides your IP from sites, but your browser fingerprint still identifies you. If you need anonymity, use Tor Browser. See the [threat model](docs/threat-model.md).
- **Local SearXNG still queries Google, Bing and others from your IP**, outside Tor mode. Those engines see the queries but not your cookies or browser profile.
- **Browser video calls in Direct mode.** With the WebRTC block on, video calls in the browser may connect worse or not at all. Switch it off for calls when you aren't using Tor.
- **The proxy and WebRTC settings apply to normal windows only**, not incognito, unless you allow the extension in incognito.
- **Nothing here is compiled into the browser yet**, so the extension can be switched off from `chrome://extensions`.
- **There are no releases or auto-updates yet.** Run `git pull` and click reload on `chrome://extensions`.

## Development

```sh
node --test extension/                     # unit tests (no dependencies)
HELIUM=/Applications/Helium.app \
PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs \
node tests/e2e.mjs                         # 11 end-to-end checks in a real Helium
sh branding/make-icons.sh                  # rebuild icons from branding/logo.svg
```

The end-to-end test runs headless and needs no internet. It checks:
- the new tab override and that the new tab makes zero network requests;
- the URL cleaner;
- the search fallback and the Tor-mode search redirect;
- the WebRTC policy and DNS prefetching;
- the kill switch.

CI runs the unit tests, JSON checks and shellcheck. It does not build a browser, because a Chromium build needs paid runners.

## Credits

Archium builds on [Helium](https://github.com/imputnet/helium) by imputnet, which builds on [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium). Search is [SearXNG](https://github.com/searxng/searxng). See [NOTICE](NOTICE). Archium is not affiliated with any of these projects, or with Google or the Tor Project.

GPL-3.0 © Lucas Van De Weerd. See [LICENSE](LICENSE).
