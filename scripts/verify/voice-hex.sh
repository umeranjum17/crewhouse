#!/usr/bin/env bash
# Hex hears the person's speech on this computer (docs/verification/voice.md): in the installed app, the box's mic records
# and Hex writes the clip down here, so the words land in the box and nothing goes to a cloud service. Nothing is sent
# until the person taps send.
#   bash scripts/verify/voice-hex.sh <out-dir> [hex|missing]
# Real crewd on the stub engine (no account, no model of ours), isolated per docs/verification/runbook.md's Launch,
# web/dist built first. Hex is this computer's real install (~/.local/bin/hex or $CREWHOUSE_HEX) with a real local speech
# model, so the transcript is real local inference. There is no live microphone: Chromium's own fake capture device is fed
# the public whisper.cpp sample (samples/jfk.wav), whose words are known, so the ears are stood in for and nothing else.
# `missing` runs crewd with no Hex at all, for the words the person reads then.
# Needs chromium, xvfb-run. Scratch under ~/.cache/fm-scratch, never /tmp.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd); OUT=$(mkdir -p "$1" && cd "$1" && pwd); WHAT=${2:-hex}
SCRATCH=${SCRATCH:-$HOME/.cache/fm-scratch/ch-voice-hex}; mkdir -p "$SCRATCH" "$OUT/pwa"
WAV=${WAV:-$SCRATCH/jfk.wav}
[ -s "$WAV" ] || curl --max-time 60 -fsSL -o "$WAV" "https://github.com/ggml-org/whisper.cpp/raw/master/samples/jfk.wav"
HEX=${CREWHOUSE_HEX:-$HOME/.local/bin/hex}
LAB=$(mktemp -d "$SCRATCH/l.XXXX"); mkdir -p "$LAB"/{home,state,crew,tools,run,pwa/home/run}
NODE=$(node -p process.execPath)   # the real binary: a version-manager shim fails under the masked env
log() { printf '%s\n' "$*" | tee -a "$OUT/transcript.txt"; }
[ -s "$REPO/web/dist/index.html" ] || { log "build the web app first: npm run build:web"; exit 1; }

MASK=(env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" XDG_STATE_HOME="$LAB/home/.local/state"
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache"
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_ENGINE=stub
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools"
  CREWHOUSE_HEX="$([ "$WHAT" = hex ] && printf %s "$HEX" || printf %s /nonexistent/hex)"
  # Hex keeps the speech model in the person's own data dir; the lab's HOME is throwaway, so name that dir instead.
  HEX_APPLICATION_SUPPORT_DIR="$([ "$WHAT" = hex ] && printf %s "$HOME/.local/share/hex" || printf %s "$LAB/home/.local/share/hex")")
