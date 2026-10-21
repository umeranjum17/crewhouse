#!/usr/bin/env bash
# done-done journey `phone-web-pair` (hand/agent only: needs a browser session and a MiniMax key): a new person pairs the
# phone's browser app to their computer by the computer's QR, which is a link to the computer's own web app, and chats with
# Chief from the phone. One isolated crewd on the real engine signed in to MiniMax (key paste, Flash model), its own web app
# served on the link port from a secure-context origin (http://crewhouse.localhost:<port>/, standing in for the https
# address Tailscale or the person's own server gives). The phone is a 390-wide mobile browser session.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/phone-web-pair.sh <out-dir> <minimax-key-file>
#
# The key is read from the file into the sign-in request only: never printed, logged, copied or kept. Exit 0 with
# shots/phone-chief-reply-day-390.png (Chief's answer in the paired phone's thread: all the judge reads) in <out-dir>; the steps before it (screens, the two words, the paired Home), reply.txt and crewd.log stay in the lab, copied to <out-dir>/context-failed only when the run fails.
[ $# -ge 2 ] || { echo "usage: phone-web-pair.sh <out-dir> <minimax-key-file>" >&2; exit 2; }
KEYFILE=$2; [ -s "$KEYFILE" ] || { echo "phone-web-pair: no key in the key file" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-phone-web.XXXXXX)
trap 'rc=$?; [ $rc -eq 0 ] || cp -r "$LAB/context" "$OUT/context-failed" 2>/dev/null; crewd_stop || exit 1; chmod -R u+w "$LAB"; rm -rf "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run} "$OUT/shots" "$LAB/context"
free() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
PORT=$(free); LP=$(free)
B="http://127.0.0.1:$PORT"; SHELL_URL="http://crewhouse.localhost:$LP/"
crewd_start "$REPO" "$LAB/context/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_PORT="$PORT" CREWHOUSE_LINK_PORT="$LP" CREWHOUSE_LINK_HOST=127.0.0.1 \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 2400); do # the first start installs the engine
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"phase":"ready"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "phone-web-pair: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 60 "${H[@]}" "${@:2}" "$B$1"; }
api /api/onboard -d '{"address":"Umer"}' > /dev/null
AI=${AI:-minimax}; AINAME=MiniMax; [ "$AI" = openrouter ] && AINAME=OpenRouter # AI=openrouter: the same journey on an OpenRouter key when the MiniMax plan rests
api /api/accounts/1/$AI/login -d '{"via":"key"}' > /dev/null
node -e 'process.stdout.write(JSON.stringify({ text: require("node:fs").readFileSync(process.argv[1], "utf8").trim() }))' "$KEYFILE" |
  api /api/accounts/1/$AI/paste --max-time 120 --data-binary @- > /dev/null
for _ in $(seq 120); do api /api/accounts | grep -q "\"account\":\"$AI\",\"name\":\"$AINAME\",\"signedIn\":true" && break; sleep 0.5; done
api /api/accounts | grep -q "\"account\":\"$AI\",\"name\":\"$AINAME\",\"signedIn\":true" || { echo "phone-web-pair: $AINAME did not take the key" >&2; exit 1; }
MODEL=${CHAT_MODEL:-MiniMax-M3.1-Flash}; [ "$AI" = openrouter ] && MODEL=${CHAT_MODEL:-minimax/minimax-m3}
node -e 'const f = process.argv[1], c = JSON.parse(require("node:fs").readFileSync(f, "utf8")); c.models = [process.argv[3] + ":" + process.argv[2]]; require("node:fs").writeFileSync(f, JSON.stringify(c, null, 2))' "$LAB/crew/bots/chief/bot.json" "$MODEL" "$AI"
echo "phone-web-pair: model $MODEL"

export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
SHOTS="$OUT/shots"
# Before: what a new person sees on the phone, and on the computer with no web address yet.
WIDTHS=390x844 bash "$REPO/scripts/verify/screens.sh" "$LAB/context" phone-where "$SHELL_URL"
WIDTHS=390x844 bash "$REPO/scripts/verify/screens.sh" "$LAB/context" phone-pair-sheet "${SHELL_URL}#/pair"
THEN="async () => { for (let i = 0; i < 80 && !document.querySelector('.sh-chief'); i++) await new Promise((r) => setTimeout(r, 100)); location.hash = '#/settings/phones'; await new Promise((r) => setTimeout(r, 1500)); return true; }" \
  bash "$REPO/scripts/verify/screens.sh" "$LAB/context" computer-phones-off "$B/#person=$PERSON"
# The web address: the computer's own app on the link port (a secure context standing in for the https address).
api /api/phones/web -X PUT -d "{\"address\":\"${SHELL_URL%/}\"}" > /dev/null
THEN="async () => { for (let i = 0; i < 80 && !document.querySelector('.sh-chief'); i++) await new Promise((r) => setTimeout(r, 100)); location.hash = '#/settings/phones'; await new Promise((r) => setTimeout(r, 1500)); return true; }" \
  bash "$REPO/scripts/verify/screens.sh" "$LAB/context" computer-phones-on "$B/#person=$PERSON"
QR=$(api /api/phones/pair -d '{"role":"control"}' | node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(0, "utf8")).qr)')
case "$QR" in "${SHELL_URL}#byokit-link:"*) ;; *) echo "phone-web-pair: the QR is not a link to the web app" >&2; exit 1;; esac

