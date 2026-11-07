#!/usr/bin/env bash
# done-done journey `chat-pieces`: one call, crew_piece, on real crewd and the real engine (OpenClaw) with the scripted model, so
# the held tool call really crosses the engine. Umer answers a card, a form and a picker in Chief's thread at 390 and 1280, day
# and night, then in the installed window; Chief's next words are built from the result the engine handed back in that same turn.
#   scripts/verify/chat-pieces.sh <out-dir>
# Needs /usr/bin/chromium, xvfb-run, sqlite3 and bubblewrap. No account, no network, no sends. Exits non-zero on a missing mark.
set -euo pipefail
OUT=$(mkdir -p "${1:?usage: chat-pieces.sh <out-dir>}" && cd "$1" && pwd)
REPO=$(git rev-parse --show-toplevel); cd "$REPO"
export PATH="$(dirname "$(node -p process.execPath)"):$PATH"
. scripts/verify/crewd-group.sh
LAB=$(mktemp -d "${TMPDIR:-/tmp}/crewhouse-pieces.XXXXXX"); HELPER=""
cleanup() { crewd_stop 2>/dev/null || true; [ -z "$HELPER" ] || kill "$HELPER" 2>/dev/null || true; crewhouse_remove_lab "$LAB"; }
trap cleanup EXIT
npm run build:web > "$OUT/build-web.log" 2>&1
mkdir -p "$LAB"/{home,state,crew,tools,run}
node scripts/verify/chat-pieces-model.ts "$LAB/env" "$OUT/results.jsonl" > "$OUT/model.log" 2>&1 & HELPER=$!
for _ in $(seq 100); do [ -s "$LAB/env" ] && break; sleep 0.1; done
. "$LAB/env"
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
boot() {
  crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
    XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
    XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_ENGINE_BASE_URL="$MODEL" CREWHOUSE_ENGINE_API_KEY=scripted \
    CREWHOUSE_PORT="$PORT" CREWHOUSE_HOLD_MS=600000 CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
    ${CREWHOUSE_ENGINE_DIR:+CREWHOUSE_ENGINE_DIR="$CREWHOUSE_ENGINE_DIR"} node "$REPO/src/main.ts"
  PERSON=""
  for _ in $(seq 1200); do
    if [ -f "$LAB/state/person.key" ]; then PERSON=$(cat "$LAB/state/person.key"); curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"phase":"ready"' && break; fi
    sleep 0.25
  done
  [ -n "$PERSON" ] || { echo "chat-pieces: crewd never became ready" >&2; exit 1; }
  for _ in $(seq 80); do grep -rqs --include='*.json' -- "$MODEL" "$LAB/state" && return 0; grep -q '^engine provider:' "$OUT/crewd.log" && return 1; sleep 0.25; done
  return 1
}
# The engine can refuse the provider on a first boot ("config changed since last load"): the lab boots again, at most three times.
for try in 1 2 3; do boot && break; [ "$try" != 3 ] || { echo "chat-pieces: the engine never took the scripted model" >&2; exit 1; }; crewd_stop; CREWD=""; done
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl -fsS --max-time 60 "${H[@]}" -d "$2" "$B$1" > /dev/null; }
say() { post /api/bots/chief/messages "{\"text\":\"$1\"}"; }
count() { sqlite3 -readonly "$LAB/state/crew.db" "$1"; }
post /api/onboard '{"address":"Umer"}'

