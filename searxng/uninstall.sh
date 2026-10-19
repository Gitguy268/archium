#!/bin/sh
# Stop SearXNG and remove everything install.sh created.
set -eu

LABEL="org.archium.searxng"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Library/Application Support/Archium/searxng"
rm -f "$HOME/Library/Logs/Archium/searxng.log"
echo "SearXNG removed."
