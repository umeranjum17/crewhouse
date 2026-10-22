#!/usr/bin/env bash
# Reading up mid-turn keeps the place, and a New pill jumps to the latest (docs/verification/thread-hygiene.md):
# a held Chief turn, the thread read up to its top, then a line lands below (a second send from another device). The
# place must stay put and "↓ New" show over the dock; its tap lands on the newest line. At 390 and 1440, day and
# night, recorded once, and again in the installed app.
#   bash scripts/verify/new-pill.sh <evidence-dir>
# Needs chrome-devtools-axi, ffmpeg (for the recording), xvfb-run and a Chromium.
set -euo pipefail
EV=$(mkdir -p "$1" && cd "$1" && pwd); REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel); cd "$REPO"
SCRATCH=${SCRATCH:-$HOME/.cache/fm-scratch/ch-chat-scroll-new-pill}; mkdir -p "$SCRATCH" "$EV/motion" "$EV/pwa"
LAB=$(mktemp -d "$SCRATCH/l.XXXX"); mkdir -p "$LAB"/{home,state,crew,tools,run,profile} "$LAB/pwa/home/run"
CDP_PORT=${CDP_PORT:-9925}
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-ch-chat-scroll-new-pill} CHROME_DEVTOOLS_AXI_USER_DATA_DIR="$LAB/profile"
export CHROME_DEVTOOLS_AXI_CHROME_ARGS="--remote-debugging-port=$CDP_PORT"
NODE=$(node -p process.execPath)   # the real binary: a version-manager shim fails under the masked env
log() { printf '%s\n' "$*" | tee -a "$EV/transcript.txt"; }

MASK=(env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" XDG_STATE_HOME="$LAB/home/.local/state"
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache"
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_ENGINE=stub
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools")
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
. scripts/verify/crewd-group.sh
trap '{ if [ -n "${REC:-}" ]; then kill -TERM "$REC"; wait "$REC"; fi; timeout -k 5 15 chrome-devtools-axi stop; } >/dev/null 2>&1 || true; crewd_stop || exit 1; { chmod -R u+w "$LAB"; rm -rf "$LAB"; } >/dev/null 2>&1 || true' EXIT
crewd_start . "$EV/crewd.log" "${MASK[@]}" CREWHOUSE_PORT="$PORT" "$NODE" src/main.ts
B="http://127.0.0.1:$PORT"
for _ in $(seq 600); do [ -s "$LAB/state/person.key" ] && curl --max-time 10 -fsS -o /dev/null -H x-crewhouse:1 -H "Authorization: Bearer $(<"$LAB/state/person.key")" "$B/api/state" 2>/dev/null && break; sleep 0.2; done
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $(<"$LAB/state/person.key")")
api() { curl --max-time 10 -fsS "${H[@]}" "$@"; }
until_js() { for _ in $(seq 300); do api "$B/api/state" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const state=JSON.parse(s);process.exit(($1)?0:1)})" && return 0; sleep 0.2; done; log "timed out: $1"; return 1; }
say() { api -X POST -d "{\"text\":\"$1\"}" "$B/api/bots/chief/messages" >/dev/null; }

# Earlier talk, so every width has a thread to read up in; then one Chief turn held open for the whole run.
api -X POST -d '{"address":"Umer"}' "$B/api/onboard" >/dev/null
for i in $(seq 1 30); do say "Note $i: what is on for the week of the ${i}th, and who is coming over for dinner on Friday?"; until_js "!state.bots.find((b) => b.id === 'chief').task"; done
say 'Please ask permission before you plan my week'
until_js "state.bots.find((b) => b.id === 'chief').task"

BOX="[...document.querySelectorAll('.chat .lines')].find((e) => e.offsetParent)"
PLACE="(() => { const b = $BOX, p = b.querySelector('.new-pill'), r = p?.getBoundingClientRect(), o = b.getBoundingClientRect(), d = document.querySelector('.chat .dock')?.getBoundingClientRect();
  return { st: Math.round(b.scrollTop), max: b.scrollHeight - b.clientHeight, pill: p?.innerText ?? null, inBox: !!r && r.top >= o.top && r.bottom <= o.bottom + 1, aboveDock: !!r && (!d || r.bottom <= d.top + 1) }; })()"
probe() { chrome-devtools-axi eval "JSON.stringify({ label: '$1', width: innerWidth, ...$PLACE })"; }
wait_js() { chrome-devtools-axi eval "(async () => { for (let i = 0; i < 100; i++) { if ($1) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()" | grep -q true || { log "timed out in page: $1"; return 1; }; }
shot() { chrome-devtools-axi screenshot "$EV/$1" >/dev/null; }

chrome-devtools-axi pages >/dev/null; chrome-devtools-axi selectpage 1 >/dev/null   # a kept profile starts with no tab selected
chrome-devtools-axi open "$B/#person=$(<"$LAB/state/person.key")" >/dev/null

