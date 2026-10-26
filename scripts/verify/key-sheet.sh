#!/usr/bin/env bash
# done-done journey `key-sheet`: the key sign-in sheet for OpenRouter and MiniMax. A person opens the account's page, pastes a
# (stub) key, the kit checks it, the sheet lists the vendor's live models, they pick the free Flash model (its id carries a colon)
# and the crew uses it. Real crewd and built UI; the kit on its own fake Gateway (scripts/verify/key-sheet.ts), so no model call.
# Day/night at 390 and 1280. Needs chrome-devtools-axi with CHROME_DEVTOOLS_AXI_SESSION set and web/dist built.
#   scripts/verify/key-sheet.sh "$DONE_DONE_EVIDENCE_ROOT"
set -euo pipefail
OUT=$1; mkdir -p "$OUT"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
pick() { chrome-devtools-axi selectpage "$(chrome-devtools-axi pages 2>/dev/null | awk -F, '/^  [0-9]/{gsub(/ /,"",$1);print $1;exit}')" >/dev/null 2>&1 || true; }
ax() { local o; o=$(chrome-devtools-axi "$@" 2>&1) || true; [ -z "${AXLOG:-}" ] || printf "%s\n--> %s\n" "$*" "$o" >> "$AXLOG"; case $o in *"No page is currently selected"*) pick; chrome-devtools-axi "$@" >/dev/null 2>&1 || true;; esac; }
# One fixture per account: the fake Gateway keeps a saved key's provider signed in, so a second account would start signed in.
up() {
  S=$(mktemp -d -t crewhouse-key-sheet.XXXXXX); mkdir -p "$S/home"
  env -i PATH="$PATH" LANG=C.UTF-8 HOME="$S/home" TMPDIR="$S" XDG_STATE_HOME="$S/home/.local/state" XDG_DATA_HOME="$S/home/.local/share" \
    XDG_CONFIG_HOME="$S/home/.config" XDG_CACHE_HOME="$S/home/.cache" XDG_RUNTIME_DIR="$S/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$S/no-bus" \
    CREWHOUSE_CALLBACK_PORT=0 /usr/bin/node "$REPO/scripts/verify/key-sheet.ts" "$REPO" "$S/lab" "$S/ready.json" > "$S/fixture.log" 2>&1 &
  FIX=$!
  for _ in $(seq 120); do [ -s "$S/ready.json" ] && break; sleep 0.5; done
  B=$(node -p "require('$S/ready.json').base"); P=$(<"$S/lab/state/person.key")
  api -X POST -d '{"address":"Umer"}' "$B/api/onboard" >/dev/null
}
down() { [ -z "${S:-}" ] && return 0; ax open about:blank; kill -TERM "$FIX" 2>/dev/null || true; for _ in $(seq 40); do kill -0 "$FIX" 2>/dev/null || break; sleep 0.25; done
  kill -KILL "$FIX" 2>/dev/null || true; crewhouse_remove_lab "$S"; S=; }
trap down EXIT
api() { curl -fsS -H x-crewhouse:1 -H "Authorization: Bearer $P" -H 'content-type: application/json' "$@"; }
click() { ax eval "(()=>{const b=[...document.querySelectorAll('$1')].find(b=>/$2/i.test(b.textContent||b.getAttribute('aria-label')));b.click();return 1})()"; }
nap() { sleep "$(awk "BEGIN{print $1/1000}")"; } # the tool's numeric wait is not honoured, so a pause is the shell's own
fillin() { ax eval "(()=>{const i=document.querySelector('$1');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'$2');i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()"; nap 300; }
pick
n=0
for account in ${ACCOUNTS:-openrouter minimax}; do
  up
  name=OpenRouter; key_page=https://openrouter.ai/keys
  [ "$account" = minimax ] && { name=MiniMax; key_page=https://platform.minimax.io/user-center/basic-information/interface-key; }
  for theme in day night; do for w in 390 1280; do
    n=$((n+1)); h=844; [ "$w" = 1280 ] && h=900; t="$account-$theme-$w"
    api -X POST -d '{}' "$B/api/accounts/1/$account/logout" >/dev/null
    ax open about:blank; ax resize "$w" "$h"; ax open "$B/?r=$n&$theme#person=$P"; nap 1500
    click 'button' "^Sign in with $name"; ax wait "Paste the key from your"
    # The sheet must name where a key comes from: a person who has never made one has nothing to paste otherwise.
    ax wait "Get a $name key"
    href=$(ax eval "(()=>{const a=[...document.querySelectorAll('a')].find(a=>/^Get a .* key/.test((a.textContent||'').trim()));return a?a.href:''})()" 2>/dev/null | grep -oE 'https?://[^" ]+' | head -1)
    case "$href" in "$key_page"*) ;; *) echo "$account: the key sheet links '$href', wanted '$key_page'" >&2; exit 1;; esac
    ax screenshot "$OUT/key-sheet-1-key-$t.png"
    fillin 'input[type=password]' stub-key-not-real
    click 'form .btn' "Sign in with $name"; ax wait "Which model should"
    [ -z "${AXLOG:-}" ] || ax eval "document.body.innerText.slice(0,400)"
    ax screenshot "$OUT/key-sheet-2-models-$t.png"
    if [ "$account" = openrouter ]; then
      fillin 'input[aria-label="Search models"]' flash
      ax screenshot "$OUT/key-sheet-3-search-$t.png"; want='minimax/minimax-m3.1-flash:free'; pat=free
    else want='MiniMax-M3.1-Flash'; pat='M3.1 Flash'; fi
    click '.model-pick .pick' "$pat"; nap 300
    click '.btn' 'Use this model'; nap 1500
    picked=$(api "$B/api/accounts/1/$account/model" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).picked")
    [ "$picked" = "$want" ] || { echo "$account picked '$picked', wanted '$want'" >&2; exit 1; }
    ax screenshot "$OUT/key-sheet-4-signed-in-$t.png"
  done; done
  down
done
ls "$OUT"/key-sheet-*.png | wc -l | grep -qx 28 || { echo "unexpected shot count" >&2; exit 1; }
node "$REPO/scripts/verify/steps.mjs" "$OUT" key-sheet
