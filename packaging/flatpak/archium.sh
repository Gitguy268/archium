#!/bin/sh
# Flatpak launcher: zypak gives Chromium's sandbox a way to work inside Flatpak's.
# Extra flags, one per line, can go in ~/.var/app/io.github.gitguy268.archium/config/archium-flags.conf.
FLAGS_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/archium-flags.conf"
FLAGS=""
if [ -f "$FLAGS_FILE" ]; then
  FLAGS="$(grep -v '^\s*#' "$FLAGS_FILE" | tr '\n' ' ')"
fi
# shellcheck disable=SC2086
exec zypak-wrapper /app/archium/archium --enable-features=WaylandWindowDecorations $FLAGS "$@"
