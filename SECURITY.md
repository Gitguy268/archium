# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private reporting form: <https://github.com/Gitguy268/hillium/security/advisories/new>

Include what you found, how to reproduce it, your Hillium version and your system (macOS or Linux distribution, Wayland or X11). You should get a reply within a week. Please give the fix time to ship before you publish details.

## Scope

[docs/security.md](docs/security.md) says what Hillium does and doesn't protect against. The most useful reports are about:

- a web page reaching `hillium://` pages, their data, or the window UI's IPC;
- anything other than you reaching the agent socket (`control.sock`), or an agent seeing a private window;
- requests that skip the privacy filter (blocking, third-party cookies, referrers, HTTPS first);
- the Arch package or its wrapper scripts;
- the GitHub Actions workflows in this repository.

Bugs in Chromium belong with [Electron](https://github.com/electron/electron/security) or [Chromium](https://www.chromium.org/Home/chromium-security/reporting-security-bugs/). Hillium follows Electron's releases for Chromium security fixes.

## Supported versions

Only the latest version on the `main` branch is supported.
