#!/usr/bin/env bash
# Chief's personality proof (docs/verification/chief-soul.md): Settings › Chief's personality read, changed in the app
# ("Captain" -> "Skipper"), saved, and put back; and Chief's Instructions page. 390 and 1440, day and night, on a stub
# crewd lab (runbook.md). Each step is checked through crewd's own GET /api/bots/chief, not the screen alone.
#   bash scripts/verify/chief-soul.sh <evidence-dir>
# Needs chrome-devtools-axi and a Chromium.
set -euo pipefail
EV=$(mkdir -p "$1" && cd "$1" && pwd); REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel); cd "$REPO"
SCRATCH=${SCRATCH:-$HOME/.cache/fm-scratch/chief-soul}; mkdir -p "$SCRATCH"
LAB=$(mktemp -d "$SCRATCH/l.XXXX"); mkdir -p "$LAB"/{home,state,crew,tools,run,profile}
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-chief-soul} CHROME_DEVTOOLS_AXI_USER_DATA_DIR="$LAB/profile"
NODE=$(node -p process.execPath)   # the real binary: a version-manager shim fails under the masked env
log() { printf '%s\n' "$*" | tee -a "$EV/transcript.txt"; }

MASK=(env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" XDG_STATE_HOME="$LAB/home/.local/state"
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache"
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_ENGINE=stub
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools")
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
. scripts/verify/crewd-group.sh
trap '{ timeout -k 5 15 chrome-devtools-axi stop; } >/dev/null 2>&1 || true; crewd_stop || exit 1; { chmod -R u+w "$LAB"; rm -rf "$LAB"; } >/dev/null 2>&1 || true' EXIT
crewd_start . "$EV/crewd.log" "${MASK[@]}" CREWHOUSE_PORT="$PORT" "$NODE" src/main.ts
B="http://127.0.0.1:$PORT"
for _ in $(seq 600); do [ -s "$LAB/state/person.key" ] && curl --max-time 10 -fsS -o /dev/null -H x-crewhouse:1 -H "Authorization: Bearer $(<"$LAB/state/person.key")" "$B/api/state" 2>/dev/null && break; sleep 0.2; done
K=$(<"$LAB/state/person.key")
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $K")
api() { curl --max-time 10 -fsS "${H[@]}" "$@"; }
soul_has() { api "$B/api/bots/chief" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.exit(JSON.parse(s).soul.includes('$1')?0:1))"; }
ax() { chrome-devtools-axi "$@" | sed "s/$K/<key>/g"; }
wait_js() { ax eval "(async () => { for (let i = 0; i < 100; i++) { if ($1) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()" | grep -q true || { log "timed out in page: $1"; return 1; }; }
shot() { ax screenshot "$EV/$1" >/dev/null; log "shot $1"; }
CARD="document.querySelector('.chief-soul')"
api -X POST -d '{"address":"Umer"}' "$B/api/onboard" >/dev/null

ax pages >/dev/null; ax selectpage 1 >/dev/null 2>&1 || ax newpage about:blank >/dev/null
for _ in 1 2 3; do ax open "$B/#person=$K" >/dev/null; ax open "$B/?r=$RANDOM#/settings" >/dev/null; wait_js "!!$CARD" && break; done
for look in day night; do for w in 390 1440; do
  h=844; vp="${w}x${h}x3,mobile,touch"; [ "$w" = 1440 ] && { h=900; vp="${w}x${h}x1"; }
  ax emulate --viewport "$vp" >/dev/null
  ax open "$B/?$look&r=$RANDOM#/settings" >/dev/null
  wait_js "!!$CARD && $CARD.innerText.includes('Captain')"
  ax eval "(() => { document.getElementById('chief-soul').scrollIntoView(); return true; })()" >/dev/null
  shot "settings-chief-soul-$look-$w.png"
  # Change: the person's own edit, typed into the box the way the app reads it (React's input event).
  ax eval "(() => { [...$CARD.querySelectorAll('button')].find((b) => b.textContent === 'Change').click(); return true; })()" >/dev/null
  wait_js "!!$CARD.querySelector('textarea')"
  ax eval "(() => { const t = $CARD.querySelector('textarea'), set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, t.value.replaceAll('Captain', 'Skipper')); t.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('chief-soul').scrollIntoView(); return true; })()" >/dev/null
  shot "settings-chief-soul-edit-$look-$w.png"
  ax eval "(() => { [...$CARD.querySelectorAll('button')].find((b) => b.textContent === 'Save').click(); return true; })()" >/dev/null
  wait_js "!$CARD.querySelector('textarea') && $CARD.innerText.includes('Skipper')"
  { soul_has Skipper && ! soul_has Captain; } || { log "$look $w: crewd's soul did not take the edit"; exit 1; }; log "$look $w: saved soul says Skipper (GET /api/bots/chief)"
  shot "settings-chief-soul-saved-$look-$w.png"
  # Chief's Instructions page shows the same, changed personality.
  ax open "$B/?$look&r=$RANDOM#/h/chief/instructions" >/dev/null
  wait_js "!!$CARD && $CARD.innerText.includes('Skipper')"
  shot "chief-instructions-$look-$w.png"
  # Put back how Chief started (the app asks first; the driver says yes).
  ax eval "(() => { window.confirm = () => true; [...$CARD.querySelectorAll('button')].find((b) => b.textContent === 'Put back how Chief started').click(); return true; })()" >/dev/null
  wait_js "$CARD.innerText.includes('Captain') && !$CARD.innerText.includes('Skipper')"
  { soul_has Captain && ! soul_has Skipper; } || { log "$look $w: put back did not restore the template"; exit 1; }; log "$look $w: put back, soul says Captain again"
done; done
ax eval "JSON.stringify({sw: document.documentElement.scrollWidth, iw: innerWidth})" | tee -a "$EV/transcript.txt"
node "$REPO/scripts/verify/steps.mjs" "$EV" chief-soul
