#!/usr/bin/env bash
# Capture the Chief phone header (the changed screen) at 390 (phone) and 1440 (desk), in day and
# night, into a stable folder. Wraps chrome-devtools-axi with the wait screens.sh lacks: the hero
# renders after the app fetches state, so the shot must wait for it or it catches the bare bar.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task> capture.sh <dest-dir> <prefix> "<base-url>#person=<key>"
#
# base-url must carry the private launcher fragment so each fresh tab gets authority; the app
# rewrites the hash to the route and keeps authority in that tab's sessionStorage.
set -euo pipefail
[ $# -ge 3 ] || { echo "usage: capture.sh <dest-dir> <prefix> <url-with-person-fragment>" >&2; exit 2; }
DEST=$1; PREFIX=$2; URL=$3
mkdir -p "$DEST"
# theme+query goes before the hash; the app routes on location.hash.
withq() { case "$URL" in *'#'*) printf '%s?%s#%s' "${URL%%#*}" "$1" "${URL#*#}";; *) printf '%s?%s' "$URL" "$1";; esac; }
for theme in night day; do
  for wh in 1440x900 390x844; do
    w=${wh%x*}; h=${wh#*x}
    u=$(withq "$theme")
    chrome-devtools-axi open "$u" >/dev/null 2>&1 || true
    chrome-devtools-axi resize "$w" "$h" >/dev/null 2>&1 || true
    chrome-devtools-axi open "$u" >/dev/null 2>&1
    # Wait for the app to have fetched state and mounted (the box), plus the header row on a phone
    # width (at 1440 the hero is hidden and HomeBar renders the desk bar instead).
    want=".home-chat .composer"
    [ "$w" -lt 900 ] && want=".home-chat .chief-hero .ch-row"
    got=""
    for _ in $(seq 1 40); do
      got=$(chrome-devtools-axi eval "() => !!document.querySelector('$want')" 2>/dev/null | grep -o 'true\|false' | head -1 || true)
      [ "$got" = "true" ] && break
      sleep 0.25
    done
    [ "$got" = "true" ] || { echo "capture.sh: '$want' never appeared at $w/$theme" >&2; exit 1; }
    out="$DEST/$PREFIX-$theme-$w.png"
    chrome-devtools-axi screenshot "$out" >/dev/null
    echo "$out"
  done
done
