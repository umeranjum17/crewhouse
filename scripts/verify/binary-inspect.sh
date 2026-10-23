#!/usr/bin/env bash
# done-done journey `binary-inspect`: one isolated crewd on the stub engine, with Byte (the helper that explains how
# the person's own app works) on the crew and a small binary in Byte's own folder. Byte looks inside it with the
# inspector, and the note the person reads holds what the inspector found. The file is never run, nothing is written,
# and a file from outside Byte's own folder is refused.
#
#   scripts/verify/binary-inspect.sh <out-dir>
#
# Exit 0 when the note holds the inspector's own words and the file outside the folder was refused; non-zero
# otherwise. Needs the inspector's programs (file, strings, readelf, nm), bubblewrap and a C compiler for the fixture.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: binary-inspect.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
NODE=$(node -p process.execPath)   # the real binary: a version-manager shim fails under the masked env
. "$REPO/scripts/verify/crewd-group.sh"
LAB=${BINARY_INSPECT_LAB:-$(mktemp -d -t crewhouse-binary-inspect.XXXXXX)}
trap 'crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
PORT=$("$NODE" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  "$NODE" "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "binary-inspect: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 60 "${H[@]}" "$@"; }
api -X POST -d '{"address":"Umer"}' "$B/api/onboard" > /dev/null
api -X POST -d '{"template":"reverse","name":"Byte"}' "$B/api/recruit" > /dev/null
# A small binary in Byte's own folder: a tiny program of our own, never the person's.
cat > "$LAB/tiny.c" <<'EOF'
static long sys_exit(long code) { long ret; __asm__ volatile("syscall" : "=a"(ret) : "a"(60L), "D"(code) : "rcx", "r11", "memory"); return ret; }
void _start(void) { sys_exit(0); }
EOF
cc -nostdlib -static -Wl,--build-id=none -o "$LAB/crew/bots/byte/files/app.bin" "$LAB/tiny.c" 2> "$OUT/fixture.log" \
  || { echo "binary-inspect: no C compiler here, so no fixture" >&2; exit 1; }
# Byte looks inside it: the helper names the check, the tool runs the program.
api -X POST -d '{"text":"Look inside the app I gave you [tool crew_inspect {\"path\":\"files/app.bin\",\"what\":\"type\"}]"}' "$B/api/bots/byte/messages" > /dev/null
settled() {
  for _ in $(seq 120); do
    S=$(api "$B/api/bots/byte" | "$NODE" -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")); process.stdout.write(String(t.tasks?.[0]?.state ?? ""))')
    case "$S" in done|failed|unsure|paused) return 0;; esac
    sleep 0.5
  done
  return 1
}
settled || { echo "binary-inspect: Byte's job did not settle" >&2; exit 1; }
[ "$S" = done ] || { echo "binary-inspect: Byte's job ended $S, not done" >&2; exit 1; }
# What the inspector found, as the helper read it.
FOUND=$(api "$B/api/bots/byte" | "$NODE" -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const said = (t.messages ?? []).map((m) => String(m.text ?? "")).filter((x) => x.includes("crew_inspect said ")).at(-1) ?? "";
  const at = said.indexOf("crew_inspect said "); if (at < 0) process.exit(1);
  process.stdout.write(JSON.parse(said.slice(at + "crew_inspect said ".length)));')
[ -n "$FOUND" ] || { echo "binary-inspect: the helper never read what the inspector found" >&2; exit 1; }
# The note the person reads is the inspector's own words.
api -X POST -d "$("$NODE" -e 'process.stdout.write(JSON.stringify({ text: "Here is what the inspector found [tool crew_deliver " + JSON.stringify({ path: "files/app.bin", note: process.argv[1] }) + "]" }))' "$FOUND")" "$B/api/bots/byte/messages" > /dev/null
settled || { echo "binary-inspect: Byte's second job did not settle" >&2; exit 1; }
[ "$S" = done ] || { echo "binary-inspect: Byte's second job ended $S, not done" >&2; exit 1; }
# The app on the same lab, so the capture shows the note the person reads.
if [ -n "${CHROME_DEVTOOLS_AXI_SESSION:-}" ]; then
  export THEN='(async () => { location.hash = "#/h/byte"; for (let i = 0; i < 80 && !document.querySelector(".lines"); i++) await new Promise((r) => setTimeout(r, 100)); return true; })()'
  bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" byte "$B/#person=$PERSON" || echo "binary-inspect: the capture failed" >&2
fi
# A file from outside Byte's own folder is refused: the inspector reads nothing else.
api -X POST -d '{"text":"And the other one [tool crew_inspect {\"path\":\"../../../etc/passwd\",\"what\":\"type\"}]"}' "$B/api/bots/byte/messages" > /dev/null
for _ in $(seq 120); do
  R=$(api "$B/api/bots/byte" | "$NODE" -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")); process.stdout.write(String(t.messages?.at(-1)?.text ?? ""))')
  case "$R" in *"not in your own folder"*) break;; esac
  sleep 0.5
done
api "$B/api/bots/byte" > "$OUT/thread.json" || true
api "$B/api/state" > "$OUT/state.json" || true
api "$B/api/events?after=0" > "$OUT/events.json" || true
"$NODE" -e 'const t = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")), say = (t.messages ?? []).map((m) => String(m.text ?? "")).join("\n"), found = process.argv[2];
  if (!say.includes(found)) { console.error("binary-inspect: the note does not hold what the inspector found:\n" + say.slice(0, 600)); process.exit(1); }
  if (!/ELF 64-bit/.test(found)) { console.error("binary-inspect: the inspector did not find an ELF header"); process.exit(1); }
  if (!/not in your own folder/.test(say)) { console.error("binary-inspect: a file outside the helper'"'"'s own folder was not refused"); process.exit(1); }
  console.log("binary-inspect: the note holds the inspector'"'"'s own words (" + found.slice(0, 60) + "…), and the file outside the folder was refused");' "$OUT/thread.json" "$FOUND"
"$NODE" "$REPO/scripts/verify/steps.mjs" "$OUT" binary-inspect
