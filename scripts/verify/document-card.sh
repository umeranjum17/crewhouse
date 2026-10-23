#!/usr/bin/env bash
# A delivered document in the chat, and its panel: the card's title, its peek, where it sits against the text that
# introduces it, and the panel's own title and sideways scroll, at 390 and 1440, day and night.
#   bash scripts/verify/document-card.sh <repo> <out-dir>
# Real crewd on the stub engine, isolated under ~/.cache/fm-scratch (web/dist built first). Quill writes one document
# with crew_document, named "Subscriptions, October" (the helper's own words, not the file slug). Then:
#   1. thread-<theme>-<width>.png and card-facts.txt: the card in Quill's chat, and what the card says and where it sits;
#   2. panel-<theme>-<width>.png and panel-facts.txt: the reader opened on the file, and what its header and body say.
set -euo pipefail
REPO=$(cd "$1" && pwd); OUT=$(mkdir -p "$2" && cd "$2" && pwd)
mkdir -p "$OUT/screens" "$HOME/.cache/fm-scratch"
LAB=$(mktemp -d "$HOME/.cache/fm-scratch/document-card.XXXXXX")
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
NODE=$(node -p process.execPath) # the real binary: a version-manager shim fails under the masked env
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
. "$REPO/scripts/verify/crewd-group.sh"
cleanup() { chrome-devtools-axi stop >/dev/null 2>&1 || true; crewhouse_remove_lab "$LAB"; }
trap cleanup EXIT
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" CREWHOUSE_LINK_PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})') \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  "$NODE" src/main.ts
wait_for() { for _ in $(seq 1 300); do "$@" >/dev/null 2>&1 && return 0; kill -0 "$CREWD" 2>/dev/null || { echo "crewd exited"; tail "$OUT/crewd.log"; exit 1; }; sleep 0.2; done; echo "timed out: $*"; exit 1; }
ready() { curl --max-time 10 -fsS "$B/api/state" -H x-crewhouse:1 -H "Authorization: Bearer $(cat "$LAB/state/person.key")" | grep -q '"person"'; }
wait_for ready
PERSON=$(<"$LAB/state/person.key")
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl --max-time 10 -fsS -X "$1" "${H[@]}" --data "$3" "$B$2"; }
post PUT /api/people/1 '{"name":"Umer"}' >/dev/null
post POST /api/onboard '{"address":"Umer"}' >/dev/null
post POST /api/recruit '{"template":"scribe","name":"Quill"}' >/dev/null

SPEC='{"name":"Subscriptions, October","blocks":[
 {"heading":"Subscriptions, October","level":1},
 {"text":"Every recurring charge on the card this month, with the day it renews."},
 {"heading":"What renews"},
 {"bullets":["Streaming, renews on the 3rd","Phone plan, renews on the 12th","Cloud storage, renews on the 28th"]},
 {"heading":"Totals"},
 {"table":{"head":["Service","Per month"],"rows":[["Streaming","£11.99"],["Phone plan","£24.00"],["Cloud storage","£2.49"]]}},
 {"text":"Say the word if you want anything cancelled.","bold":true}]}'
call=$(node -e 'process.stdout.write(`[tool crew_document ${JSON.stringify(JSON.parse(process.argv[1]))}]`)' "$SPEC")
msg=$(node -e 'process.stdout.write(JSON.stringify({text: process.argv[1]}))' "Make me a list of my subscriptions for October, as a document. $call")
is_done() { curl --max-time 10 -fsS "${H[@]}" "$B/api/bots/quill" | node -e 'const t=JSON.parse(require("fs").readFileSync(0)).tasks.find((t)=>t.id===Number(process.argv[1]));process.exit(t&&t.state==="done"?0:1)' "$1"; }
task=$(curl --max-time 10 -fsS -X POST "${H[@]}" --data "$msg" "$B/api/bots/quill/messages" | node -pe 'JSON.parse(require("fs").readFileSync(0)).task')
wait_for is_done "$task"
DOC=subscriptions-october.docx; FILE="$LAB/crew/bots/quill/files/$DOC"
[ -f "$FILE" ] || { echo "no document delivered"; ls -la "$LAB/crew/bots/quill/files"; exit 1; }