PORT=$("$NODE" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
. "$REPO/scripts/verify/crewd-group.sh"
cleanup() { crewhouse_remove_lab "$LAB"; }
trap cleanup EXIT
crewd_start "$REPO" "$OUT/crewd.log" "${MASK[@]}" CREWHOUSE_PORT="$PORT" "$NODE" src/main.ts
wait_for() { for _ in $(seq 1 600); do "$@" >/dev/null 2>&1 && return 0; kill -0 "$CREWD" 2>/dev/null || { log "crewd exited"; tail "$OUT/crewd.log"; exit 1; }; sleep 0.2; done; log "timed out: $*"; exit 1; }
ready() { [ -s "$LAB/state/person.key" ] && curl --max-time 10 -fsS "$B/api/state" -H x-crewhouse:1 -H "Authorization: Bearer $(cat "$LAB/state/person.key")" | grep -q '"person"'; }
wait_for ready
KEY=$(<"$LAB/state/person.key")
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $KEY")
curl --max-time 10 -fsS "${H[@]}" -X PUT -d '{"name":"Umer"}' "$B/api/people/1" >/dev/null
curl --max-time 10 -fsS "${H[@]}" -X POST -d '{"address":"Umer"}' "$B/api/onboard" >/dev/null

# One headed Chromium with a stand-in microphone: install the app from Settings, then everything in the installed app's
# own window. The look is the app's Auto, following the device's light or dark (`scheme`).
"$NODE" -e '
const [B, key, LAB, OUT, WAV, WHAT, REPO] = process.argv.slice(1);
const LOOKS = [["light", 390, 844], ["dark", 390, 844], ["light", 1440, 900], ["dark", 1440, 900]];
const DAY = { light: "day", dark: "night" };
const BOTTOM = "(() => { const l = document.querySelector(\".lines\"); if (l) l.scrollTop = l.scrollHeight; return matchMedia(\"(display-mode: standalone)\").matches; })()";
const box = "document.querySelector(\".chat .dock textarea\")";
const mic = ".chat .dock .mic";
const SAID = "ask not what your country can do for you";
const steps = [
  { name: "boot", w: 1400, h: 950, dpr: 1, mobile: false, url: `${B}/#person=${key}`, wait: "sessionStorage.getItem(\"crewhouse.person\")?.length === 64", timeout: 30000 },
  { name: "settings", url: `${B}/#/settings`, wait: "!!document.querySelector(\".install .btn\")", timeout: 20000 },
  { name: "install", click: ".install .btn", settle: 3000 },
  { name: "tab", key: "Tab" }, { name: "return", key: "Return", settle: 3000 },
  { name: "attach", attachApp: B },
  { name: "app-authority", url: `${B}/#person=${key}`, reload: true, wait: "sessionStorage.getItem(\"crewhouse.person\")?.length === 64", timeout: 30000 },
];
for (const [n, [scheme, w, h]] of LOOKS.entries()) {
  const slug = `words-${DAY[scheme]}-${w}`;
  steps.push(
    { name: `${slug}-open`, scheme, w, h, dpr: 2, mobile: w < 500, url: `${B}/?r=${n}#/chief`, grant: ["audioCapture"], wait: `!!document.querySelector("${mic}")`, timeout: 20000, settle: 2500, eval: `({ standalone: matchMedia("(display-mode: standalone)").matches, mic: document.querySelector("${mic}")?.getAttribute("aria-label") })` },
    { name: `${slug}-listen`, click: mic, settle: 500, wait: `!!document.querySelector("${mic}.on")`, timeout: 10000, eval: `${box}.placeholder` },
    { name: `${slug}-speak`, eval: `new Promise((r) => setTimeout(r, ${WHAT === "hex" ? 14000 : 3000}))` },
    { name: `${slug}-stop`, click: mic, settle: 500 },
    { name: `${slug}-heard`, wait: WHAT === "hex" ? `${box}.value.includes(${JSON.stringify(SAID)})` : `!!document.querySelector(".toast")`, timeout: 60000, eval: "({ text: document.querySelector(\".chat .dock textarea\").value, toasts: [...document.querySelectorAll(\".toast\")].map((t) => t.textContent) })", out: `${OUT}/pwa/voice-hex-${DAY[scheme]}-${w}.png` },
    { name: `${slug}-settled`, eval: BOTTOM },
  );
}
console.log(JSON.stringify({ profile: `${LAB}/pwa/profile`, home: `${LAB}/pwa/home`, headless: false, xkey: `${REPO}/scripts/verify/xkey.py`, args: [
  "--window-size=1400,950", "--force-device-scale-factor=1", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`, "about:blank"], steps }));
' "$B" "$KEY" "$LAB" "$OUT" "$WAV" "$WHAT" "$REPO" > "$LAB/pwa-plan.json"
xvfb-run -a -s "-screen 0 1920x1200x24" "$NODE" "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/pwa-plan.json" > "$OUT/pwa/run.json" || true
"$NODE" -e '
const want = process.argv[2], r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const fail = [];
for (const x of r.filter((x) => x.error)) { console.log(x.step, JSON.stringify(x.error)); fail.push(`${x.step} failed`); }
for (const { step: n, value } of r.filter((x) => /-(open|listen|heard)$/.test(x.step ?? "") && x.value !== undefined)) {
  const s = n.replace(/-(open|listen|heard)$/, "");
  if (n.endsWith("-open") && value.standalone !== true) fail.push(`${s}: not the installed app`);
  if (n.endsWith("-listen") && value !== "Listening…") fail.push(`${s}: the box does not say it is listening: ${value}`);
  if (n.endsWith("-heard")) {
    if (want === "hex" && !String(value.text ?? "").includes("ask not what your country can do for you")) fail.push(`${s}: box ${JSON.stringify(value.text)}`);
    if (want !== "hex" && !/Speaking here needs Hex/.test(JSON.stringify(value.toasts))) fail.push(`${s}: toasts ${JSON.stringify(value.toasts)}`);
    console.log(s, JSON.stringify(value));
  }
}
if (fail.length) { console.log("FAIL", fail.join("; ")); process.exit(1); }
console.log("PASS", want === "hex" ? "Hex wrote the words down in the box, in the installed app" : "the person reads what to install");' "$OUT/pwa/run.json" "$WHAT" | tee -a "$OUT/transcript.txt"

# What crewd received: the person said nothing yet, so nothing is sent.
curl --max-time 10 -fsS "${H[@]}" "$B/api/bots/chief" > "$OUT/chief.json"
"$NODE" -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), mine = (j.messages ?? []).filter((x) => x.author === "person");
console.log("person messages at crewd:", JSON.stringify(mine.map((x) => x.text)));
if (mine.length) { console.log("FAIL the heard words reached crewd before send"); process.exit(1); }' "$OUT/chief.json" | tee -a "$OUT/transcript.txt"
grep -c "" "$OUT/crewd.log" >/dev/null && grep -iE "^hex:|hex couldn" "$OUT/crewd.log" | tail -3 | tee -a "$OUT/transcript.txt" || true
ls "$OUT/pwa"
