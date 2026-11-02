#!/bin/sh
# Builds Hillium's Linux tarball, installs it with makepkg in an Arch Linux container and
# runs the e2e suite against the installed /opt/hillium under Xvfb.
#   ARCH=x64 (default; archlinux:base-devel, emulated on Apple silicon) or ARCH=arm64
#   PLAYWRIGHT=/path/to/node_modules/playwright   (copied into the container)
set -eu
ARCH="${ARCH:-x64}"
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
ROOT="$(cd "$APP/.." && pwd)"
PW="${PLAYWRIGHT:-$APP/node_modules/playwright}"
PLATFORM=linux/amd64
[ "$ARCH" = arm64 ] && PLATFORM=linux/arm64

(cd "$APP" && npx electron-builder --linux tar.gz "--$ARCH")

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$ROOT"/packaging/arch/PKGBUILD "$ROOT"/packaging/arch/hillium*.sh "$ROOT"/packaging/arch/hillium.desktop "$WORK"/
cp "$APP"/dist/hillium-*-"$ARCH".tar.gz "$WORK"/
mkdir -p "$WORK/test" "$WORK/node_modules"
cp "$APP"/test/e2e.mjs "$APP"/test/compose.mjs "$HERE"/inside.sh "$WORK"/test/
cp -R "$PW" "$WORK/node_modules/playwright"
cp -R "$(dirname "$PW")/playwright-core" "$WORK/node_modules/playwright-core"

docker build --platform "$PLATFORM" -t hillium-arch-test "$HERE"
docker run --rm --platform "$PLATFORM" --shm-size=1g -v "$WORK:/work" hillium-arch-test sh /work/test/inside.sh
