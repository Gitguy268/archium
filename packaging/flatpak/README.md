# Flatpak

A self-hosted Flatpak of Archium. It isn't on Flathub. Each GitHub Release has an
`io.github.gitguy268.archium.flatpak` file built by `.github/workflows/release.yml`.

Install it:

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user ./io.github.gitguy268.archium.flatpak
flatpak run io.github.gitguy268.archium
```

Build it yourself on Linux (x86_64):

```sh
cd app && npm ci && npx electron-builder --linux tar.gz --x64 --publish never
cp dist/archium-*-x64.tar.gz ../packaging/flatpak/archium-linux-x64.tar.gz
cd ../packaging/flatpak
flatpak-builder --user --install-deps-from=flathub --force-clean --repo=repo build io.github.gitguy268.archium.yml
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo repo archium.flatpak io.github.gitguy268.archium
```

The `archium` CLI and MCP server aren't in the Flatpak; they need Node on the host.
