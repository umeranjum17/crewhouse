#!/usr/bin/env bash
# Voice with Chief (docs/verification/voice.md): in the installed app, the person taps the mic in Chief's box and speaks;
# the words land in the box and nothing is sent until they tap send. Then Talk: what they say is sent when they stop,
# Chief's reply is read aloud a sentence at a time, the mic opens again, Stop ends the call.
#   bash scripts/verify/voice.sh <out-dir>
# Real crewd on the stub engine (CREWHOUSE_STUB_GOLDEN scripts Chief's replies; no account, no model), isolated per
# docs/verification/runbook.md's Launch, web/dist built first. No microphone and no speaker: the device's ears and voices
# are scripts/verify/voice-device.js, fed words as text, and every sentence read aloud is logged as text, never played.
# Proves: the mic listening, the heard words in the box with nothing sent, the call listening, Chief's reply being read
# (its line marked) and the device's voice and speed, at 390 and 1440, day and night, in the installed app; what crewd
# received (each said thing once) and what was read aloud; the same mic on a recognizer shaped like Safari's (iPad and
# iPhone), which hears as the online one; and what this host's own Chromium offers with no stand-in.
# Needs chromium, xvfb-run, ImageMagick. Scratch under ~/.cache/fm-scratch, never /tmp.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd); OUT=$(mkdir -p "$1" && cd "$1" && pwd)
SCRATCH=${SCRATCH:-$HOME/.cache/fm-scratch/ch-voice-check}; mkdir -p "$SCRATCH" "$OUT/pwa"
LAB=$(mktemp -d "$SCRATCH/l.XXXX"); mkdir -p "$LAB"/{home,state,crew,tools,run,pwa/home/run}
NODE=$(node -p process.execPath)   # the real binary: a version-manager shim fails under the masked env
log() { printf '%s\n' "$*" | tee -a "$OUT/transcript.txt"; }
[ -s "$REPO/web/dist/index.html" ] || { log "build the web app first: npm run build:web"; exit 1; }