RUN=$(date +%s) # a fresh query per run: the browser must not show a bundle from before this build
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-document-card}
ax() { chrome-devtools-axi "$@"; }
ax stop >/dev/null 2>&1 || true; ax pages >/dev/null 2>&1 || true; ax selectpage 1 >/dev/null
ax open "$B/#person=$PERSON" >/dev/null # the app boots with the person's key before any page is resized or read
# The tool prints the page's string quoted; decode it back to one line of JSON.
dec() { sed -n 's/^result: //p' | node -e 'let s = JSON.parse(require("fs").readFileSync(0, "utf8")); while (typeof s === "string") { try { s = JSON.parse(s); } catch { break; } } console.log(JSON.stringify(s))'; }
WAITCARD='(async () => { for (let i = 0; i < 100 && !document.querySelector(".wb-card"); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector(".wb-card"); })()'
WAITPANEL='(async () => { for (let i = 0; i < 100 && !document.querySelector(".wb-panel h3, .wb-panel td, .wb-panel p"); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector(".wb-panel h3, .wb-panel td, .wb-panel p"); })()'
# Where the card sits against the text that introduces it: the nearest chat text before or after it, in document order.
CARD='JSON.stringify((() => { const c = document.querySelector(".wb-card"); if (!c) return { card: false };
  const line = c.closest(".line"), text = line?.querySelector(".bubble-text");
  const thumb = c.querySelector(".wb-thumb");
  const box = c.getBoundingClientRect(), title = c.querySelector(".wb-what b")?.textContent, about = c.querySelector(".wb-what .small")?.textContent;
  return { card: true, title, about, thumb: thumb ? { head: thumb.querySelector("b")?.textContent ?? null, lines: [...thumb.querySelectorAll("i, .ln")].map((i) => i.textContent) } : null,
    textFirst: !!(text && (text.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING)), textOnly: text ? text.textContent.slice(0, 80) : null,
    cardWidth: Math.round(box.width), cardHeight: Math.round(box.height), sideways: document.documentElement.scrollWidth > innerWidth }; })())'
# The reader: its title, its about line, the parts it shows, and whether the page scrolls sideways.
PANEL='JSON.stringify((() => { const p = document.querySelector(".wb-panel"); if (!p) return { panel: false };
  return { panel: true, title: p.querySelector(".wb-head .wb-what b")?.textContent, about: p.querySelector(".wb-head .wb-what .small")?.textContent,
    headings: [...p.querySelectorAll("h3")].map((h) => h.textContent), bullets: p.querySelectorAll("li").length, tables: p.querySelectorAll("table").length,
    hint: !!p.textContent.match(/Swipe sideways/), sideways: document.documentElement.scrollWidth > innerWidth }; })())'
: > "$OUT/card-facts.txt"; : > "$OUT/panel-facts.txt"
for theme in night day; do
  for wh in 1440x900 390x844; do
    w=${wh%x*}; h=${wh#*x}
    ax resize "$w" "$h" >/dev/null
    ax open "$B/?$theme&r=$RUN#/h/quill" >/dev/null; ax eval "$WAITCARD" >/dev/null
    ax eval "(() => { document.querySelector('.wb-card')?.scrollIntoView({ block: 'center' }); return true; })()" >/dev/null
    echo "$theme-$w: $(ax eval "$CARD" | dec)" | tee -a "$OUT/card-facts.txt"
    ax screenshot "$OUT/screens/thread-$theme-$w.png" >/dev/null
    # The panel opens from the card's own link, so the title it reads is the one the card carries.
    HREF=$(ax eval "document.querySelector('.wb-card')?.getAttribute('href') ?? ''" | sed -n 's/^result: //p' | node -e 'let s = JSON.parse(require("fs").readFileSync(0, "utf8")); while (typeof s === "string") { try { s = JSON.parse(s); } catch { break; } } process.stdout.write(String(s))')
    ax open "$B/?$theme&r=$RUN$HREF" >/dev/null; ax eval "$WAITPANEL" >/dev/null
    echo "$theme-$w: $(ax eval "$PANEL" | dec)" | tee -a "$OUT/panel-facts.txt"
    ax screenshot "$OUT/screens/panel-$theme-$w.png" >/dev/null
  done
done
ax stop >/dev/null 2>&1 || true
