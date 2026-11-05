#!/usr/bin/env bash
# done-done journey `live-desktop`: the live desktop panel on real crewd, from the approved "Same room, our crew" frame.
# One isolated stub-engine crewd onboarded as Umer, Scout on a held job and Rex with no computer. Scout's computer is real:
# crewd's own Xvfb and Chromium with the local test shop on it, streamed by desklink into the panel. At 390 and 1280, day and night:
#   live        the shop's real picture, Live, the job's line, You can leave, Take control; beside the chat at 1280
#   starting    the stream has not come up: Starting desktop…, no Live
#   stopped     Stop watching: Stopped. This is not live., no Live, the picture covered
#   lost        crewd's Xvfb is killed under a running stream: the picture is covered and Live goes
#   none        Rex, who has no computer: No computer connected, no picture
#   chief       Chief's own panel beside his thread
#   held        Take control tapped, then Hand it back: the shipped controls, unchanged
# Then the installed window of live at 390, a film of the picture moving while the panel watches, and view-only: until the
# person taps Take control the bot keeps its controls. Exits non-zero when a mark is missing, or Live shows on anything but a
# running stream.
#
#   scripts/verify/live-desktop.sh <out-dir>
#
# Needs /usr/bin/chromium, Xvfb and libXtst (xtype.py). The stub's job is held by its own "ask permission" script.
set -euo pipefail
OUT=${1:?usage: live-desktop.sh <out-dir>}; mkdir -p "$OUT"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t l.XXXXXX)
SHOP="" KILLER=""
trap 'trap "" HUP INT TERM; [ -z "$KILLER" ] || kill "$KILLER" 2>/dev/null; [ -z "$SHOP" ] || kill "$SHOP" 2>/dev/null; crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
NODE=$(node -p process.execPath)
free() { "$NODE" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
PORT=$(free) SHOPPORT=$(free)
B="http://127.0.0.1:$PORT"
[ -f "$REPO/web/dist/index.html" ] || (cd "$REPO" && npm run build:web > "$LAB/build-web.log" 2>&1)
"$NODE" "$REPO/scripts/verify/test-shop.mjs" "$SHOPPORT" > "$LAB/shop.log" 2>&1 & SHOP=$!
crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  "$NODE" "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "live-desktop: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl -fsS --max-time 30 "${H[@]}" -d "$2" "$B$1" > /dev/null; }
state() { curl -fsS --max-time 10 "${H[@]}" "$B/api/state"; }
post /api/onboard '{"address":"Umer"}'
post /api/recruit '{"template":"scout","name":"Scout"}'
post /api/recruit '{"template":"reverse","name":"Rex"}'
state | "$NODE" -e 'const b = JSON.parse(require("node:fs").readFileSync(0)).bots, s = b.find((x) => x.id === "scout"), r = b.find((x) => x.id === "rex"); process.exit(s?.computer && r && !r.computer ? 0 : 1)' || { echo "live-desktop: Scout needs a computer and Rex none" >&2; exit 1; }
post /api/bots/scout/messages '{"text": "Check Corner Shop for the brass lamp, and ask permission before anything else."}'
for _ in $(seq 120); do state | grep -q '"task":{' && break; sleep 0.25; done

