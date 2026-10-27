#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=$(mkdir -p "${1:?evidence directory}" && cd "$1" && pwd)
: "${LAB:?task-owned scratch directory}"
: "${SERIAL:?task-owned emulator serial}"
: "${APK:?task-built release APK}"
: "${ANDROID_USER_HOME:?task-owned Android user home}"
: "${ADB_SERVER_PORT:?task-owned ADB server port}"
: "${ADB_VENDOR_KEYS:?task-generated ADB key path}"
mkdir -p "$OUT"
export LAB_NODE_OPTIONS='--inspect=127.0.0.1:0'
cd "$ROOT"
cleanup() {
  if [ -f "$LAB/link-stall.pid" ] && [ ! -f "$LAB/link-resumed.txt" ]; then
    pid=$(<"$LAB/link-stall.pid")
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -TERM "$pid" 2>/dev/null || true
  fi
  bash scripts/verify/pair-lab.sh down
}
trap cleanup EXIT
bash scripts/verify/pair-lab.sh up "$ROOT" > "$OUT/lab.log" 2>&1
LAB="$LAB" node scripts/verify/phone-pair-link.mjs --serial "$SERIAL" --apk "$APK" --out "$LAB/pair" > "$LAB/pair.log" 2>&1
LAB="$LAB" SERIAL="$SERIAL" OUT="$OUT" node scripts/verify/phone-link-stall.mjs
mkdir -p "$OUT/pwa/shots" "$OUT/pwa/motion"
node scripts/verify/phone-link-stall-pwa-plan.mjs "$LAB" "$OUT/pwa" > "$LAB/pwa-plan.json"
"${FM_MEM_GATE:-$HOME/firstmate/config/fm-mem-gate.sh}" xvfb-run -a -s '-screen 0 1920x1200x24' node scripts/verify/pwa-shell.mjs "$LAB/pwa-plan.json" > "$OUT/pwa-run.json"
node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1])); if(r.some(x=>x.error))process.exit(1)' "$OUT/pwa-run.json"
