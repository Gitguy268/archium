#!/bin/sh
# Double-click wrapper for Finder.
cd "$(dirname "$0")" && sh ./install.sh
printf "\nPress Return to close."; read -r _
