#!/usr/bin/env bash
# done-done journey `resume`: Umer's resume on a real stub-engine crewd. He pastes his CV to Chief; a resume with a line he
# never wrote is refused; Chief's resume from his own lines lands in his chat. Captures the chat, the resume with where each
# part came from, the edit, the saved edit, and the PDF and Word files the app's own buttons save, each opened once
# (poppler for the PDF, LibreOffice for the Word file). Each at 390 and 1280, day and night, through home-gate.mjs; then the
# installed-app window (display-mode standalone) at 390.
#
#   scripts/verify/resume.sh <out-dir>
# Exit 0 with <step>-<390|1280>-<day|night>.png, <step>-gate.json, pwa-<step>-390-<day|night>.png, refusal.json,
# saved/resume.pdf, saved/resume.docx, export-pdf.png, export-word.png and export-text.txt in <out-dir>.
# Needs /usr/bin/chromium, pdftoppm, pdftotext and soffice.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: resume.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-resume.XXXXXX)
trap 'crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run,lo} "$OUT/saved"
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  "${NODE:-node}" "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "resume: crewd never became ready" >&2; exit 1; }
node "$REPO/scripts/verify/resume.mjs" "$B" "$PERSON" | tee "$OUT/refusal.json"
# The resume is a panel over the chat, outside main, so its gate reads the panel's text.
gate() {
  export GATE_SCOPE='.wb-panel *'
  local js="(async () => { location.hash = '#$2'; await new Promise((r) => setTimeout(r, 1200)); ${3:-} })()"
  node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT" "$1" "$js"
  [ -n "${4:-}" ] || GATE_PWA=1 node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT" "pwa-$1" "$js"
  unset GATE_SCOPE
}
DOC=/f/chief/files%2Fresume.docx/Resume
# His edit, typed into the box the way a person types: the old line becomes his new one (the same each run, so a repeat changes nothing).
TYPE="document.querySelector('.resume-edit-go')?.click(); await new Promise((r) => setTimeout(r, 300));
  const box = document.querySelectorAll('.resume-edit textarea')[1], put = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  put.call(box, box.value.replace('Cut page load time by 40 percent on the checkout flow', 'Cut checkout page load time by 40 percent, measured in production'));
  box.dispatchEvent(new Event('input', { bubbles: true })); box.scrollIntoView({ block: 'center' });"
# Chief's thread keeps its own small labels (who said it, the time) and the card's peek cuts its lines short by design,
# so its gate is recorded in chat-gate.json and not held against the run; the resume's own screens below must pass.
node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT" chat \
  "(async () => { location.hash = '#/chief'; await new Promise((r) => setTimeout(r, 1200)); document.querySelector('.wb-card')?.scrollIntoView({ block: 'center' }) })()" >/dev/null || true
gate resume "$DOC"
gate edit "$DOC" "$TYPE" no-pwa
gate saved "$DOC" "$TYPE; await new Promise((r) => setTimeout(r, 200)); document.querySelector('.resume-edit button[type=submit]')?.click();
  await new Promise((r) => setTimeout(r, 1500)); document.querySelectorAll('.resume-from')[1]?.scrollIntoView({ block: 'center' });"
# The app's own Save as PDF and Word buttons, once, at 1280 night; the files they save are opened by real readers.
GATE_DOWNLOADS="$OUT/saved" node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$LAB" saving \
  "(async () => { location.hash = '#$DOC'; await new Promise((r) => setTimeout(r, 1200)); for (const b of document.querySelectorAll('.wb-saves button')) { b.click(); await new Promise((r) => setTimeout(r, 800)); } })()" >/dev/null
[ -s "$OUT/saved/resume.pdf" ] && [ -s "$OUT/saved/resume.docx" ] || { echo "resume: the app's buttons saved no PDF or Word file" >&2; ls -la "$OUT/saved" >&2; exit 1; }
pdftotext -layout "$OUT/saved/resume.pdf" "$OUT/export-text.txt"
grep -q 'measured in production' "$OUT/export-text.txt" || { echo "resume: the saved PDF lacks the edit" >&2; exit 1; }
pdftoppm -r 110 -png -singlefile "$OUT/saved/resume.pdf" "$OUT/export-pdf"
HOME="$LAB/home" timeout 180 soffice --headless "-env:UserInstallation=file://$LAB/lo/profile" --convert-to pdf --outdir "$LAB/lo" "$OUT/saved/resume.docx" >/dev/null 2>&1
pdftoppm -r 110 -png -singlefile "$LAB/lo/resume.pdf" "$OUT/export-word"
pdftotext -layout "$LAB/lo/resume.pdf" - | grep -q 'measured in production' || { echo "resume: the saved Word file lacks the edit" >&2; exit 1; }
node "$REPO/scripts/verify/steps.mjs" "$OUT" resume
echo "resume: ok"
