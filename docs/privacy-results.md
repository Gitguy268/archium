# Privacy test results

A subset of [privacytests.org](https://privacytests.org)'s tests, run on 2026-10-19 with `app/test/privacy/run.mjs` against Archium and against Electron with its defaults (the same Chromium, without Archium). ✅ passed, ❌ failed, – not applicable or not supported.

**Passed:** Archium 67/76 · Stock Electron 11/63

Run: the main state-partitioning, navigation, query-parameter and misc page; the top-level GPC check; HTTPS upgrade and the insecure-site check. Not run: cross-session state, HSTS cache, tracking cookies (it needs privacytests' cookie proxy), font fingerprinting and IP tests. Archium adds no fingerprint noise, so no fingerprinting results are claimed here.

| Category | Test | Archium | Stock Electron |
|---|---|:-:|:-:|
| misc | Tor enabled | ❌ | ❌ |
| misc | GPC enabled third-party | ✅ | ❌ |
| misc | ECH enabled | ✅ | ✅ |
| misc | Stream isolation | – | – |
| misc | GPC enabled first-party | ✅ | ❌ |
| query | fbclid | ✅ | ❌ |
| query | gclid | ✅ | ❌ |
| query | msclkid | ✅ | ❌ |
| query | mc_eid | ✅ | ❌ |
| query | dclid | ✅ | ❌ |
| query | oly_anon_id | ✅ | ❌ |
| query | oly_enc_id | ✅ | ❌ |
| query | _openstat | ✅ | ❌ |
| query | vero_conv | ✅ | ❌ |
| query | vero_id | ✅ | ❌ |
| query | wickedid | ✅ | ❌ |
| query | yclid | ✅ | ❌ |
| query | __s | ✅ | ❌ |
| query | rb_clickid | ✅ | ❌ |
| query | s_cid | ✅ | ❌ |
| query | ml_subscriber | ✅ | ❌ |
| query | ml_subscriber_hash | ✅ | ❌ |
| query | _hsenc | ✅ | ❌ |
| query | __hssc | ✅ | ❌ |
| query | __hstc | ✅ | ❌ |
| query | __hsfp | ✅ | ❌ |
| query | hsCtaTracking | ✅ | ❌ |
| query | mkt_tok | ✅ | ❌ |
| https | Upgradable address | ✅ | ❌ |
| https | Insecure website warning | ✅ | ❌ |
| navigation | sessionStorage | ✅ | ✅ |
| navigation | window.name | ❌ | ❌ |
| navigation | document.referrer | ❌ | ❌ |
| supercookies | cookie (JS) | ✅ | ❌ |
| supercookies | cookie (HTTP) | ✅ | ❌ |
| supercookies | localStorage | ✅ | ✅ |
| supercookies | indexedDB | ✅ | ✅ |
| supercookies | SharedWorker | ✅ | ✅ |
| supercookies | blob | ✅ | ✅ |
| supercookies | BroadcastChannel | ✅ | ✅ |
| supercookies | fetch cache | ✅ | ❌ |
| supercookies | XMLHttpRequest cache | ✅ | ❌ |
| supercookies | iframe cache | ✅ | ❌ |
| supercookies | CacheStorage | ✅ | ✅ |
| supercookies | favicon cache | ❌ | – |
| supercookies | locks | ✅ | ✅ |
| supercookies | TLS Session ID | ✅ | ✅ |
| supercookies | H1 connection | ✅ | ❌ |
| supercookies | H2 connection | ✅ | ❌ |
| supercookies | H3 connection | ✅ | ❌ |
| supercookies | CookieStore | ✅ | ❌ |
| supercookies | getDirectory | ✅ | ✅ |
| supercookies | CSS cache | ❌ | ❌ |
| supercookies | font cache | ❌ | ❌ |
| supercookies | image cache | ❌ | ❌ |
| supercookies | script cache | ❌ | ❌ |
| supercookies | prefetch cache | ❌ | ❌ |
| supercookies | Alt-Svc | ✅ | ❌ |
| trackers | Google (third-party ad pixel) | ✅ | ❌ |
| trackers | Google Tag Manager | ✅ | – |
| trackers | DoubleClick (Google) | ✅ | – |
| trackers | Google Analytics | ✅ | – |
| trackers | Facebook tracking | ✅ | ❌ |
| trackers | Amazon adsystem | ✅ | – |
| trackers | Scorecard Research Beacon | ✅ | – |
| trackers | New Relic | ✅ | ❌ |
| trackers | Criteo | ✅ | – |
| trackers | Adobe | ✅ | – |
| trackers | Adobe Audience Manager | ✅ | – |
| trackers | AppNexus | ✅ | – |
| trackers | Twitter pixel | ✅ | ❌ |
| trackers | Bing Ads | ✅ | ❌ |
| trackers | Taboola | ✅ | – |
| trackers | Index Exchange | ✅ | – |
| trackers | Yandex Ads | ✅ | ❌ |
| trackers | Quantcast | ✅ | – |
| trackers | Chartbeat | ✅ | ❌ |
