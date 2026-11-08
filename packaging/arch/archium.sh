#!/bin/sh
# Starts Archium on Wayland when there is one and on X11 otherwise.
# Extra flags, one per line, can go in ~/.config/archium-flags.conf (like Arch's chromium).
FLAGS_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/archium-flags.conf"
FLAGS=""
if [ -f "$FLAGS_FILE" ]; then
  FLAGS="$(grep -v '^\s*#' "$FLAGS_FILE" | tr '\n' ' ')"
fi
# shellcheck disable=SC2086
exec /opt/archium/archium --ozone-platform-hint=auto --enable-features=WaylandWindowDecorations $FLAGS "$@"