# The phone scans it: its camera opens the link. The page pairs by itself and shows the two words.
axi() { timeout -k 10 120 chrome-devtools-axi "$@"; }
axi emulate --viewport 390x844x3,mobile,touch > /dev/null
axi open "${SHELL_URL}?night#${QR#*#}" > /dev/null
ASKED=""
for _ in $(seq 100); do
  ASKED=$(api /api/phones/link | node -e 'const a = JSON.parse(require("node:fs").readFileSync(0, "utf8")).asking?.[0]; if (a) process.stdout.write(a.id + " " + a.words)')
  [ -n "$ASKED" ] && break; sleep 0.3
done
[ -n "$ASKED" ] || { echo "phone-web-pair: the computer was never asked" >&2; exit 1; }
sleep 1; axi screenshot "$LAB/context/phone-two-words-night-390.png" > /dev/null
echo "phone-web-pair: the computer shows: ${ASKED#* }"
api /api/phones/answer -d "{\"id\":${ASKED%% *},\"yes\":true}" > /dev/null
for _ in $(seq 100); do axi eval "!!document.querySelector('.sh-chief a')" 2>/dev/null | grep -q true && break; sleep 0.5; done
sleep 1; axi screenshot "$LAB/context/phone-paired-home-day-390.png" > /dev/null

# Chief, from the phone: open his card, type through the page's own box, press Send.
axi eval "() => { document.querySelector('.sh-chief a')?.click(); return true; }" > /dev/null
for _ in $(seq 50); do axi eval "!!document.querySelector('.home-chat textarea')" 2>/dev/null | grep -q true && break; sleep 0.3; done
axi eval "(() => { const t = document.querySelector('.home-chat textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Good morning Chief. Please say hello back in one short sentence.'); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()" > /dev/null
sleep 0.5; axi eval "() => { document.querySelector('.home-chat button.send')?.click(); return true; }" > /dev/null
look() { api /api/bots/chief | node -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")), s = t.tasks?.[0]?.state, m = (t.messages ?? []).filter((x) => x.author === "bot" && String(x.text ?? "").trim() && !/\bstub [\w-]+:/.test(x.text));
  if (s === "done" && m.length) process.stdout.write("done " + m.at(-1).text); else if (["failed", "unsure"].includes(s)) process.stdout.write("end " + s)'; }
R=""; DEADLINE=$((SECONDS + ${REPLY_SECONDS:-180}))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  R=$(look)
  case "$R" in done\ *) R=${R#done }; break;; end\ *) echo "phone-web-pair: Chief's job ${R#end } on $MODEL" >&2; exit 1;; esac
  R=""; sleep 1
done
[ -n "$R" ] || { echo "phone-web-pair: no reply from Chief within ${REPLY_SECONDS:-180}s" >&2; exit 1; }
printf '%s\n' "$R" > "$LAB/context/reply.txt"
sleep 3; axi screenshot "$SHOTS/phone-chief-reply-day-390.png" > /dev/null
echo "phone-web-pair: Chief replied on the paired phone; shots in $SHOTS"
