#!/usr/bin/env bash
# An image both ways in Chief's chat (docs/verification/image.md): the person picks a photo with the composer's + (the
# paperclip at desktop width), sees it in the box, sends it with words; Chief hands the job to Video Vic, and Vic's
# picture comes back in Chief's thread.
#   bash scripts/verify/image.sh <repo> <out-dir>
# Real crewd on the stub engine, isolated per docs/verification/runbook.md's Launch (web/dist built first); no account,
# no model, no key. The stub engine reads the calls a turn makes from its words (src/stub-runtime.ts), so the words sent
# carry Chief's hand-off on a second line, and the hand-off carries Vic's two calls: his own sandboxed shell writes the
# picture made here into his files/photos/, then crew_deliver hands it over. The app never shows those calls.
# Proves: the + and the picked photo in the box; the sent photo kept under crewd's own name, byte-checked, and given to
# Chief's model; Vic's delivered picture in Chief's thread; each shown at 390 and 1440, day and night, in a browser tab
# and in the installed app; the look check at 360 with the largest text.
# Needs ImageMagick, chrome-devtools-axi, chromium, xvfb-run, bwrap. Scratch under ~/.cache/fm-scratch, never /tmp.
set -euo pipefail
REPO=$(cd "$1" && pwd); OUT=$(mkdir -p "$2" && cd "$2" && pwd)
SCRATCH=${SCRATCH:-$HOME/.cache/fm-scratch/ch-image-check}; mkdir -p "$SCRATCH"
rm -rf "$OUT/screens" "$OUT/pwa" "$OUT/look"; mkdir -p "$OUT/screens" "$OUT/pwa"
LAB=$(mktemp -d "$SCRATCH/l.XXXX"); mkdir -p "$LAB"/{home,state,crew,tools,run,made,pwa/home/run}
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-ch-image-check}
NODE=$(node -p process.execPath)   # the real binary: a version-manager shim fails under the masked env
log() { printf '%s\n' "$*" | tee -a "$OUT/transcript.txt"; }
: > "$OUT/transcript.txt"

# The person's photo (a phone-sized JPEG, so the app shrinks it to 1280 px) and the picture Vic makes from it.
magick -size 2000x1500 gradient:'#f3e2c7'-'#b98a5a' -fill '#2b2b2b' -draw 'rectangle 940,500 1060,1150' -fill '#e8b04a' \
  -draw 'polygon 760,520 1240,520 1110,260 890,260' -fill '#2b2b2b' -draw 'ellipse 1000,1170 260,50 0,360' -quality 82 "$LAB/made/desk-lamp.jpg"
magick -size 1080x1350 gradient:'#1f2a44'-'#3b5b8c' -fill '#fbf6ee' -draw 'roundrectangle 90,170 990,1180 40,40' \
  -fill '#2b2b2b' -draw 'rectangle 500,470 580,980' -fill '#e8b04a' -draw 'polygon 380,480 700,480 615,300 465,300' \
  -fill '#2b2b2b' -draw 'ellipse 540,990 170,34 0,360' -fill '#fbf6ee' -pointsize 64 -gravity north -annotate +0+50 'Desk lamp' \
  -pointsize 46 -gravity south -annotate +0+60 'Warm light, solid base' PNG8:"$LAB/made/lamp-shop.png"

