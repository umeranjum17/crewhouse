#!/usr/bin/env bash
# done-done journey `versions` (needs Xvfb for the installed app): which Crewhouse runs, in small print
# (docs/verification/versions.md). The CLI's --version and its help header; Settings' foot in the web app at 390 and
# 1280, day and night, and in the installed app; with SERIAL and an APK, the phone's Home footer and This phone settings.
# Two pairing labs (pair-lab.sh, stub engine): this checkout, where the web app and the computer agree ("Crewhouse
# 0.1.1-dev"), and a lab copy of it one release ahead (its package version bumped, the same built web app), where the
# web app and the phone say "App … · Host …" and Settings adds the hint.
#
#   [SERIAL=emulator-5580 APK=<lab release apk>] scripts/verify/versions.sh <out-dir>
#
# Exit 0 with the captures and the step record; each page waits for its own words, so a missing line fails the run.
# The emulator is the caller's (started and stopped by them); this script stops only the labs it started.
set -euo pipefail
[ $# -eq 1 ] || { echo "usage: [SERIAL=<emulator> APK=<apk>] versions.sh <out-dir>" >&2; exit 2; }
OUT=$1; mkdir -p "$OUT"
VERIFY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$VERIFY_DIR" rev-parse --show-toplevel)
ROOT=$(mktemp -d -t crewhouse-versions.XXXXXX)
case "$(command -v node)" in */mise/shims/*) mkdir "$ROOT/bin" && ln -s /usr/bin/node /usr/bin/npm /usr/bin/npx "$ROOT/bin/" && export PATH=$ROOT/bin:$PATH;; esac
trap 'for l in "$ROOT"/lab-*; do [ -d "$l" ] && LAB=$l bash "$VERIFY_DIR/pair-lab.sh" down || true; done; [ -z "${SERIAL:-}" ] || { adb -s "$SERIAL" shell wm size reset; adb -s "$SERIAL" shell wm density reset; adb -s "$SERIAL" shell cmd uimode night no; } >/dev/null 2>&1 || true; chmod -R u+w -- "$ROOT" && rm -rf -- "$ROOT"' EXIT
(cd "$REPO" && npm run -s build:web)
NOW=$(node -p "require('$REPO/package.json').version")
NEXT=$(node -p "'$NOW'.replace(/\\d+\$/, (n) => +n + 1)")

# The CLI: --version, and the help header a mistyped command prints (it exits 2).
"$REPO/crewhouse" --version > "$OUT/cli-version.txt"
"$REPO/crewhouse" help > "$OUT/cli-help.txt" || [ $? -eq 2 ]
grep -qx "Crewhouse $NOW-dev" "$OUT/cli-version.txt" && head -1 "$OUT/cli-help.txt" | grep -qx "Crewhouse $NOW-dev" \
  || { echo "versions: the CLI did not say Crewhouse $NOW-dev" >&2; exit 1; }

# The newer computer: what crewd and the pairing lab read, copied, with the package version one release on.
COPY=$ROOT/next; mkdir -p "$COPY/web"
for part in src templates tools skills scripts crewhouse package.json; do cp -r "$REPO/$part" "$COPY/"; done
cp -r "$REPO/web/dist" "$REPO/web/src" "$COPY/web/"; mkdir -p "$COPY/relay" && cp "$REPO"/relay/*.ts "$COPY/relay/"
ln -s "$REPO/node_modules" "$COPY/node_modules"
node -e "const f='$COPY/package.json', p=JSON.parse(require('fs').readFileSync(f)); p.version='$NEXT'; require('fs').writeFileSync(f, JSON.stringify(p, null, 2))"

# Settings, scrolled to its foot, in a headless browser: `<lab> <words the foot must hold>`.
web() {
  local name=$1 want=$2 K steps
  K=$(cat "$LAB/state/person.key")
  steps="{ \"name\": \"boot\", \"w\": 390, \"h\": 844, \"url\": \"$B/?day#person=$K\", \"settle\": 1500, \"wait\": \"!location.hash.startsWith('#person')\", \"timeout\": 20000 }"
  for theme in day night; do for w in 390 1280; do
    local phone=$([ "$w" = 390 ] && echo true || echo false)
    steps+=", { \"name\": \"$name-$theme-$w\", \"w\": $w, \"h\": $([ "$w" = 390 ] && echo 844 || echo 800), \"dpr\": $([ "$w" = 390 ] && echo 3 || echo 1), \"mobile\": $phone,
      \"url\": \"$B/?$theme&r=$RANDOM#/settings\", \"settle\": 1200, \"timeout\": 20000,
      \"wait\": \"(document.querySelector('.versions')?.textContent ?? '').includes('$want')\",
      \"eval\": \"(() => { const v = document.querySelector('.versions'); v.scrollIntoView({ block: 'center', behavior: 'instant' }); return v.textContent; })()\", \"out\": \"$OUT/web-$name-$theme-$w.png\" }"
  done; done
  echo "{ \"profile\": \"$LAB/web-profile\", \"home\": \"$LAB/web-home\", \"steps\": [ $steps ] }" > "$LAB/web.json"
  node "$VERIFY_DIR/pwa-shell.mjs" "$LAB/web.json" | sed "s|$K|<key>|g" > "$OUT/web-$name.json" || { echo "versions: Settings never said $want (web-$name.json)" >&2; exit 1; }
}

# The phone, paired to the lab: Home's footer and This phone settings' foot, day and night at 390 wide.
phone() {
  local name=$1 want=$2 hint=$3
  [ -n "${SERIAL:-}" ] && [ -n "${APK:-}" ] || return 0
  ui() { SERIAL=$SERIAL node "$VERIFY_DIR/phone-ui.mjs" "$@"; }
  see() { for _ in $(seq 30); do ui texts 2>/dev/null | grep -qF -- "$1" && return 0; sleep 1; done; ui texts >&2 || true; echo "versions: the phone never said: $1" >&2; return 1; }
  adb -s "$SERIAL" shell wm size 1080x2400; adb -s "$SERIAL" shell wm density 443
  node "$VERIFY_DIR/phone-pair-typed.mjs" --serial "$SERIAL" --apk "$APK"
  for theme in day night; do
    adb -s "$SERIAL" shell cmd uimode night "$([ $theme = night ] && echo yes || echo no)" >/dev/null
    ui reveal "$want" >/dev/null 2>&1 || true; ui reveal "$want" >/dev/null 2>&1 || true; see "$want"; sleep 1
    ui shot "$OUT/phone-home-$name-$theme-390.png"
  done
  adb -s "$SERIAL" shell cmd uimode night no >/dev/null
  # Home's gear sits at the top: reopen the app there, then open This phone settings.
  adb -s "$SERIAL" shell am force-stop dev.crewhouse.app; adb -s "$SERIAL" shell am start -n dev.crewhouse.app/.MainActivity >/dev/null
  see 'Settings'; ui tap '^Settings$' >/dev/null; see 'This phone'
  for theme in day night; do
    adb -s "$SERIAL" shell cmd uimode night "$([ $theme = night ] && echo yes || echo no)" >/dev/null
    ui reveal "$want" >/dev/null 2>&1 || true; ui reveal "$want" >/dev/null 2>&1 || true; see "$want"; [ -z "$hint" ] || see "$hint"; sleep 1
    ui shot "$OUT/phone-settings-$name-$theme-390.png"
  done
  adb -s "$SERIAL" shell cmd uimode night no >/dev/null
  adb -s "$SERIAL" shell am force-stop dev.crewhouse.app
}

APP=$(node -p "require('$REPO/mobile/app.json').expo.version")
lab() { export LAB=$ROOT/lab-$1; bash "$VERIFY_DIR/pair-lab.sh" up "$2" >/dev/null; . "$LAB/env"
  curl -fsS -H x-crewhouse:1 -H content-type:application/json -H "Authorization: Bearer $(cat "$LAB/state/person.key")" -d '{"address":"Umer"}' "$B/api/onboard" >/dev/null; }

lab same "$REPO"
web same "Crewhouse $NOW-dev"
phone same "App $APP · Host $NOW-dev" ''
# The installed app: Chromium's own install from Settings, then Settings' foot in its window.
K=$(cat "$LAB/state/person.key"); FOOT="(() => { const v = document.querySelector('.versions'); v.scrollIntoView({ block: 'center', behavior: 'instant' }); return v.textContent; })()"
cat > "$LAB/pwa.json" <<JSON
{ "profile": "$LAB/pwa/profile", "home": "$LAB/pwa/home", "headless": false, "xkey": "$VERIFY_DIR/xkey.py",
  "args": ["--window-size=1280,900", "--force-device-scale-factor=1", "about:blank"],
  "steps": [
    { "name": "boot", "url": "$B/?day#person=$K", "settle": 3000 },
    { "name": "settings", "url": "$B/?day#/settings", "settle": 2500 },
    { "name": "install", "click": ".install .btn" },
    { "name": "tab", "key": "Tab" }, { "name": "enter", "key": "Return" },
    { "name": "attach", "attachApp": "$B" },
    { "name": "standalone", "win": [1280, 900], "url": "$B/?day#/settings", "settle": 2500, "wait": "matchMedia('(display-mode: standalone)').matches && !!document.querySelector('.versions')", "timeout": 20000, "eval": "$FOOT", "out": "$OUT/pwa-same-day-1280.png" },
    { "name": "night", "url": "$B/?night#/settings", "settle": 2500, "wait": "!!document.querySelector('.versions')", "timeout": 20000, "eval": "$FOOT", "out": "$OUT/pwa-same-night-1280.png" },
    { "name": "day-390", "w": 390, "h": 844, "dpr": 3, "mobile": true, "url": "$B/?day#/settings", "settle": 2500, "wait": "!!document.querySelector('.versions')", "timeout": 20000, "eval": "$FOOT", "out": "$OUT/pwa-same-day-390.png" },
    { "name": "night-390", "url": "$B/?night#/settings", "settle": 2500, "wait": "matchMedia('(display-mode: standalone)').matches", "timeout": 20000, "eval": "$FOOT", "out": "$OUT/pwa-same-night-390.png" }
  ] }
JSON
mkdir -p "$LAB/pwa"
xvfb-run -a -s "-screen 0 1920x1200x24" node "$VERIFY_DIR/pwa-shell.mjs" "$LAB/pwa.json" | sed "s|$K|<key>|g" > "$OUT/pwa-same.json" \
  || { echo "versions: the installed app did not show Settings' foot (pwa-same.json)" >&2; exit 1; }
cp "$LAB/crewd.log" "$OUT/crewd-same.log"; bash "$VERIFY_DIR/pair-lab.sh" down

lab next "$COPY"
web next "App $NOW · Host $NEXT-dev"
phone next "App $APP · Host $NEXT-dev" 'Update the app.'
cp "$LAB/crewd.log" "$OUT/crewd-next.log"; bash "$VERIFY_DIR/pair-lab.sh" down
node "$VERIFY_DIR/steps.mjs" "$OUT" versions
echo "versions: CLI says Crewhouse $NOW-dev; $(ls "$OUT"/*.png | wc -l) captures in $OUT"
