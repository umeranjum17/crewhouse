#!/usr/bin/env bash
# Design-bar captures of one changed screen: dark and light, at desktop and phone
# width — four files, one screen, one call.
#
#   scripts/screens.sh "$EV/screens" hello "http://127.0.0.1:$PORT/"            # app root
#   scripts/screens.sh "$EV/screens" office "http://127.0.0.1:$PORT/" "demo=office"  # with a query
#
# Theme comes from the app's own switch (?day / ?night, main.tsx `useLook`), not from
# the OS colour scheme, so each capture is opened with the theme in the URL. Widths
# are the two the app is designed at; `resize` then `open` re-renders, as the layout
# is pure CSS. Set CHROME_DEVTOOLS_AXI_SESSION to your task-named session first.
# A screen that lives behind an in-memory switch (Home's Office view is never in the URL)
# needs one step after each open: THEN='<js>' is evaluated before the shot, e.g.
#   THEN="$(cat <<'JS'
#   (async () => { document.querySelector('[data-mode=office]')?.click(); for (let i = 0; i < 50 && !document.querySelector('.office'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.office'); })()
#   JS
#   )" scripts/screens.sh "$EV/screens" office "http://127.0.0.1:$PORT/"
set -euo pipefail

SKILL_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[ $# -ge 3 ] || { echo "usage: screens.sh <dest-dir> <screen-slug> <app-url> [extra-query]" >&2; exit 2; }
# Mandatory on every UI run, before the first capture: Crewhouse is a personal assistant
# for ONE person, so no screen, seed or prompt may speak about several people sharing it.
# A hit exits 1 and stops the run — fix the producer (the seed, the prompt, the component),
# never edit the string out of a screenshot. --self-test is its own negative test.
# (run from the repo top: the scan's default paths are relative to it)
cd -- "$(git -C "$SKILL_DIR" rev-parse --show-toplevel)"
node "$SKILL_DIR/scripts/personal-voice.mjs" --self-test >/dev/null
node "$SKILL_DIR/scripts/personal-voice.mjs" || {
  echo "screens.sh: personal-voice check failed — fix the producer, then re-run" >&2; exit 1; }

DEST=$1; SLUG=$2; URL=$3; EXTRA=${4:-}
mkdir -p "$DEST"
# The query goes before the hash: the app routes on location.hash, so "?night#/settings" would pin nothing.
withq() { local q=$1; case "$2" in *'#'*) printf '%s?%s%s' "${2%%#*}" "$q" "#${2#*#}";; *) printf '%s?%s' "$2" "$q";; esac; }
for theme in night day; do
  for wh in 1440x900 390x844; do
    w=${wh%x*}; h=${wh#*x}
    chrome-devtools-axi resize "$w" "$h" >/dev/null
    chrome-devtools-axi open "$(withq "$([ -n "$EXTRA" ] && printf '%s&' "$EXTRA")$theme" "$URL")" >/dev/null
    [ -z "${THEN:-}" ] || chrome-devtools-axi eval "$THEN" >/dev/null
    out="$DEST/$SLUG-$theme-$w.png"
    chrome-devtools-axi screenshot "$out" >/dev/null
    echo "$out"
  done
done
