#!/usr/bin/env bash
# Design-bar captures of one changed screen: dark and light, at desktop and phone
# width — four files, one screen, one call.
#
#   scripts/verify/screens.sh "$EV/screens" hello "http://127.0.0.1:$PORT/"            # app root
#   scripts/verify/screens.sh "$EV/screens" office "http://127.0.0.1:$PORT/" "demo=office"  # with a query
#
# Theme comes from the app's own switch (?day / ?night, main.tsx `useLook`), not from
# the OS colour scheme, so each capture is opened with the theme in the URL. Widths
# are the two the app is designed at; `resize` then `open` re-renders, as the layout
# is pure CSS. Set CHROME_DEVTOOLS_AXI_SESSION to your task-named session first.
# EXPAND_MORE=1 opens up to eight long replies; AFTER runs after expansion (e.g. scroll .lines).
# WIDTHS defaults to both sizes. FULL_PAGE=1 captures document scroll only, not nested .lines on desktop.
# A screen that lives behind an in-memory switch (Home's Office view is never in the URL)
# needs one step after each open: THEN='<js>' is evaluated before the shot, e.g.
#   THEN="$(cat <<'JS'
#   (async () => { document.querySelector('[data-mode=office]')?.click(); for (let i = 0; i < 50 && !document.querySelector('.office'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.office'); })()
#   JS
#   )" scripts/verify/screens.sh "$EV/screens" office "http://127.0.0.1:$PORT/"
set -euo pipefail

VERIFY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[ $# -ge 3 ] || { echo "usage: screens.sh <dest-dir> <screen-slug> <app-url> [extra-query]" >&2; exit 2; }
# Mandatory on every UI run, before the first capture: Crewhouse is a personal assistant
# for ONE person, so no screen, seed or prompt may speak about several people sharing it.
# A hit exits 1 and stops the run — fix the producer (the seed, the prompt, the component),
# never edit the string out of a screenshot. --self-test is its own negative test.
# (run from the repo top: the scan's default paths are relative to it)
cd -- "$(git -C "$VERIFY_DIR" rev-parse --show-toplevel)"
node "$VERIFY_DIR/personal-voice.mjs" --self-test >/dev/null
node "$VERIFY_DIR/personal-voice.mjs" || {
  echo "screens.sh: personal-voice check failed — fix the producer, then re-run" >&2; exit 1; }

DEST=$1; SLUG=$2; URL=$3; EXTRA=${4:-}
mkdir -p "$DEST"
# The browser tool prints diagnostics on stdout: silent on success, loud on
# failure, with one retry for a transient CDP miss (both attempts are printed).
# `timeout` bounds a hung CDP call (a dead tab never answers): TERM at 120s,
# KILL 10s later, so a hung call always ends in a loud failure, never silence.
axi() { local out rc n=0; while :; do out=$(timeout -k 10 120 chrome-devtools-axi "$@" 2>&1); rc=$?; [ $rc -eq 0 ] && return 0; n=$((n + 1)); echo "screens.sh: chrome-devtools-axi $* failed (exit $rc, attempt $n): $out" >&2; [ $n -ge 2 ] && return "$rc"; sleep 2; done; }
# A run can inherit a session whose tabs have no selection (a run that died
# mid-capture leaves them behind), and `open` then refuses: take the first
# tab, or open one when there is none.
pages_out=$(chrome-devtools-axi pages 2>&1) || { echo "screens.sh: could not list pages: $pages_out" >&2; exit 1; }
first=$(printf '%s\n' "$pages_out" | awk -F, 'NR>1 { gsub(/ /, "", $1); if ($1 ~ /^[0-9]+$/) { print $1; exit } }')
if [ -n "$first" ]; then axi selectpage "$first"; else axi newpage about:blank; fi
echo "screens.sh: capturing $SLUG with tab ${first:-new}" >&2
# The query goes before the hash: the app routes on location.hash, so "?night#/settings" would pin nothing.
withq() { local q=$1; case "$2" in *'#'*) printf '%s?%s%s' "${2%%#*}" "$q" "#${2#*#}";; *) printf '%s?%s' "$2" "$q";; esac; }
for theme in night day; do
  for wh in ${WIDTHS:-1440x900 390x844}; do
    w=${wh%x*}; h=${wh#*x}
    u="$(withq "$([ -n "$EXTRA" ] && printf '%s&' "$EXTRA")$theme" "$URL")"
    # A page first: emulation has nothing to act on before one exists.
    echo "screens.sh: $SLUG $theme $w" >&2
    axi open "$u" || true
    if [ "$w" -le 500 ]; then vp="${w}x${h}x3,mobile,touch"; else vp="${w}x${h}x1"; fi
    axi emulate --viewport "$vp"
    axi open "$u"
    [ -z "${THEN:-}" ] || axi eval "$THEN"
    if [ "${EXPAND_MORE:-0}" = 1 ]; then
      # ponytail: eight More buttons; raise for longer replay threads.
      for ((n=0; n<8; n++)); do
        ref=$(chrome-devtools-axi snapshot --full | awk '/button "More"/{sub(/uid=/,"",$1); print $1; exit}')
        [ -n "$ref" ] || break
        chrome-devtools-axi click "@$ref" >/dev/null
      done
    fi
    [ -z "${AFTER:-}" ] || axi eval "$AFTER"
    out="$DEST/$SLUG-$theme-$w.png"
    flags=(); [ "${FULL_PAGE:-0}" != 1 ] || flags+=(--full-page)
    axi screenshot "$out" "${flags[@]}"
    echo "$out"
  done
done