JS=$(cat <<'J'
const wait = async (what, ok, tries = 450) => { for (let i = 0; i < tries; i++) { if (ok()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('never saw ' + what + ': ' + (document.querySelector('.ld-side')?.innerText ?? document.body.innerText).slice(0, 300)); };
const q = (s) => document.querySelector(s), said = (s) => q(s)?.innerText ?? '';
const live = () => /^Live$/.test(said('.ld-mark .pill.ok')), veiled = () => !!q('.ld-veil');
const picture = () => { const v = q('.ld-stage video'), c = q('.ld-stage canvas'); return (v?.videoWidth ?? c?.width ?? 0) > 0; };
const open = async (bot) => { location.hash = `#/h/${bot}/screen`; await wait('the panel', () => q('.ld-side')); };
const running = async () => { await open('scout'); await wait('the stream', () => live() && !veiled() && picture()); };
const noLive = () => { if (q('.ld-mark')) throw new Error('a mark on a dead stream: ' + said('.ld-mark')); };
J
)
LIVE="(async () => { $JS await running(); if (!/brass lamp/.test(said('.ld-doing'))) throw new Error('doing: ' + said('.ld-doing')); if (said('.ld-leave') !== 'You can leave. Scout keeps going.') throw new Error('leave: ' + said('.ld-leave')); if (innerWidth >= 900 && !q('.ld-room .chat .dock')) throw new Error('no chat beside it'); await new Promise((r) => setTimeout(r, 1500)); })()"
STARTING="(async () => { $JS await open('scout'); await wait('starting', () => said('.ld-veil') === 'Starting desktop…' && q('.ld-spin')); noLive(); })()"
STOPPED="(async () => { $JS await running(); [...document.querySelectorAll('.ld-more .link')].find((b) => b.innerText === 'Stop watching').click(); await wait('stopped', () => said('.ld-veil') === 'Stopped. This is not live.'); noLive(); })()"
LOST="(async () => { $JS await running(); await wait('the picture covered', () => veiled() && !live()); noLive(); })()"
CHIEF="(async () => { $JS await open('chief'); await wait('his panel', () => q('.ld-stage, .ld-none')); if (innerWidth >= 900 && !q('.ld-room .chat .dock')) throw new Error('no thread beside it'); if (q('.ld-stage')) await wait('his stream', () => live() && !veiled()); })()"
HELD="(async () => { $JS await open('scout'); await wait('the panel', () => q('.ld-take, .hand-back')); if (q('.ld-take')) { await running(); q('.ld-take').click(); } await wait('the wheel', () => said('.ld-mark .pill.ok') === 'You have control' && q('.hand-back') && q('.screen-held') && !veiled()); if (!/paused until you hand it back/.test(said('.ld-doing'))) throw new Error('doing: ' + said('.ld-doing')); })()"
BACK="(async () => { $JS await open('scout'); await wait('the panel', () => q('.ld-take, .hand-back .btn.go')); q('.hand-back .btn.go')?.click(); await wait('the panel again', () => q('.ld-take') && live()); })()"
FILM="(async () => { $JS await running(); await new Promise((r) => setTimeout(r, 12000)); if (!live() || veiled()) throw new Error('the stream dropped while the page moved'); })()"
NONE="(async () => { $JS await open('rex'); await wait('the words', () => said('.ld-none b') === 'No computer connected'); if (q('.ld-stage')) throw new Error('a picture with no computer'); })()"

URL="$B/#person=$PERSON"
gate() { node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$URL" "$@"; }
# The first watcher starts Scout's desktop; the shop goes on it as the helper's own browser would put it there.
GATE_WIDTHS=390 gate "$LAB/warm" warm "$LIVE" > /dev/null
X=""
display() { for p in $(pgrep -u "$(id -u)" -x Xvfb || true); do
  tr '\0' '\n' < "/proc/$p/cmdline" 2>/dev/null | grep -qx "$LAB/state/desktops/scout.xauth" || continue
  echo "$p"; return; done; }
xdisplay() { local p=$1 fd i; for fd in /proc/"$p"/fd/*; do i=$(readlink "$fd" 2>/dev/null | sed -n 's/^socket:\[\([0-9]*\)\]$/\1/p'); [ -n "$i" ] || continue
  X=$(awk -v i="$i" '$7 == i && $8 ~ /X11-unix\/X[0-9]+$/ { sub(/.*X11-unix\/X/, "", $8); print ":" $8; exit }' /proc/net/unix); [ -n "$X" ] && return; done; }
shop() { local p; p=$(display); [ -n "$p" ] || { echo "live-desktop: Scout's desktop never started" >&2; exit 1; }; xdisplay "$p"
  DISPLAY=$X XAUTHORITY="$LAB/state/desktops/scout.xauth" python3 -I "$REPO/scripts/verify/xtype.py" key:ctrl+l "text:http://shop.localhost:$SHOPPORT/login" key:Return; }
shop
gate "$OUT" live "$LIVE"
GATE_PWA=1 gate "$OUT/installed" live "$LIVE"
GATE_INIT="$REPO/scripts/verify/live-desktop-held.js" gate "$OUT" starting "$STARTING"
gate "$OUT" stopped "$STOPPED"
gate "$OUT" none "$NONE"
gate "$OUT" chief "$CHIEF"
# The picture moving while the panel watches: the bot's browser signs in to the shop, through its own display.
( for _ in $(seq 120); do [ -n "$(curl -fsS --max-time 10 "${H[@]}" "$B/api/state" | grep -o '"watching":true' || true)" ] && break; sleep 0.25; done; sleep 5; p=$(display); xdisplay "$p"
  DISPLAY=$X XAUTHORITY="$LAB/state/desktops/scout.xauth" python3 -I "$REPO/scripts/verify/xtype.py" key:Tab text:umer@example.com key:Tab text:secret key:Return ) &
GATE_FILM="$OUT/motion" GATE_WIDTHS=390 gate "$LAB/film" film "$FILM" > /dev/null
wait $!
# View only: until the person taps Take control the bot keeps its controls, and nothing took it from the job.
state | "$NODE" -e 'const s = JSON.parse(require("node:fs").readFileSync(0)).bots.find((b) => b.id === "scout"); console.log(JSON.stringify({ controls: s.controls, task: s.task?.title })); process.exit(s.controls === "bot" && s.task ? 0 : 1)' > "$OUT/view-only.txt"
sqlite3 -readonly "$LAB/state/crew.db" "SELECT count(*) FROM events WHERE kind = 'desktop.takeover'" | grep -qx 0 || { echo "live-desktop: the panel took the controls" >&2; exit 1; }
# The shipped controls in the new frame: one real tap on Take control, and one on Hand it back.
GATE_WIDTHS=390,1280 gate "$OUT" held "$HELD"
GATE_WIDTHS=390 gate "$LAB/back" back "$BACK" > /dev/null
# A stream that dies under the person: each time the panel is watching, crewd's Xvfb for Scout goes, and only that one.
( while :; do
    if state | "$NODE" -e 'process.exit(JSON.parse(require("node:fs").readFileSync(0)).bots.find((b) => b.id === "scout")?.desktop?.watching ? 0 : 1)'; then
      sleep 6; p=$(display); [ -z "$p" ] || { kill "$p"; echo "killed Xvfb $p" >> "$OUT/lost.txt"; }; sleep 4
    fi; sleep 0.5
  done ) & KILLER=$!
gate "$OUT" lost "$LOST"
kill "$KILLER"; KILLER=""
node "$REPO/scripts/verify/steps.mjs" "$OUT" live-desktop
