#!/bin/sh
# The archium command line, run by Archium's own Electron as Node (no Node install needed).
ELECTRON_RUN_AS_NODE=1 exec /opt/archium/archium /opt/archium/resources/cli/archium.mjs "$@"
