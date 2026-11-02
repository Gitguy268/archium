#!/bin/sh
# Starts Hillium on Wayland when there is one and on X11 otherwise.
# Extra flags, one per line, can go in ~/.config/hillium-flags.conf (like Arch's chromium).
FLAGS_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/hillium-flags.conf"
FLAGS=""
if [ -f "$FLAGS_FILE" ]; then
  FLAGS="$(grep -v '^\s*#' "$FLAGS_FILE" | tr '\n' ' ')"
fi
# shellcheck disable=SC2086
exec /opt/hillium/hillium --ozone-platform-hint=auto --enable-features=WaylandWindowDecorations $FLAGS "$@"