MASK=(env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" XDG_STATE_HOME="$LAB/home/.local/state"
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache"
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_ENGINE=stub CREWHOUSE_STUB_GOLDEN=1
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools")
PORT=$("$NODE" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
. "$REPO/scripts/verify/crewd-group.sh"
cleanup() { crewd_stop || exit 1; chmod -R u+w "$LAB" 2>/dev/null || true; rm -rf "$LAB"; }
trap cleanup EXIT
crewd_start "$REPO" "$OUT/crewd.log" "${MASK[@]}" CREWHOUSE_PORT="$PORT" "$NODE" src/main.ts
wait_for() { for _ in $(seq 1 600); do "$@" >/dev/null 2>&1 && return 0; kill -0 "$CREWD" 2>/dev/null || { log "crewd exited"; tail "$OUT/crewd.log"; exit 1; }; sleep 0.2; done; log "timed out: $*"; exit 1; }
ready() { [ -s "$LAB/state/person.key" ] && curl --max-time 10 -fsS "$B/api/state" -H x-crewhouse:1 -H "Authorization: Bearer $(cat "$LAB/state/person.key")" | grep -q '"person"'; }
wait_for ready
KEY=$(<"$LAB/state/person.key")
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $KEY")
curl --max-time 10 -fsS "${H[@]}" -X PUT -d '{"name":"Umer"}' "$B/api/people/1" >/dev/null
curl --max-time 10 -fsS "${H[@]}" -X POST -d '{"address":"Umer"}' "$B/api/onboard" >/dev/null

# One headed Chromium: install the app from Settings, then everything in the installed app's own window. The look is
# the app's Auto, following the device's light or dark (`scheme`), so a call carries on across all four looks.
"$NODE" -e '
const [B, key, LAB, OUT, SK] = process.argv.slice(1), fs = require("fs"), device = fs.readFileSync(`${SK}/voice-device.js`, "utf8");
const LOOKS = [["light", 390, 844], ["dark", 390, 844], ["light", 1440, 900], ["dark", 1440, 900]];
const DAY = { light: "day", dark: "night" };
// Chief`s thread at its newest line, and the box in view.
const BOTTOM = "(() => { const l = document.querySelector(\".lines\"); if (l) l.scrollTop = l.scrollHeight; window.scrollTo(0, document.body.scrollHeight); return matchMedia(\"(display-mode: standalone)\").matches; })()";
const shots = (slug) => LOOKS.map(([scheme, w, h]) => ({ name: `${slug}-${DAY[scheme]}-${w}`, scheme, w, h, dpr: w < 500 ? 2 : 1, mobile: w < 500, eval: BOTTOM, out: `${OUT}/pwa/${slug}-${DAY[scheme]}-${w}.png` }));
const box = "document.querySelector(\".chat .dock textarea\")";
const steps = [
  { name: "boot", w: 1400, h: 950, dpr: 1, mobile: false, url: `${B}/#person=${key}`, wait: "sessionStorage.getItem(\"crewhouse.person\")?.length === 64", timeout: 30000 },
  { name: "settings", url: `${B}/#/settings`, wait: "!!document.querySelector(\".install .btn\")", timeout: 20000 },
  { name: "install", click: ".install .btn", settle: 3000 }, { name: "sheet", xshot: `${OUT}/pwa/install-sheet.png` },
  { name: "tab", key: "Tab" }, { name: "return", key: "Return", settle: 3000 },
  { name: "attach", attachApp: B },
  { name: "app-authority", url: `${B}/#person=${key}`, reload: true, wait: "sessionStorage.getItem(\"crewhouse.person\")?.length === 64", timeout: 30000 },
  // This host`s own Chromium, no stand-in: what it offers in the box (no microphone or voice here).
  { name: "host-as-is", scheme: "light", w: 390, h: 844, dpr: 2, mobile: true, url: `${B}/?r=0#/chief`, wait: "!!document.querySelector(\".chat .dock .send\")", timeout: 20000, settle: 3000,
    eval: "({ standalone: matchMedia(\"(display-mode: standalone)\").matches, recognizer: typeof (window.SpeechRecognition ?? window.webkitSpeechRecognition), check: typeof (window.SpeechRecognition ?? window.webkitSpeechRecognition)?.available, voices: speechSynthesis.getVoices().length, mic: document.querySelector(\".chat .dock .mic\")?.getAttribute(\"aria-label\") ?? \"no mic\", talk: !!document.querySelector(\".send.talk\") })",
    out: `${OUT}/pwa/voice-host-as-is-day-390.png` },
  { name: "host-mic", grant: ["audioCapture"], click: ".chat .dock .mic", settle: 500, wait: "!!document.querySelector(\".toast\") && !document.querySelector(\".mic.on\")", timeout: 30000,
    eval: "[...document.querySelectorAll(\".toast\")].map((t) => t.textContent)", out: `${OUT}/pwa/voice-host-mic-day-390.png` },
  // The stand-in device from here on.
  { name: "device", inject: device, url: `${B}/?r=1#/chief`, wait: "!!document.querySelector(\".chat .dock .mic:not(.off)\") && !!window.ctl", timeout: 20000 },
  { name: "mic", click: ".chat .dock .mic", settle: 500, wait: "!!document.querySelector(\".chat .dock .mic.on\")", timeout: 10000 },
  ...shots("voice-mic-listening"),
  { name: "speak", eval: "ctl.heard(\"hi\", true)" },
  { name: "heard", wait: `${box}.value === "hi" && !document.querySelector(".mic.on")`, timeout: 10000 },
  ...shots("voice-heard-in-box"),
  { name: "sent-only-on-tap", eval: "fetch(\"/api/bots/chief\", { headers: { \"x-crewhouse\": \"1\", authorization: \"Bearer \" + sessionStorage.getItem(\"crewhouse.person\") } }).then((r) => r.json()).then((j) => JSON.stringify(j).includes(\"\\\"hi\\\"\"))" },
  { name: "send", click: ".chat .dock button.send", settle: 500, wait: "document.body.innerText.includes(\"What would you like to work on?\")", timeout: 20000 },
  { name: "talk", click: ".chat .dock button.send.talk", settle: 500, wait: "!!document.querySelector(\".call.listening\")", timeout: 10000 },
  ...shots("voice-call-listening"),
  { name: "say", eval: "(ctl.hold(), ctl.heard(\"i want to market my app\", true))" },
  { name: "reading", wait: "!!document.querySelector(\".call.speaking\") && !!document.querySelector(\".line.reading\") && document.getAnimations().every((a) => a.playState !== \"running\" || a.effect?.getComputedTiming().iterations === Infinity)", timeout: 20000,
    eval: "getComputedStyle(document.querySelector(\".line.reading > .bubble-text\")).borderLeft" },
  ...shots("voice-call-speaking"),
  { name: "voice-menu", click: ".call-voice summary", settle: 500 },
  ...shots("voice-call-voice"),
  { name: "read-on", eval: "(document.querySelector(\".call-voice\").open = false, ctl.go())" },
  { name: "listening-again", wait: "!!document.querySelector(\".call.listening\") && ctl.said.length === 2", timeout: 20000 },
  { name: "stop", click: ".call-stop", settle: 500, wait: "!document.querySelector(\".call\") && /Call ended/.test(document.body.innerText)", timeout: 10000,
    scheme: "light", w: 390, h: 844, dpr: 2, mobile: true, out: `${OUT}/pwa/voice-call-ended-day-390.png` },
  { name: "read-aloud", eval: "ctl.said" },
  // A recognizer shaped like Safari`s (every iPad and iPhone browser): no check of where it hears.
  { name: "safari", inject: "delete window.SpeechRecognition.available; delete window.SpeechRecognition.install;", url: `${B}/?r=2#/chief`, wait: "!!document.querySelector(\".chat .dock .mic:not(.off)\")", timeout: 20000 },
  { name: "safari-mic", click: ".chat .dock .mic", settle: 300, wait: "!!document.querySelector(\".chat .dock .mic.on\") && /online service/.test(document.body.innerText)", timeout: 10000, out: `${OUT}/pwa/voice-safari-online-day-390.png` },
  { name: "safari-speak", eval: "ctl.heard(\"Remind me to call the bank at five\", true)" },
  { name: "safari-heard", wait: `${box}.value === "Remind me to call the bank at five" && !document.querySelector(".mic.on") && document.getAnimations().every((a) => a.playState !== "running")`, timeout: 10000, eval: BOTTOM, out: `${OUT}/pwa/voice-safari-heard-day-390.png` },
];
console.log(JSON.stringify({ profile: `${LAB}/pwa/profile`, home: `${LAB}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, args: ["--window-size=1400,950", "--force-device-scale-factor=1", "about:blank"], steps }));
' "$B" "$KEY" "$LAB" "$OUT" "$REPO/scripts/verify" > "$LAB/pwa-plan.json"
xvfb-run -a -s "-screen 0 1920x1200x24" "$NODE" "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/pwa-plan.json" > "$OUT/pwa/run.json" || true
"$NODE" -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), v = (n) => r.find((x) => x.step === n)?.value;
for (const x of r.filter((x) => "value" in x || x.error)) console.log(x.step, JSON.stringify(x.value ?? x.error));
const said = v("read-aloud") ?? [], fail = [];
if (r.some((x) => x.error)) fail.push("a step failed");
if (!/^2px solid/.test(v("reading") ?? "")) fail.push("the line being read is not marked: " + v("reading"));
if (v("sent-only-on-tap") !== false) fail.push("the heard words reached crewd before send");
if (r.some((x) => /-(day|night)-\d+$/.test(x.step ?? "") && x.value === false)) fail.push("a shot outside the installed app");
if (JSON.stringify(said) !== JSON.stringify(["I can help market it. @Daniel x1", "Send the site so I can see the product and audience before drafting a plan. @Daniel x1"])) fail.push("read aloud: " + JSON.stringify(said));
if (fail.length) { console.log("FAIL", fail.join("; ")); process.exit(1); }' "$OUT/pwa/run.json" | tee -a "$OUT/transcript.txt"

# What crewd received: each thing said once, in order, and Chief's replies.
curl --max-time 10 -fsS "${H[@]}" "$B/api/bots/chief" > "$OUT/chief.json"
"$NODE" -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), m = (j.messages ?? []).map((x) => `${x.author}: ${x.text}`);
console.log("chief thread:\n  " + m.join("\n  "));
const mine = (j.messages ?? []).filter((x) => x.author === "person").map((x) => x.text);
if (JSON.stringify(mine) !== JSON.stringify(["hi", "i want to market my app"])) { console.log("FAIL person messages: " + JSON.stringify(mine)); process.exit(1); }' "$OUT/chief.json" | tee -a "$OUT/transcript.txt"
"$NODE" "$REPO/scripts/verify/steps.mjs" "$OUT" voice
ls "$OUT/pwa"
