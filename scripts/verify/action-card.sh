#!/usr/bin/env bash
# done-done journey `action-card`: the inline draft card on real crewd, in one lab (pair-lab.sh, emulate's Google, never a real account).
# On the computer's own web app, at 390 and 1280, day and night:
#   waiting    Scribe's draft in Chief's thread: the words in an editable box, Copy, Discard, "Waiting for you"
#   draft      the person's own words in the box: the state line says Draft, nothing has moved
#   receipts   a double tap on Copy, a tap on Discard: "Copied, you send it" and "Discarded", never Sent
#   phone-only Tracer's email on the computer: Copy held, "Approve this email on your paired phone"
# Then the installed web app, paired as a control device (action-card-plan.mjs): the edited words go to Review one email, a double
# tap on Send, one message in emulate's mailbox, and the Sent receipt. The organisation's attestation is seeded: the web has no marking screen.
#   scripts/verify/action-card.sh <out-dir>
# Needs /usr/bin/chromium and xvfb-run. Exits non-zero when a mark is missing or anything acted twice.
set -euo pipefail
OUT=$(mkdir -p "${1:?usage: action-card.sh <out-dir>}" && cd "$1" && pwd)
REPO=$(git rev-parse --show-toplevel); cd "$REPO"
export PATH="$(dirname "$(node -p process.execPath)"):$PATH" # the lab masks HOME, which breaks a version manager's shim
export LAB=$(mktemp -d "${TMPDIR:-/tmp}/crewhouse-action-card.XXXXXX")
. scripts/verify/crewd-group.sh
cleanup() { bash scripts/verify/pair-lab.sh down 2>&"$crewd_err" || exit 1; crewhouse_remove_lab "$LAB"; }
trap cleanup EXIT
npm run build:web > "$OUT/build-web.log" 2>&1
LAB_GOOGLE=1 LAB_NODE_OPTIONS="--import=$REPO/scripts/verify/google-token-route.mjs" bash scripts/verify/pair-lab.sh up "$PWD" > "$OUT/lab.log" 2>&1
. "$LAB/env"
PERSON=$(cat "$LAB/state/person.key")
node scripts/verify/action-card-seed.mjs "$B" "$PERSON" "$GOOGLE"
sqlite3 "$LAB/state/crew.db" "INSERT INTO settings (key,value) VALUES ('mail.org.fernwood.example','{\"org\":\"fernwood.example\",\"name\":\"Fernwood\",\"kind\":\"corporate\",\"person\":1,\"phone\":\"lab\",\"at\":1}')"
count() { sqlite3 -readonly "$LAB/state/crew.db" "$1"; }