MASK=(env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" XDG_STATE_HOME="$LAB/home/.local/state"
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache"
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_ENGINE=stub
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools")
PORT=$("$NODE" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
. "$REPO/scripts/verify/crewd-group.sh"
cleanup() { chrome-devtools-axi stop >/dev/null 2>&1 || true; crewhouse_remove_lab "$LAB"; }
trap cleanup EXIT
crewd_start "$REPO" "$OUT/crewd.log" "${MASK[@]}" CREWHOUSE_PORT="$PORT" "$NODE" src/main.ts
wait_for() { for _ in $(seq 1 600); do "$@" >/dev/null 2>&1 && return 0; kill -0 "$CREWD" 2>/dev/null || { log "crewd exited"; tail "$OUT/crewd.log"; exit 1; }; sleep 0.2; done; log "timed out: $*"; api "$B/api/state" > "$OUT/state-at-timeout.json" || true; exit 1; }
ready() { [ -s "$LAB/state/person.key" ] && curl --max-time 10 -fsS "$B/api/state" -H x-crewhouse:1 -H "Authorization: Bearer $(cat "$LAB/state/person.key")" | grep -q '"person"'; }
wait_for ready
KEY=$(<"$LAB/state/person.key")
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $KEY")
api() { curl --max-time 10 -fsS "${H[@]}" "$@"; }
post() { api -X "$1" -d "$3" "$B$2" >/dev/null; }
post PUT /api/people/1 '{"name":"Umer"}'
post POST /api/onboard '{"address":"Umer"}'
post POST /api/recruit '{"template":"reel"}'
CHIEF="$LAB/crew/bots/chief" VIC="$LAB/crew/bots/video-vic"
state_of() { api "$B/api/state" | "$NODE" -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

# The words the person types, and (on the second line, for the stub engine only) the calls the turn makes.
WORDS='Make this into a picture for my shop page.'
CALLS=$("$NODE" -e '
const [png] = process.argv.slice(1), tool = (n, i) => `[tool ${n} ${JSON.stringify(i)}]`;
const vic = `Make the person'"'"'s desk lamp photo into a picture for their shop page. ${tool("bash", { command: `mkdir -p files/photos && echo ${require("fs").readFileSync(png).toString("base64")} | base64 -d > files/photos/lamp-shop.png` })} ${tool("crew_deliver", { path: "files/photos/lamp-shop.png", note: "Your lamp, ready for the shop page" })}`;
// The helper calls ride inside the hand-off string with their [ escaped, so the stub reads them on his turn alone.
process.stdout.write(tool("sessions_send", { sessionKey: "agent:m1:crewhouse:video-vic", message: vic, timeoutSeconds: 0 }).replace(/(?<!^)\[tool /g, "\\u005btool "));' "$LAB/made/lamp-shop.png")
printf '%s' "$(base64 -w0 "$LAB/made/desk-lamp.jpg")" > "$LAB/photo.b64"

ax() { chrome-devtools-axi "$@"; }
ax stop >/dev/null 2>&1 || true; ax pages >/dev/null 2>&1 || true; ax selectpage 1 >/dev/null
ax open "$B/#person=$KEY" >/dev/null
# The picker is the device's own (no file dialog headless), so the photo is staged on the composer's own file input,
# as the dialog would leave it; everything after that is the app's.
cat > "$LAB/stage.js" <<JS
(async () => {
  for (let i = 0; i < 100 && !document.querySelector('.composer input[type=file]'); i++) await new Promise((r) => setTimeout(r, 100));
  document.querySelectorAll('.c-file button').forEach((b) => b.click()); // one pick per shot: a page kept open keeps the last
  await new Promise((r) => setTimeout(r, 100));
  const input = document.querySelector('.composer input[type=file]'), bin = atob('$(cat "$LAB/photo.b64")'), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dt = new DataTransfer(); dt.items.add(new File([bytes], 'desk-lamp.jpg', { type: 'image/jpeg' }));
  input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  const box = document.querySelector('.composer textarea'), set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(box, $(printf '%s' "$WORDS" | "$NODE" -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0, "utf8")))')); box.dispatchEvent(new Event('input', { bubbles: true }));
  for (let i = 0; i < 100 && !document.querySelector('.c-file'); i++) await new Promise((r) => setTimeout(r, 100));
  document.querySelector('.composer').scrollIntoView({ block: 'end' });
  return document.querySelector('.c-files')?.innerText ?? 'no chip';
})()
JS
# The box before the pick: the + at phone width, the paperclip at desktop width.
WIDTHS="1440x900 390x844" bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" image-attach "$B/#/chief" | tee "$OUT/screens.txt"
# The picked photo in the box, before Send.
THEN=$(cat "$LAB/stage.js") bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" image-picked "$B/#/chief" | tee -a "$OUT/screens.txt"
# At 390 (the last shot): the photo's own thumbnail in its chip, the words in the box, and the box, + and Send on the screen.
ax eval '(() => { const c = document.querySelector(".c-file"); if (!c) return "no chip"; const r = c.getBoundingClientRect(), img = c.querySelector("img"), on = (s) => { const e = document.querySelector(s), b = e?.getBoundingClientRect(); return !!b && b.width > 30 && b.left >= 0 && b.right <= innerWidth; }; return { chip: c.innerText.replace(/\s+/g, " "), width: Math.round(r.width), thumb: img ? { w: img.naturalWidth, h: img.naturalHeight, shown: Math.round(img.getBoundingClientRect().width) } : null, words: document.querySelector(".composer textarea").value, onScreen: ["textarea", ".c-clip", ".send"].every((s) => on(".composer " + s)) }; })()' | tee "$OUT/picked-geometry.txt"
P=$(sed 's/\\"/"/g' "$OUT/picked-geometry.txt")
grep -q '"thumb":{"w":1280' <<<"$P" && grep -qF "\"words\":\"$WORDS\"" <<<"$P" && grep -q '"onScreen":true' <<<"$P" || { log "the picked photo, its words or the box's buttons are not all in view"; exit 1; }

# Send, as the person does: the hand-off line goes in under the typed words (stub only), then Enter.
SEND=$(printf '%s' "$WORDS"$'\n'"$CALLS" | "$NODE" -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0, "utf8")))')
cat > "$LAB/send.js" <<JS
(async () => {
  const box = document.querySelector('.composer textarea'), set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(box, $SEND); box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 100));
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  for (let i = 0; i < 100 && document.querySelector('.c-file'); i++) await new Promise((r) => setTimeout(r, 100));
  return !document.querySelector('.c-file');
})()
JS
ax eval "$(cat "$LAB/send.js")" | tee -a "$OUT/transcript.txt"
vic_done() { [ "$(state_of 'j.tasks.find((t)=>t.bot==="video-vic")?.state')" = done ]; }
wait_for vic_done
chief_settled() { case "$(sqlite3 "$LAB/state/crew.db" "SELECT state FROM tasks WHERE bot = 'chief' ORDER BY id DESC LIMIT 1")" in done|unsure|failed) return 0;; esac; return 1; }
wait_for chief_settled
sqlite3 -json "$LAB/state/crew.db" "SELECT id, bot, parent, state, substr(result, 1, 160) AS result FROM tasks ORDER BY id" | tee "$OUT/tasks.json"

