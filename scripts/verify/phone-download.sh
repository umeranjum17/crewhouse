#!/usr/bin/env bash
# done-done journey `phone-download`: the pairing screen's Get-the-app card offers the newest phone preview, and the one
# stable link while the forge cannot be asked. One isolated stub-engine crewd, its Settings › Phones screen at 1440 and
# 390, day and night, twice: the forge answers (the newest preview's arm64-v8a asset wins) and the forge is unresolvable
# in that browser (the stable link stands). Every capture waits for the link it must show, so a pass that reads the wrong
# link fails at that capture; the forge's own answer and the browser's own request record are kept beside the shots.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/phone-download.sh <out-dir>
#
# Needs chrome-devtools-axi on PATH and chromium for the unresolvable-forge browser. Exit 0 with eight PNGs, the forge
# answer (forge-releases.json), both network records and the step record; non-zero otherwise. Never the owner's install
# or person.key, never a real account: the crewd is this script's own and dies with it (crewd-group.sh).
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: phone-download.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
STABLE='https://github.com/umeranjum17/crewhouse/releases/download/phone-preview/crewhouse.apk'
FORGE=${CREWHOUSE_FORGE:-'https://api.github.com/repos/umeranjum17/crewhouse/releases?per_page=20'}
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
LAB=$(mktemp -d -t crewhouse-download.XXXXXX)

mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
case "$(command -v node)" in */mise/shims/*) mkdir "$LAB/bin" && ln -s /usr/bin/node /usr/bin/npm /usr/bin/npx "$LAB/bin/" && export PATH=$LAB/bin:$PATH;; esac # done-done runs with a clean environment, where a version-manager shim fails
free() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
# The phone link is on (a source checkout leaves it off), so Settings › Phones shows the Get-the-app card at all.
PORT=$(free); LINKP=$(free); DEBUGP=$(free)
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" CREWHOUSE_LINK_PORT="$LINKP" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts"
PERSON=""; DEADLINE=$((SECONDS + 60))
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    if curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"'; then break; fi
  fi
  [ "$SECONDS" -ge "$DEADLINE" ] && break
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "phone-download: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
curl -fsS --max-time 10 "${H[@]}" -d '{"address":"Umer"}' "$B/api/onboard" > /dev/null
axi() { timeout -k 10 180 chrome-devtools-axi "$@"; }
# The page picks the same release this script does, from the same forge list, so the drive's expectation is the forge's
# answer and not the app's: newest first, a phone preview's tag, its arm64-v8a asset.
curl -fsS --max-time 20 -H accept:application/vnd.github+json "$FORGE" -o "$OUT/forge-releases.json"
EXPECT=$(node -e '
  const list = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  const rel = (Array.isArray(list) ? list : []).find((x) => !x.draft && /^v\d+\.\d+\.\d+-preview\.\d+\.\d+$/.test(String(x.tag_name)));
  const apk = rel?.assets?.find((a) => /-arm64-v8a\.apk$/i.test(String(a.name)));
  if (!apk) { console.error("phone-download: the forge lists no phone preview with an arm64-v8a asset"); process.exit(1); }
  console.log(String(apk.browser_download_url));' "$OUT/forge-releases.json")
[ "$EXPECT" != "$STABLE" ] || { echo "phone-download: the forge itself answers with the stable link, so this drive proves nothing" >&2; exit 1; }
echo "phone-download: the forge's newest phone preview is $EXPECT" >&2
# A capture waits for the card to read the link it must read, then says so: the wait is the pass's assertion.
then_on() { printf '(async () => { location.hash = "#/settings/phones"; for (let i = 0; i < 200; i++) { const t = document.querySelector("[aria-label=\\"Get the app\\"]")?.innerText ?? ""; if (t.includes(%s)) { %s return t; } await new Promise((r) => setTimeout(r, 100)); } throw new Error("the Get-the-app card never read %s: " + (document.querySelector("[aria-label=\\"Get the app\\"]")?.innerText ?? "no card")); })()' "\"$1\"" "${2:-}" "$1"; }
# The unresolvable-forge browser: its own headless Chromium, its own profile in the lab, the forge's name dead in it.
unresolvable() {
  chromium --headless=new --remote-debugging-port="$DEBUGP" --user-data-dir="$LAB/browser" --no-first-run \
    --no-default-browser-check --host-resolver-rules="MAP api.github.com ~NOTFOUND" about:blank > "$LAB/chromium.log" 2>&1 &
  for _ in $(seq 120); do curl -fsS "http://127.0.0.1:$DEBUGP/json/version" > /dev/null 2>&1 && return 0; sleep 0.25; done
  echo "phone-download: the unresolvable-forge browser never opened its port" >&2; return 1
}
# Shut that browser down through DevTools, the way it asks to be closed: no signal to a process this shell did not spawn.
close_browser() {
  node -e '
    fetch(`http://127.0.0.1:${process.argv[1]}/json/version`).then((r) => r.json()).then((v) => new Promise((ok) => {
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      ws.onclose = () => ok(); setTimeout(ok, 5000);
    })).catch(() => {});' "$DEBUGP" || true
}
finish() { close_browser; [ "$1" = 0 ] || cp "$LAB/crewd.log" "$OUT/crewd-download.log" 2>/dev/null; crewhouse_remove_lab "$LAB"; }
trap 'finish $?' EXIT
URL="$B/#person=$PERSON"
THEN=$(then_on "$EXPECT") bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" download "$URL"
axi network --type fetch > "$OUT/network-live.txt"
grep -q 'api.github.com/repos/umeranjum17/crewhouse/releases.*\[200\]' "$OUT/network-live.txt" || { echo "phone-download: the browser never asked the forge, or the forge did not answer" >&2; exit 1; }
unresolvable
CHROME_DEVTOOLS_AXI_SESSION="$CHROME_DEVTOOLS_AXI_SESSION-no-net" CHROME_DEVTOOLS_AXI_BROWSER_URL="http://127.0.0.1:$DEBUGP" \
  THEN=$(then_on "$STABLE" 'await new Promise((r) => setTimeout(r, 4000));') bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" download-forge-down "$URL"
CHROME_DEVTOOLS_AXI_SESSION="$CHROME_DEVTOOLS_AXI_SESSION-no-net" CHROME_DEVTOOLS_AXI_BROWSER_URL="http://127.0.0.1:$DEBUGP" \
  axi network --type fetch > "$OUT/network-forge-down.txt"
grep -q 'api.github.com/repos/umeranjum17/crewhouse/releases.*\(net::ERR_\|\[0\]\)' "$OUT/network-forge-down.txt" || { echo "phone-download: the forge was not the thing that failed" >&2; exit 1; }
close_browser
node "$REPO/scripts/verify/steps.mjs" "$OUT" phone-download preview="$EXPECT" stable="$STABLE"
echo "phone-download: $(ls "$OUT"/screens/*.png | wc -l) captures in $OUT/screens"