JS=$(cat <<'J'
const wait = async (what, ok) => { for (let i = 0; i < 100; i++) { if (ok()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('never saw ' + what); };
const card = (to) => [...document.querySelectorAll('.card.ask.draft-ask')].find((c) => c.textContent.includes('To ' + to));
const btn = (c, t) => [...c.querySelectorAll('button')].find((b) => b.textContent === t);
const put = (c, t) => { const x = c.querySelector('textarea.draft-edit'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(x, t); x.dispatchEvent(new Event('input', { bubbles: true })); };
J
)
WAITING="(async () => { $JS location.hash = '/chief'; await wait('the card', () => card('Sara')?.querySelector('textarea.draft-edit')); if (!/^Waiting for you/.test(card('Sara').querySelector('.ask-status').textContent) || !btn(card('Sara'), 'Copy') || !btn(card('Sara'), 'Discard')) throw new Error('not the waiting card'); card('Sara').scrollIntoView({ block: 'center' }); })()"
EDITED="(async () => { $JS location.hash = '/chief'; await wait('the card', () => card('Sara')?.querySelector('textarea.draft-edit')); put(card('Sara'), 'Sara, Friday at ten suits me. Thank you for moving it.'); await wait('the draft state', () => card('Sara').querySelector('.ask-status').textContent.startsWith('Draft')); card('Sara').scrollIntoView({ block: 'center' }); })()"
PHONE="(async () => { $JS location.hash = '/chief'; await wait('the card', () => card('ada@fernwood.example')); const c = card('ada@fernwood.example'); if (!btn(c, 'Copy').disabled || !c.textContent.includes('Approve this email on your paired phone') || c.querySelector('textarea')) throw new Error('the computer is offered more than it can do'); c.scrollIntoView({ block: 'nearest' }); })()"
# Idempotent: the first look taps, the others read the same receipts.
TAPS="(async () => { $JS location.hash = '/chief'; await wait('the thread', () => card('Sara') || document.querySelector('.card.answered')); if (card('Sara')) { const y = btn(card('Sara'), 'Copy'); y.click(); y.click(); } if (card('the landlord')) btn(card('the landlord'), 'Discard').click(); await wait('both receipts', () => { const t = [...document.querySelectorAll('.card.answered')].map((e) => e.textContent).join(' '); return t.includes('Copied, you send it') && t.includes('Discarded'); }); if ([...document.querySelectorAll('.card.answered')].some((e) => /^Sent|Sent$/.test(e.textContent))) throw new Error('Sent with nothing sent'); const box = document.querySelector('.chat .lines'); box.scrollTop = box.scrollHeight; await wait('the thread to rest at its end', () => !document.querySelector('.new-pill')); })()"

URL="$B/#person=$PERSON"
gate() { node scripts/verify/home-gate.mjs "$REPO" "$URL" "$@"; }
gate "$OUT" waiting "$WAITING"
gate "$OUT" draft "$EDITED"
gate "$OUT" phone-only "$PHONE"
GATE_PWA=1 gate "$OUT/installed" waiting "$WAITING"
gate "$OUT" receipts "$TAPS"
GATE_PWA=1 gate "$OUT/installed" receipts "$TAPS"
[ "$(count "SELECT count(*) FROM events WHERE kind='draft.approved'")" = 1 ] || { echo "action-card: a double tap on Copy did not act once" >&2; exit 1; }
[ "$(count "SELECT count(*) FROM events WHERE kind='draft.rejected'")" = 1 ] || { echo "action-card: Discard did not act once" >&2; exit 1; }
[ "$(count "SELECT count(*) FROM events WHERE kind='mail.sent'")" = 0 ] || { echo "action-card: mail went out from the computer" >&2; exit 1; }

mkdir -p "$OUT/paired"
node scripts/verify/action-card-plan.mjs "$LAB" "$OUT" > "$LAB/plan.json"
xvfb-run -a -s '-screen 0 1920x1200x24' node scripts/verify/pwa-shell.mjs "$LAB/plan.json" > "$OUT/paired/run.json"
node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1])); const bad=r.filter(x=>x.error||x.value===false); if(bad.length){console.error(JSON.stringify(bad,null,1));process.exit(1)}' "$OUT/paired/run.json"
sent=$(count "SELECT count(*) FROM events WHERE kind='mail.sent'")
curl -fsS -H 'authorization: Bearer witness' "$GOOGLE/gmail/v1/users/me/messages?labelIds=SENT" > "$LAB/box.json"
box=$(node -pe 'const l=JSON.parse(require("node:fs").readFileSync(process.argv[1])).messages??[]; l.length+" "+(l[0]?.id??"")' "$LAB/box.json")
words=$(curl -fsS -H 'authorization: Bearer witness' "$GOOGLE/gmail/v1/users/me/messages/${box#* }" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).snippet))')
echo "mail.sent events: $sent; messages in emulate's Sent: ${box% *}; emulate's copy says: $words" | tee "$OUT/paired/sent.txt"
[ "$sent" = 1 ] && [ "${box% *}" = 1 ] && [[ "$words" == *"my own words"* ]] || { echo "action-card: a double tap on Send did not send the person's words exactly once" >&2; exit 1; }
node scripts/verify/steps.mjs "$OUT" action-card