JS=$(cat <<'J'
const wait = async (what, ok) => { for (let i = 0; i < 300; i++) { if (ok()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('never saw ' + what); };
const card = (t) => [...document.querySelectorAll('.card.ask.draft-ask')].find((c) => c.textContent.includes(t));
const btn = (c, t) => [...c.querySelectorAll('button')].find((b) => b.textContent === t);
const text = (t) => document.querySelector('.lines')?.textContent.includes(t);
const put = (x, v) => { const p = x.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(x, v); x.dispatchEvent(new Event(x.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
const go = (when) => { location.hash = '/chief'; return when; };
J
)
CARD='Keep Tuesday free'; FORM='Where should the parcel go'; PICK='Which day suits the team'
gate() { node scripts/verify/home-gate.mjs "$REPO" "$B/#person=$PERSON" "$@"; }
both() { gate "$OUT" "$1" "$2"; GATE_PWA=1 gate "$OUT/installed" "$1" "$2"; }

say 'Can the dentist wait?'
both card "(async () => { $JS go(); await wait('the card', () => card('$CARD')); const c = card('$CARD'); if (!btn(c, 'Keep it') || !btn(c, 'Not now') || !c.textContent.includes('They can see you at 3')) throw new Error('card marks'); })()"
both card-answered "(async () => { $JS go(); await wait('the thread', () => card('$CARD') || text('Tuesday stays free.')); if (card('$CARD')) { const y = btn(card('$CARD'), 'Keep it'); y.click(); y.click(); } await wait('Chief to go on', () => text('Tuesday stays free.')); })()"

say 'Send my mum her parcel.'
both form "(async () => { $JS go(); await wait('the form', () => card('$FORM')); if (!btn(card('$FORM'), 'Book it').disabled) throw new Error('Book it before the lines are filled'); })()"
both form-filled "(async () => { $JS go(); await wait('the form', () => card('$FORM')); const c = card('$FORM'), [city, note] = c.querySelectorAll('input:not([type=checkbox])'); put(city, 'Lahore'); put(c.querySelector('select'), 'Large'); c.querySelector('input[type=checkbox]').click(); await wait('Book it', () => !btn(card('$FORM'), 'Book it').disabled); if (getComputedStyle(city).color !== 'rgb(30, 27, 22)' || getComputedStyle(city).backgroundColor !== 'rgb(255, 253, 246)') throw new Error('the typed words are not ink on paper'); })()"
GATE_PWA=1 GATE_KEYBOARD=1 gate "$OUT/installed" form-keyboard "(async () => { $JS go(); await wait('the form', () => card('$FORM')); const c = card('$FORM'), [city] = c.querySelectorAll('input:not([type=checkbox])'); put(city, 'Lahore'); put(c.querySelector('select'), 'Large'); c.querySelector('input[type=checkbox]').click(); city.focus(); const y = btn(card('$FORM'), 'Book it'); y.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 400)); const r = y.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight || y.disabled) throw new Error('Book it is not reachable above the keyboard'); })()"
both form-answered "(async () => { $JS go(); await wait('the thread', () => card('$FORM') || text('Booked for Lahore')); if (card('$FORM')) { const c = card('$FORM'), [city] = c.querySelectorAll('input:not([type=checkbox])'); put(city, 'Lahore'); put(c.querySelector('select'), 'Large'); c.querySelector('input[type=checkbox]').click(); await wait('Book it', () => !btn(card('$FORM'), 'Book it').disabled); btn(card('$FORM'), 'Book it').click(); } await wait('Chief to go on', () => text('Booked for Lahore, large box, gift wrapped.')); if (document.body.textContent.includes('Pressed Submit') || text('driver')) throw new Error('form receipt words'); })()"

say 'Book the team lunch.'
both picker "(async () => { $JS go(); await wait('the picker', () => card('$PICK')); const c = card('$PICK'); if (c.querySelectorAll('[role=radio]').length !== 3 || !btn(c, 'Book that day')) throw new Error('picker marks'); })()"
both picker-answered "(async () => { $JS go(); await wait('the thread', () => card('$PICK') || text('Wednesday it is')); if (card('$PICK')) { const c = card('$PICK'); [...c.querySelectorAll('[role=radio]')].find((r) => r.textContent.includes('Wednesday')).click(); await wait('the pick', () => card('$PICK').querySelector('[role=radio][aria-checked=true]').textContent.includes('Wednesday')); btn(card('$PICK'), 'Book that day').click(); } await wait('Chief to go on', () => text('Wednesday it is.')); })()"

WIDE=360,390,445,1280,1440
wide() { GATE_WIDTHS=$WIDE gate "$OUT" "$1" "$2"; GATE_PWA=1 gate "$OUT/installed" "$1" "$2"; }
BTNS='When should the reminder go out'; DATE='Which day should the engineer come'; SHEET='Read the refund policy first'
day="const days = () => [...document.querySelectorAll('.piece-day:not(:disabled)')], pickDay = async () => { const d = days(); d[Math.min(3, d.length - 1)].click(); await wait('the times to open', () => document.querySelectorAll('.piece-time:not(:disabled)').length > 0); }, pickTime = () => [...document.querySelectorAll('.piece-time')].find((b) => b.textContent === '10:30').click();"

say 'Remind me about the invoice.'
wide buttons "(async () => { $JS go(); await wait('the buttons', () => card('$BTNS')); const c = card('$BTNS'); if (c.querySelectorAll('.piece-buttons .btn').length !== 4 || !btn(c, 'Do not send one') || btn(c, 'Not now') || btn(c, 'Send')) throw new Error('buttons marks'); })()"
wide buttons-answered "(async () => { $JS go(); await wait('the thread', () => card('$BTNS') || text('Friday at 9 am it is')); if (card('$BTNS')) { const y = btn(card('$BTNS'), 'Friday at 9 am'); y.click(); y.click(); } await wait('Chief to go on', () => text('Friday at 9 am it is.')); })()"

say 'Book the engineer.'
wide date "(async () => { $JS go(); await wait('the date', () => card('$DATE')); const c = card('$DATE'); if (!btn(c, 'Send').disabled || !c.textContent.includes('Pick a day from today on') || ![...c.querySelectorAll('.piece-time')].every((b) => b.disabled)) throw new Error('date waits for a day'); if (!document.querySelector('.piece-day.today') || !document.querySelector('.piece-day:disabled') && new Date().getDate() > 1) throw new Error('today or the past days are not marked'); })()"
wide date-picked "(async () => { $JS go(); await wait('the date', () => card('$DATE')); $day await pickDay(); pickTime(); await wait('Send', () => !btn(card('$DATE'), 'Send').disabled); if (!card('$DATE').querySelector('.piece-picked').textContent.includes(' at 10:30')) throw new Error('the pick is not said'); })()"
wide date-answered "(async () => { $JS go(); await wait('the thread', () => card('$DATE') || text('Booked for')); if (card('$DATE')) { $day await pickDay(); pickTime(); await wait('Send', () => !btn(card('$DATE'), 'Send').disabled); btn(card('$DATE'), 'Send').click(); } await wait('Chief to go on', () => /Booked for \w+day \d{1,2} \w+ at 10:30\./.test(document.querySelector('.lines').textContent)); })()"

say 'What does the refund policy say?'
wide sheet "(async () => { $JS go(); await wait('the sheet row', () => card('$SHEET')); const c = card('$SHEET'); if (!c.querySelector('.piece-row')?.textContent.includes('Refund policy') || !c.querySelector('.piece-row')?.textContent.includes('Opens a page') || c.querySelector('.piece-row b')?.textContent !== 'Refund policy' || !btn(c, 'Got it') || !btn(c, 'Not now')) throw new Error('sheet marks'); })()"
GATE_SCOPE='main *, .page *, .piece-sheet *' wide sheet-open "(async () => { $JS go(); await wait('the sheet row', () => card('$SHEET')); card('$SHEET').querySelector('.piece-row').click(); await wait('the sheet', () => document.querySelector('.piece-sheet h3')); const s = document.querySelector('.piece-sheet'); if (!s.textContent.includes('About a 2 minute read') || !s.querySelector('h2')?.textContent.includes('Refund policy') || !s.querySelector('[aria-label=Close]') || innerWidth < 900 && s.getBoundingClientRect().bottom < innerHeight - 2) throw new Error('sheet open marks'); if (innerWidth >= 900 && Math.round(s.getBoundingClientRect().width) !== 560) throw new Error('a computer shows the sheet 560 wide'); })()"
wide sheet-answered "(async () => { $JS go(); await wait('the thread', () => card('$SHEET') || text('Thanks for reading it.')); if (card('$SHEET')) { card('$SHEET').querySelector('.piece-row').click(); await wait('the sheet', () => document.querySelector('.piece-sheet')); document.querySelector('.piece-sheet [aria-label=Close]').click(); await wait('the sheet to close', () => !document.querySelector('.piece-sheet')); btn(card('$SHEET'), 'Got it').click(); } await wait('Chief to go on', () => text('Thanks for reading it.')); })()"

say 'Find me flights.'
wide list "(async () => { $JS go(); await wait('the list', () => document.querySelector('.list-att')); const l = document.querySelector('.list-att'); if (l.querySelectorAll('.list-row').length !== 5 || !l.textContent.includes('12 results') || !btn(l, 'Show all 12') || !l.textContent.includes('ba.com') || btn(l, 'Send') || document.querySelector('.card.ask')) throw new Error('list marks'); })()"
wide list-all "(async () => { $JS go(); await wait('the list', () => document.querySelector('.list-att')); btn(document.querySelector('.list-att'), 'Show all 12').click(); await wait('every row', () => document.querySelectorAll('.list-att .list-row').length === 12); })()"

say 'Any news on the parcel?'
say 'Show me a slider.'
both lines "(async () => { $JS go(); await wait('the lines', () => text('The parcel left the depot this morning.') && text('How warm should the office be?')); })()"

{ echo "pieces answered: $(count "SELECT count(*) FROM asks WHERE kind='piece' AND state='answered'")"
  echo "pieces still open: $(count "SELECT count(*) FROM asks WHERE state='open'")"
  echo "answers: $(count "SELECT group_concat(answer, ' | ') FROM asks WHERE kind='piece'")"
  echo "prompts per answered job: $(count "SELECT group_concat(n, ' ') FROM (SELECT (SELECT count(*) FROM events e WHERE e.kind='run.prompted' AND json_extract(e.data,'\$.task')=a.task_id) n FROM asks a WHERE a.kind='piece')")"
  echo "what the model read back:"; cat "$OUT/results.jsonl"; } | tee "$OUT/answers.txt"
[ "$(count "SELECT count(*) FROM asks WHERE kind='piece' AND state='answered'")" = 6 ] || { echo "chat-pieces: six pieces were not answered once each" >&2; exit 1; }
[ "$(count "SELECT count(*) FROM asks WHERE state='open'")" = 0 ] || { echo "chat-pieces: a card stayed open" >&2; exit 1; }
grep -q '"values":{"city":"Lahore","size":"Large","gift":true,"note":""}' "$OUT/results.jsonl" && grep -q '"picked":{"id":"wed","label":"Wednesday"}' "$OUT/results.jsonl" && grep -q '"picked":{"id":"fri","label":"Friday at 9 am"}' "$OUT/results.jsonl" && grep -q '"day":"20[0-9-]*","time":"10:30"' "$OUT/results.jsonl" || { echo "chat-pieces: the model never read the structured result" >&2; exit 1; }
node scripts/verify/steps.mjs "$OUT" chat-pieces
