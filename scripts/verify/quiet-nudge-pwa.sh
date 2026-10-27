#!/usr/bin/env bash
# done-done journey `quiet-nudge-pwa`: the quiet-job nudge reaching a PHONE-SIZED PWA paired over the relay. pair-lab.sh
# starts a stub crewd, the repo's relay and the built shell; the browser at 390 pairs with a relay code (the two words
# confirmed at the computer), a helper's job is held and its recorded activity moved back five hours, and Chief's one
# line arrives in the paired app's own thread (read over the link, not from crewd's page). Day and night.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/quiet-nudge-pwa.sh <out-dir>
#
# Exit 0 with quiet-nudge-pwa/chief-{night,day}-390.png and paired.txt in <out-dir>. Not covered: Web Push delivery
# (needs a mailbox with a push credential) and the Android app (docs/verification/quiet-nudge.md).
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: quiet-nudge-pwa.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel); cd "$REPO"
export LAB=$(mktemp -d -t crewhouse-quiet-pwa.XXXXXX)
. scripts/verify/crewd-group.sh
trap 'bash scripts/verify/pair-lab.sh down 2>&"$crewd_err" || exit 1; crewhouse_remove_lab "$LAB"' EXIT
bash scripts/verify/pair-lab.sh up "$REPO" > "$OUT/lab.log" 2>&1
. "$LAB/env"
PERSON=$(cat "$LAB/state/person.key")
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 20 "${H[@]}" "${@:2}" "$B$1"; }
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
axi() { timeout -k 10 120 chrome-devtools-axi "$@"; }
ev() { axi eval "$1"; }
until_js() { for _ in $(seq 80); do ev "$1" 2>/dev/null | grep -q true && return 0; sleep 0.5; done; echo "quiet-nudge-pwa: never saw $1" >&2; return 1; }
# The crew exists before the browser pairs, so the paired app opens on real data (Chief's thread, not Hello).
api /api/onboard -d '{"address":"Umer"}' > /dev/null
api /api/recruit -d '{"template":"scout","name":"Research Rae"}' > /dev/null
# The browser pairs the way the public shell's card does: a relay code in the box, the two words, yes at the computer.
first=$(axi pages | awk -F, 'NR>1 { gsub(/ /, "", $1); if ($1 ~ /^[0-9]+$/) { print $1; exit } }')
if [ -n "$first" ]; then axi selectpage "$first" > /dev/null; else axi newpage about:blank > /dev/null; fi
axi emulate --viewport 390x844x3,mobile,touch > /dev/null
axi open "${WEB}?day#/pair" > /dev/null
until_js "!!document.querySelector('.pair-code')"
CODE=$(bash scripts/verify/pair-lab.sh cli phones code | tail -1)
ev "(() => { const t = document.querySelector('.pair-code'), p = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(t, $(node -p 'JSON.stringify(process.argv[1])' "$CODE")); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()" > /dev/null
until_js "[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Pair')"
ev "(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Pair').click(); return true; })()" > /dev/null
until_js "!!document.querySelector('.pair-words')"
bash scripts/verify/pair-lab.sh cli phones approve "$(bash scripts/verify/pair-lab.sh cli phones pending | tail -1 | sed 's/.*: //')" > /dev/null
until_js "!!document.querySelector('main')"
echo paired > "$OUT/paired.txt"
# The held job, made quiet.
api /api/bots/research-rae/messages -d '{"text":"Compare six phone plans that keep my number, and ask permission before you pick"}' > /dev/null
sql() { node -e 'const { DatabaseSync } = require("node:sqlite"), db = new DatabaseSync(process.argv[1]); db.exec("PRAGMA busy_timeout = 10000");
  const [, q, ...a] = process.argv.slice(1), r = /^\s*select/i.test(q) ? db.prepare(q).all(...a) : db.prepare(q).run(...a); if (Array.isArray(r)) process.stdout.write(JSON.stringify(r))' "$LAB/state/crew.db" "$@"; }
TASK=""
for _ in $(seq 120); do TASK=$(sql "SELECT id FROM tasks WHERE bot = 'research-rae' AND state = 'working'" | node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(0, "utf8"))[0]?.id ?? ""))'); [ -z "$TASK" ] || break; sleep 0.25; done
[ -n "$TASK" ] || { echo "quiet-nudge-pwa: Rae's job never started working" >&2; exit 1; }
nudges() { sql "SELECT COUNT(*) AS n FROM messages WHERE bot = 'chief' AND text LIKE '%has been quiet for a while%'" | node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(0, "utf8"))[0].n))'; }
MS=$((5 * 3600 * 1000))
sql "UPDATE events SET at = at - ? WHERE json_extract(data, '\$.task') = CAST(? AS INTEGER)" "$MS" "$TASK"
sql "UPDATE tasks SET created_at = created_at - ?, updated_at = updated_at - ? WHERE id = ?" "$MS" "$MS" "$TASK"
for _ in $(seq 40); do [ "$(nudges)" != 0 ] && break; sleep 0.5; done
[ "$(nudges)" = 1 ] || { echo "quiet-nudge-pwa: expected one nudge, saw $(nudges)" >&2; exit 1; }
# The paired app's own thread shows it: Chief's page read over the link.
THEN="(async () => { for (let i = 0; i < 80 && !document.querySelector('.chat-list a'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('.chat-list a')?.click(); for (let i = 0; i < 80 && !/has been quiet for a while/.test(document.body.innerText); i++) await new Promise((r) => setTimeout(r, 100)); return /has been quiet for a while/.test(document.body.innerText); })()" \
  WIDTHS=390x844 bash scripts/verify/screens.sh "$OUT/quiet-nudge-pwa" chief "${WEB}#/"
node scripts/verify/steps.mjs "$OUT" quiet-nudge-pwa
echo "quiet-nudge-pwa: the paired 390 app showed Chief's one line; captures in $OUT/quiet-nudge-pwa"
