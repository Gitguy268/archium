#!/bin/sh
# Runs inside the Arch container (see run.sh): makepkg, pacman -U, then the e2e suite.
set -eu
chown -R builder /work
cd /work
sudo -u builder makepkg -f --noconfirm
pacman -U --noconfirm /work/hillium-bin-*.pkg.tar.zst
pacman -Qi hillium-bin | sed -n '1,4p'
test -x /usr/bin/hillium && test -x /usr/bin/hillium-cli && test -f /usr/share/applications/hillium.desktop
hillium-cli --help | head -n 1

# Through the launcher users run. Containers don't allow the user namespaces Chromium's
# sandbox uses, so tests run without it.
export HILLIUM_BINARY=/usr/bin/hillium E2E_NO_SANDBOX=1 E2E_SLOW=4 E2E_EXPECT_FEATURE=WaylandWindowDecorations
export HILLIUM_CLI=/opt/hillium/resources/cli/hillium.mjs PLAYWRIGHT=/work/node_modules/playwright
mkdir -p /tmp/xdg && chmod 700 /tmp/xdg
export XDG_RUNTIME_DIR=/tmp/xdg
dbus-run-session -- xvfb-run -a -s "-screen 0 1440x900x24" node /work/test/e2e.mjs