n=0
for look in day night; do for w in 390 1440; do
  h=844; [ "$w" = 1440 ] && h=900; n=$((n + 1))
  chrome-devtools-axi resize "$w" "$h" >/dev/null; chrome-devtools-axi open "$B/?$look#/chief" >/dev/null
  wait_js "!!document.querySelector('.chat .live-line') && $PLACE.st >= $PLACE.max - 1"
  probe "$look-$w-open" | tee -a "$EV/measure.txt"
  if [ "$look-$w" = night-390 ]; then
    node scripts/verify/record.mjs "http://127.0.0.1:$CDP_PORT" "$B/" "$EV/motion/read-up-new-pill.webm" 20 > "$EV/motion/record.log" 2>&1 &
    REC=$!
    for _ in $(seq 100); do grep -q 'RECORDING:' "$EV/motion/record.log" && break; kill -0 "$REC" 2>/dev/null || { cat "$EV/motion/record.log" >&2; exit 1; }; sleep 0.1; done
  fi
  # Read up with the wheel, as a person does, then a line lands below while the turn runs.
  chrome-devtools-axi eval "(async () => { for (let i = 0; i < 12; i++) { $BOX.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true })); $BOX.scrollBy(0, -400); await new Promise((r) => setTimeout(r, 50)); } return true; })()" >/dev/null
  wait_js "$PLACE.st === 0"
  shot "$look-$w-read-up.png"
  say "And keep Sunday free, note $n."
  wait_js "$PLACE.inBox"
  sleep 1   # the live clock ticks at least once more under the reader: the place must still hold
  probe "$look-$w-pill" | tee -a "$EV/measure.txt"
  shot "$look-$w-pill.png"
  chrome-devtools-axi eval "$BOX.querySelector('.new-pill').click()" >/dev/null
  wait_js "$PLACE.st >= $PLACE.max - 1 && !$PLACE.pill"
  probe "$look-$w-latest" | tee -a "$EV/measure.txt"
  shot "$look-$w-latest.png"
  if [ -n "${REC:-}" ]; then sleep 1; kill -TERM "$REC"; wait "$REC"; REC=; fi
done; done

# The installed app (headed, under Xvfb): installed from Settings for real, then the same read-up inside it.
node -e '
const [B, key, LAB, EV, SK, BOX, PLACE] = process.argv.slice(1), say = (t) => `curl --max-time 10 -fsS -H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer ${key}" -d ${JSON.stringify(JSON.stringify({ text: t }))} ${B}/api/bots/chief/messages >/dev/null`;
const steps = [
  { name: "boot", w: 1400, h: 950, dpr: 1, mobile: false, url: `${B}/#person=${key}`, settle: 3000 },
  { name: "settings", url: `${B}/#/settings`, wait: "!!document.querySelector(\".install .btn\")", timeout: 20000 },
  { name: "install", click: ".install .btn", settle: 3000 },
  { name: "tab", key: "Tab" }, { name: "return", key: "Return", settle: 3000 },
  { name: "window", xshot: `${EV}/pwa/installed-window.png` },
  { name: "attach", attachApp: B }];
for (const look of ["day", "night"]) for (const [w, h] of [[390, 844], [1440, 900]]) {
  const tag = `${look}-${w}`;
  steps.push(
    { name: `open-${tag}`, w, h, dpr: w < 500 ? 2 : 1, mobile: w < 500, url: `${B}/?${look}#/chief`, wait: `!!document.querySelector(".chat .live-line") && ${PLACE}.st >= ${PLACE}.max - 1`, timeout: 20000 },
    { name: `up-${tag}`, eval: `${BOX}.scrollTop = 0` }, { name: `read-up-${tag}`, wait: `${PLACE}.st === 0`, timeout: 5000 },
    { name: `land-${tag}`, run: say(`And keep the evening free, installed ${tag}.`), wait: `${PLACE}.inBox`, timeout: 20000,
      eval: `[matchMedia("(display-mode: standalone)").matches, ${PLACE}]`, out: `${EV}/pwa/${tag}-pill.png` },
    { name: `tap-${tag}`, click: ".new-pill", settle: 800, wait: `${PLACE}.st >= ${PLACE}.max - 1 && !${PLACE}.pill`, timeout: 5000,
      eval: `[matchMedia("(display-mode: standalone)").matches, ${PLACE}]`, out: `${EV}/pwa/${tag}-latest.png` });
}
console.log(JSON.stringify({ profile: `${LAB}/pwa/profile`, home: `${LAB}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, args: ["--window-size=1400,950", "--force-device-scale-factor=1", "about:blank"], steps }));
' "$B" "$(<"$LAB/state/person.key")" "$LAB" "$EV" "$REPO/scripts/verify" "$BOX" "$PLACE" > "$LAB/pwa-plan.json"
xvfb-run -a -s "-screen 0 1920x1200x24" node scripts/verify/pwa-shell.mjs "$LAB/pwa-plan.json" > "$EV/pwa/run.json"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("pwa", JSON.stringify(r.filter((x) => "value" in x || "error" in x)))' "$EV/pwa/run.json" | tee -a "$EV/transcript.txt"

log "evidence: $EV"
node "$REPO/scripts/verify/steps.mjs" "$EV" new-pill
