# Archium Browser

A Chromium browser shell for macOS with Archium's privacy features built in, three looks (Normal, Windows 98, Liquid Glass), Glance, and a local assistant running MiniCPM-V 4.7 1B. It runs today without compiling Chromium: Electron supplies the engine, and Archium draws its own tabs and toolbar.

## Run it

Double-click `start.command`. The first run installs Electron and the ad blocker (about 350 MB, needs Node.js 20 or later). Or:

```sh
npm ci
npm start
```

Your data lives in `~/Library/Application Support/Archium Browser`. Local search uses the SearXNG from `../searxng/install.sh` at `127.0.0.1:8888`. When it isn't running, searches go to the public fallback.

## What's in it

| | |
|---|---|
| **Looks** | Normal follows macOS light and dark. Windows 98 has a caption bar, an IE-style coolbar, tab-control tabs, a status bar and a cloud desktop on the new tab page. Liquid Glass puts native macOS glass (`NSGlassEffectView`, or vibrancy on macOS before 26) behind the tabs and toolbar, and refracting glass over a wallpaper on the new tab page. Switch looks in the ☰ menu, ⌘K, View → Look or Settings |
| **Glance** | ⌃⌥Space from any app opens a small browser in the screen corner. Pin it, or open the page in a tab |
| **Assistant** | ⇧⌘A. MiniCPM-V 4.7 1B on this Mac (WebGPU, or the CPU). It can summarize the page, answer questions about it, explain a selection, and look at a screenshot of the page. Private tabs are never read |
| **Tabs** | On top, on the side (⌘S), or hidden (⇧⌘S). Private tabs (⇧⌘N) use a separate in-memory session |
| **Focus Mode** | ⇧⌘B shows only the page. ⌘L brings the address field back |
| **⌘K** | Open tabs, bookmarks, history and every command |
| **Privacy** | Ghostery's ad blocker with EasyList, EasyPrivacy and the cookie-notice lists. Archium's URL cleaner. Tor or a proxy with a kill switch, applied to every session. A WebRTC leak block. Permission prompts for camera, microphone, location and notifications |
| **Share as QR** | The QR button in the address field turns the page address into a QR code, made on this Mac |

<details>
<summary><b>Keyboard shortcuts</b></summary>

| Action | Shortcut |
|---|---|
| Glance | ⌃⌥Space |
| Commands | ⌘K |
| New tab / window / private tab | ⌘T / ⌘N / ⇧⌘N |
| Close / reopen tab | ⌘W / ⇧⌘T |
| Address | ⌘L |
| Tabs on side or top / show or hide | ⌘S / ⇧⌘S |
| Focus Mode | ⇧⌘B |
| Find | ⌘F |
| Bookmark / show bookmarks | ⌘D / ⌥⌘B |
| History | ⌘Y |
| Assistant / summarize / look at page | ⇧⌘A / ⇧⌘U / ⇧⌘L |
| Next / previous tab, tab 1–9 | ⌃Tab / ⇧⌃Tab, ⌘1–⌘9 |
| Downloads folder | ⇧⌘J |
| Settings | ⌘, |

</details>

<details>
<summary><b>About the model</b></summary>

The assistant uses [MiniCPM-V 4.7 1B](https://huggingface.co/openbmb/MiniCPM-V-4.7-1B-gguf) (Apache-2.0) in llama.cpp's GGUF format: the Q4_K_M language model (672 MB) and its image projector (901 MB), pinned at revision `9684c734`.

The [int4 checkpoint](https://huggingface.co/openbmb/MiniCPM-V-4.7-1B-int4) is a bitsandbytes NF4 file for CUDA GPUs, which can't run on a Mac. This is the same model in the format that can.

- **Download.** The first time you open the assistant, it downloads both files from Hugging Face in 64 MiB pieces. Each piece is checked against a pinned SHA-256 before it's kept, so a stopped download resumes where it left off.
- **Existing copies.** A copy already on this Mac (in `~/minimind-mermaid/gguf/`) is checked and hard-linked instead of downloaded again.
- **Tor and proxy.** Downloads go through Tor or the proxy when one is on.
- **Engine.** It runs on [wllama](https://github.com/ngxson/wllama), which is llama.cpp in WebAssembly, using a master build vendored in `ui/vendor/wllama/`.

</details>

<details>
<summary><b>How it fits together</b></summary>

- **`main/`** is the Electron main process.
  - `shell.js`: one window. A toolbar page fills it, and the active tab's view sits in the rectangle the toolbar reports.
  - `glance.js`: the Glance window.
  - `sessions.js`: proxy, permissions and the request filter for every session.
  - `filter.js`: the single `onBeforeRequest` dispatcher. The order is Ghostery, then the URL cleaner, then the Tor search redirect.
  - `adblock.js`: Ghostery, with lists fetched through the proxied session and cached.
  - `model.js`: the model download.
  - `protocol.js`: `archium://`.
- **`ui/`** holds Archium's own pages:
  - `chrome.html`: tabs, toolbar, menus, ⌘K, settings;
  - `assistant.html`;
  - `glance.html`;
  - `newtab/`.
  - They load from `archium://app/` with a strict CSP and get one small IPC bridge (`preload/archium.cjs`). Web pages never get a preload or Node.
- **Reused from the extension.** `../extension/lib.js` (proxy, WebRTC, search fallback) and `../extension/url-cleaner.json` are imported directly, so the extension and the browser stay in step.
- **Popovers.** While one is open (⌘K, the menu, settings), the toolbar page moves above the web page. Its clear areas let the page show through under the scrim.

</details>

## Limits

- **It's Electron, not Helium.** There's no fingerprint noise, and Chromium updates arrive with Electron releases. Use Tor Browser if you need anonymity.
- **No Chrome extensions.** Ghostery stands in for uBlock Origin.
- **Not packaged or signed yet.** It runs from this folder.
- **Liquid Glass is native glass on macOS 26 and later.** Earlier macOS gets vibrancy. Native glass sits behind the bars. The web page itself is never made see-through.
- **Downloads.** They use the standard save dialog and go to the folder you pick. There's no downloads list yet.

## Development

```sh
npm test       # unit tests: filter, proxy mapping, address parsing, model pin
npm run e2e    # Playwright drives the real app; writes screenshots to test/screenshots/
```

`npm run e2e` needs Playwright. Set `PLAYWRIGHT=/path/to/node_modules/playwright` if it isn't installed here. `AI=1 npm run e2e` also loads the real model, which needs the files and a few minutes.
