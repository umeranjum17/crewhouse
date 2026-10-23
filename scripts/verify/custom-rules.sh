#!/usr/bin/env bash
# A021: run the real app's rule journey through the repository's isolated PWA harness.
set -euo pipefail
node "$(dirname "$0")/custom-rules.mjs" "${1:?evidence folder}"
[ "${BASELINE:-0}" = 1 ] || node "$(dirname "$0")/steps.mjs" "$1" custom-rules
