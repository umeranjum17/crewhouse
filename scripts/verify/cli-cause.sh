#!/usr/bin/env bash
# done-done journey `cli-cause`: the sign-in sheet's words when Claude cannot sign in (kit needs_cli_login), both
# variants, day/night at 390 and 1440, from real crewd and the built UI with only the kit's sign-in faked
# (scripts/verify/cli-cause.ts). Needs chrome-devtools-axi with CHROME_DEVTOOLS_AXI_SESSION set and web/dist built.
#   scripts/verify/cli-cause.sh "$DONE_DONE_EVIDENCE_ROOT"
set -euo pipefail
OUT=$1; mkdir -p "$OUT"
REPO=$(git rev-parse --show-toplevel)
S=$(mktemp -d -t crewhouse-cli-cause.XXXXXX); mkdir -p "$S/home"
ax() { chrome-devtools-axi "$@" >/dev/null 2>&1 || true; }
env -i PATH="$PATH" LANG=C.UTF-8 HOME="$S/home" TMPDIR="$S" XDG_STATE_HOME="$S/home/.local/state" XDG_DATA_HOME="$S/home/.local/share" \
  XDG_CONFIG_HOME="$S/home/.config" XDG_CACHE_HOME="$S/home/.cache" XDG_RUNTIME_DIR="$S/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$S/no-bus" \
  CREWHOUSE_CALLBACK_PORT=0 node "$REPO/scripts/verify/cli-cause.ts" "$REPO" "$S/lab" "$S/ready.json" > "$OUT/fixture.log" 2>&1 &
FIX=$!
stop() { ax open about:blank; kill -TERM "$FIX" 2>/dev/null || true; for _ in $(seq 40); do kill -0 "$FIX" 2>/dev/null || break; sleep 0.25; done
  kill -KILL "$FIX" 2>/dev/null || true; chmod -R u+w "$S"; rm -rf -- "$S"; }
trap stop EXIT
for _ in $(seq 120); do [ -s "$S/ready.json" ] && break; sleep 0.5; done
B=$(node -p "require('$S/ready.json').base"); P=$(<"$S/lab/state/person.key")
curl -fsS -X POST -H x-crewhouse:1 -H "Authorization: Bearer $P" -H 'content-type: application/json' -d '{"address":"Umer"}' "$B/api/onboard" >/dev/null
n=0
for variant in false true; do
  echo "{\"signIn\":$variant}" > "$S/lab/cause.json"
  for theme in day night; do for w in 390 1440; do
    n=$((n+1)); h=844; [ "$w" = 1440 ] && h=900
    ax open about:blank; ax resize "$w" "$h"; ax open "$B/?r=$n&$theme#person=$P"; ax wait 2000
    ax eval 'document.querySelector(".more-ways summary").click(); 1'; ax wait 400
    ax eval '(()=>{const b=[...document.querySelectorAll(".more-ways button")].find(b=>/claude/i.test(b.textContent));b.click();return 1})()'; ax wait 2500
    ax screenshot "$OUT/cli-cause-signin-$variant-$theme-$w.png"
  done; done
done
ls "$OUT"/cli-cause-signin-*.png | wc -l | grep -qx 8
