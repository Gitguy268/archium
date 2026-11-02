#!/bin/sh
# The hillium command line, run by Hillium's own Electron as Node (no Node install needed).
ELECTRON_RUN_AS_NODE=1 exec /opt/hillium/hillium /opt/hillium/resources/cli/hillium.mjs "$@"