# What crewd kept and what came back, from its own records.
SENT=$(find "$CHIEF/files/photos" -type f | head -1)
{ echo "person's line: $(sqlite3 "$LAB/state/crew.db" "SELECT replace(text, char(10), ' | ') FROM messages WHERE bot = 'chief' AND author = 'person'" | cut -c1-200)"
  echo "kept photo: ${SENT#$CHIEF/} — $(magick identify -format '%m %wx%h %b' "$SENT")"
  echo "given to Chief's model: $(sqlite3 "$LAB/state/crew.db" "SELECT data FROM events WHERE kind = 'run.prompted' AND bot = 'chief'")"
  echo "Vic's picture: $(cd "$VIC" && find files -type f | sort | tr '\n' ' ')"
  cmp "$VIC/files/photos/lamp-shop.png" "$LAB/made/lamp-shop.png" && echo "Vic's picture: same bytes as the one made here"
  echo "delivered: $(state_of 'j.events.filter((e)=>e.kind==="file.delivered").map((e)=>e.bot+" "+e.data.path+" — "+e.data.note).join(" | ")')"
  echo "Chief's thread: $(sqlite3 "$LAB/state/crew.db" "SELECT author || ': ' || replace(substr(text, 1, 120), char(10), ' | ') FROM messages WHERE bot = 'chief' ORDER BY id" | tr '\n' '~' | sed 's/~/ ~ /g')"
} | tee "$OUT/records.txt"
sqlite3 "$LAB/state/crew.db" "SELECT text FROM messages WHERE bot = 'chief' AND author = 'person'" | grep -q '^\[photo chief\] files/photos/' || { log "the sent photo is not on the person's line"; exit 1; }
grep -q '"photos":1' "$OUT/records.txt" || { log "Chief's model was not given the photo"; exit 1; }
[ "$(magick identify -format '%m %w' "$SENT")" = "JPEG 1280" ] || { log "the sent photo was not made small as the app makes it"; exit 1; }
grep -q 'same bytes' "$OUT/records.txt" || { log "Vic's picture is not the one made"; exit 1; }

