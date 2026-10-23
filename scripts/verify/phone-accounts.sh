#!/usr/bin/env bash
# The phone's "Your AI accounts" row on Home names what is signed in on the computer (docs/verification/phone-accounts.md).
# The pairing lab (pair-lab.sh: stub crewd, its own relay) signs every account out but MiniMax through the computer's
# own Settings call (POST /api/accounts/1/<key>/logout), the emulator pairs by the typed relay code
# (phone-pair-typed.mjs), and Home's row is captured at 390 wide, day and night. Then MiniMax signs out too and the row
# is captured again: with nothing signed in it shows a plain key and keeps "You sign in on the home computer, in Settings."
#
#   SERIAL=emulator-5580 [ACCOUNTS_OTHER=<dir>] bash scripts/verify/phone-accounts.sh <out-dir> <apk>
#
# <out-dir> holds the claimed state (nothing signed in: a plain key, no account's mark) and the step record; the
# MiniMax captures go to ACCOUNTS_OTHER when it is set, else beside them. The emulator is the caller's (started and stopped by them).
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: SERIAL=<emulator> phone-accounts.sh <out-dir> <apk>" >&2; exit 2; }
OUT=$1; APK=$2; : "${SERIAL:?set SERIAL to the emulator}"; OTHER=${ACCOUNTS_OTHER:-$OUT}
VERIFY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$VERIFY_DIR" rev-parse --show-toplevel)
mkdir -p "$OUT" "$OTHER"
adb() { command adb -s "$SERIAL" "$@"; }
ui() { SERIAL=$SERIAL node "$VERIFY_DIR/phone-ui.mjs" "$@"; }
see() { for _ in $(seq "${2:-30}"); do ui texts 2>/dev/null | grep -qE -- "$1" && return 0; sleep 1; done; ui texts >&2 || true; echo "phone-accounts: never saw: $1" >&2; return 1; }

export LAB; LAB=$(mktemp -d -t phone-accounts.XXXXXX)
. "$(dirname "${BASH_SOURCE[0]}")/crewd-group.sh"
trap 'bash "$VERIFY_DIR/pair-lab.sh" down || true; adb shell wm size reset >/dev/null 2>&1 || true; adb shell wm density reset >/dev/null 2>&1 || true; adb shell cmd uimode night no >/dev/null 2>&1 || true; cp "$LAB/crewd.log" "$OTHER/crewd.log" 2>/dev/null || true; crewhouse_remove_lab "$LAB"' EXIT
bash "$VERIFY_DIR/pair-lab.sh" up "$REPO" >/dev/null
. "$LAB/env"
api() { curl -fsS -X "$1" -H x-crewhouse:1 -H 'content-type: application/json' -H "Authorization: Bearer $(cat "$LAB/state/person.key")" "$B$2" ${3:+-d "$3"}; }
# The stub has every account but Grok signed in; sign out all but MiniMax, as Settings › AI accounts does.
for key in $(api GET /api/accounts | node -e 'for (const a of JSON.parse(require("fs").readFileSync(0))) if (a.signedIn && a.account !== "minimax") console.log(a.account)'); do
  api POST "/api/accounts/1/$key/logout" '{}' >/dev/null
done
api GET /api/accounts | node -e 'const l = JSON.parse(require("fs").readFileSync(0)).filter((a) => a.signedIn).map((a) => a.account); if (l.join() !== "minimax") { console.error("signed in:", l); process.exit(1); }'

# 390 wide: 1080 px at density 443.
adb shell wm size 1080x2400; adb shell wm density 443
node "$VERIFY_DIR/phone-pair-typed.mjs" --serial "$SERIAL" --apk "$APK"
ui tap '^Home$' >/dev/null || true
shot() { # $1 file stem, $2 dir, $3 the row's words
  for theme in day night; do
    adb shell cmd uimode night "$([ $theme = night ] && echo yes || echo no)" >/dev/null
    ui texts | grep -q "Your AI accounts" || ui reveal "Your AI accounts" >/dev/null; see "$3" 20; sleep 1
    ui shot "$2/$1-$theme-390.png"
  done
  adb shell cmd uimode night no >/dev/null
}
shot accounts-minimax "$OTHER" ' MiniMax is signed in on the home computer\.$'
api POST /api/accounts/1/minimax/logout '{}' >/dev/null
adb shell am force-stop dev.crewhouse.app; adb shell am start -n dev.crewhouse.app/.MainActivity >/dev/null
see ' Your AI accounts$' 30
shot accounts-none "$OUT" ' You sign in on the home computer, in Settings\.$'
node "$VERIFY_DIR/steps.mjs" "$OUT" phone-accounts
echo "phone-accounts: MiniMax named on Home, then a plain key and the sign-in sentence once nothing is signed in"
