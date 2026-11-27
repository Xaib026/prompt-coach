#!/bin/sh
# Hook launcher: if Node isn't installed, do nothing rather than break the session.
command -v node >/dev/null 2>&1 || exit 0
node "$(dirname "$0")/../src/cli.mjs" "$@" || exit 0