# The thread: the sent photo with its words, then Vic's picture. A browser tab, both widths, day and night.
SHOW='(async () => { for (let i = 0; i < 100 && document.querySelectorAll(".lines img, .chat img").length < 2; i++) await new Promise((r) => setTimeout(r, 100)); await Promise.all([...document.querySelectorAll("img")].map((i) => i.decode().catch(() => 0))); const l = document.querySelector(".lines"); if (l) l.scrollTop = l.scrollHeight; window.scrollTo(0, document.body.scrollHeight); return [...document.querySelectorAll(".media img")].map((i) => i.naturalWidth + "x" + i.naturalHeight); })()'
THEN="$SHOW" bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" image-thread "$B/#/chief" | tee -a "$OUT/screens.txt"
# The person's own line: the words they typed (no call words) with the sent photo, the photo centred.
SENTLINE='(async () => { for (let i = 0; i < 100 && document.querySelectorAll(".media img").length < 2; i++) await new Promise((r) => setTimeout(r, 100)); await Promise.all([...document.querySelectorAll("img")].map((i) => i.decode().catch(() => 0))); document.querySelector(".media img").scrollIntoView({ block: "center" }); return true; })()'
THEN="$SENTLINE" bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" image-sent "$B/#/chief" | tee -a "$OUT/screens.txt"
ax eval '(() => { const l = document.querySelector(".media img").closest(".line"); return l.innerText.trim(); })()' | tee "$OUT/sent-line.txt"
L=$(grep '^result' "$OUT/sent-line.txt"); grep -qF "$WORDS" <<<"$L" && ! grep -q '\[tool\|sessions_send' <<<"$L" || { log "the sent line does not read as the words the person typed"; exit 1; }
ax resize 390 844 >/dev/null; ax open "$B/?day#/chief" >/dev/null; ax eval "$SHOW" >/dev/null
ax eval '(() => [...document.querySelectorAll(".media img")].map((i) => { const r = i.getBoundingClientRect(); return { alt: i.alt, natural: i.naturalWidth + "x" + i.naturalHeight, shown: Math.round(r.width) + "x" + Math.round(r.height), uncropped: getComputedStyle(i).objectFit === "contain" || Math.abs(r.width / r.height - i.naturalWidth / i.naturalHeight) < 0.02, mine: !!i.closest(".me") }; }))()' | tee "$OUT/thread-geometry.txt"
# Exactly two pictures: the person's photo on their own line, and Vic's on Chief's reply (never the person's again).
G=$(sed 's/\\"/"/g' "$OUT/thread-geometry.txt")
[ "$(grep -o '"mine":true' <<<"$G" | wc -l)" = 1 ] && [ "$(grep -o '"mine":false' <<<"$G" | wc -l)" = 1 ] && grep -q '"natural":"1080x1350","shown":"[0-9x]*","uncropped":true,"mine":false' <<<"$G" \
  || { log "the thread does not show the sent photo once and Vic's picture once, uncropped"; exit 1; }

