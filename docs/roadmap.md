# Roadmap

## Now (0.1)

Archium on Electron, for macOS and Linux (Arch package), with the Arc/Zen window, four looks, Helium-style privacy, imports, ArchiveBox, the CLI and MCP. See the [CHANGELOG](../CHANGELOG.md).

## Next

- **Signed builds** for macOS and an AppImage for other distributions (`npm run dist:appimage` works but isn't tested yet).
- **Chrome extensions** where Electron supports them (`session.extensions`), starting with password managers.
- **Native glass** behind the sidebar on macOS 26+ (`electron-liquid-glass`), as Hillium has.
- **Profiles per window** and syncing spaces between computers (end-to-end encrypted, optional).

## Later: Archium on Helium

Running on Helium's engine means building Chromium: about 150 GB of disk and several hours per build, which free CI can't do. The plan, when there's a machine for it:

1. Fork [`imputnet/helium-linux`](https://github.com/imputnet/helium-linux) (and `helium-macos`), with `imputnet/helium` as the patch source.
2. Keep Helium's patches and add a `patches/archium/` series after them:
   - vertical tabs with spaces in Chromium's own tab strip code, using Archium's model;
   - the command bar as an omnibox popup;
   - Archium's `archium://` pages as WebUI;
   - Ghostery replaced by Helium's built-in uBlock Origin.
3. Check them with ungoogled-chromium's `devutils/validate_patches.py` in CI.

This would bring Helium's fingerprinting protection and Chromium's own updater path, and drop Electron. It's a large project, so the Electron version stays the main one until then.
