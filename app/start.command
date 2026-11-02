#!/bin/sh
# Double-click to run Hillium from this folder (macOS). The first run installs Electron
# and the ad blocker (about 350 MB, needs Node.js 20 or later).
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  echo "Hillium needs Node.js 20 or later: https://nodejs.org" >&2
  exit 1
fi
if [ ! -d node_modules/@ghostery ]; then
  npm ci --no-audit --no-fund || exit 1
fi
# npm can skip Electron's own download; run it ourselves when the app isn't there yet.
if [ ! -d node_modules/electron/dist ]; then
  node node_modules/electron/install.js || exit 1
fi
exec npx electron .