# The installed app, for real (Settings' own Install), at both widths: the photo picked in the box, then the thread.
"$NODE" -e '
const [B, key, LAB, OUT, SK, STAGE, SHOW, SENT] = process.argv.slice(1), url = (q) => `${B}/?${q}#/chief`, steps = [
  { name: "boot", w: 1400, h: 950, dpr: 1, mobile: false, url: `${B}/#person=${key}`, wait: "sessionStorage.getItem(\"crewhouse.person\")?.length === 64", timeout: 30000 },
  { name: "settings", url: `${B}/#/settings`, wait: "!!document.querySelector(\".install .btn\")", timeout: 20000 },
  { name: "install", click: ".install .btn", settle: 3000 }, { name: "sheet", xshot: `${OUT}/pwa/install-sheet.png` },
  { name: "tab", key: "Tab" }, { name: "return", key: "Return", settle: 3000 },
  { name: "attach", attachApp: B },
  { name: "app-authority", url: `${B}/#person=${key}`, reload: true, wait: "sessionStorage.getItem(\"crewhouse.person\")?.length === 64", timeout: 30000 }];
// The thread first, then the picks: a staged pick stays in the box, so it would sit under every later thread shot.
const looks = [["day", 390, 844], ["night", 390, 844], ["day", 1440, 900], ["night", 1440, 900]], at = (w, h) => ({ w, h, dpr: w < 500 ? 2 : 1, mobile: w < 500 });
for (const [look, w, h] of looks) steps.push(
  { name: `thread-${look}-${w}`, ...at(w, h), url: url(look), wait: "document.querySelectorAll(\".media img\").length >= 2", timeout: 20000,
    eval: `(async () => [matchMedia("(display-mode: standalone)").matches, await ${SHOW}])()`, settle: 800, out: `${OUT}/pwa/image-thread-installed-${look}-${w}.png` },
  { name: `sent-${look}-${w}`, ...at(w, h), eval: `(async () => [matchMedia("(display-mode: standalone)").matches, await ${SENT}])()`, settle: 800, out: `${OUT}/pwa/image-sent-installed-${look}-${w}.png` });
for (const [look, w, h] of looks) steps.push({ name: `picked-${look}-${w}`, ...at(w, h), url: url(look), wait: "!!document.querySelector(\".composer textarea\")", timeout: 20000,
  eval: `(async () => [matchMedia("(display-mode: standalone)").matches, await ${STAGE}])()`, settle: 800, out: `${OUT}/pwa/image-picked-installed-${look}-${w}.png` });
console.log(JSON.stringify({ profile: `${LAB}/pwa/profile`, home: `${LAB}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, args: ["--window-size=1400,950", "--force-device-scale-factor=1", "about:blank"], steps }));
' "$B" "$KEY" "$LAB" "$OUT" "$REPO/scripts/verify" "$(cat "$LAB/stage.js")" "$SHOW" "$SENTLINE" > "$LAB/pwa-plan.json"
ax stop >/dev/null 2>&1 || true
xvfb-run -a -s "-screen 0 1920x1200x24" "$NODE" "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/pwa-plan.json" > "$OUT/pwa/run.json" || true
"$NODE" -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("pwa", JSON.stringify(r.filter((x) => "value" in x || x.error).map((x) => ({ ...x, value: typeof x.value === "string" ? x.value.slice(0, 120) : x.value })))); process.exit(r.some((x) => x.error || "value" in x && !(Array.isArray(x.value) && x.value[0] === true && x.value[1])) ? 1 : 0)' "$OUT/pwa/run.json" | tee -a "$OUT/transcript.txt"

# The look check at the hardest size (360 wide, text x1.3, day and night): the thread with both pictures.
EVIDENCE_HOME=${EVIDENCE_HOME:-$OUT} "$NODE" "$REPO/scripts/verify/look-check.mjs" web --out "$OUT/look" --person "$LAB/state/person.key" --then "$SHOW" "image-thread=$B/#/chief" | tee "$OUT/look-check.txt" || log "look-check reported hits (see look/)"
"$NODE" "$REPO/scripts/verify/steps.mjs" "$OUT" image
ls "$OUT/screens" "$OUT/pwa"
