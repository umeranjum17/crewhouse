#!/usr/bin/env bash
# Chief's Things proof (docs/verification/chief-profile.md): Chief's profile Things rows and the Files / Links / Pictures lists at 390x844, light and dark,
# from the real app on a stub crewd lab (runbook.md). Usage: chief-things.sh <port> <state-dir> <out-dir> <empty|filled>.
# CHROME_DEVTOOLS_AXI_SESSION must name this task's browser, already holding the person's key.
set -eu
PORT=$1 STATE=$2 OUT=$3 MODE=$4 B="http://127.0.0.1:$1"
K=$(<"$STATE/person.key")
ax() { chrome-devtools-axi "$@" | sed "s/$K/<key>/g"; }
until_js() { for _ in $(seq 60); do ax eval "$1" | grep -q true && return 0; sleep 0.5; done; echo "timed out: $1" >&2; return 1; }
mkdir -p "$OUT"
ax emulate --viewport "390x844x3,mobile,touch" >/dev/null
for theme in day night; do look=$([ $theme = day ] && echo light || echo dark)
  # Chief's hero opens his profile; scroll to Things, the last section.
  ax eval "location.href='/?$theme&r='+Date.now()+'#/chief'" >/dev/null; until_js "!!document.querySelector('.ch-name a')"
  ax eval "document.querySelector('.ch-name a').click()" >/dev/null
  until_js "[...document.querySelectorAll('.chief-profile .label')].some(l=>l.textContent==='Things')"
  ax eval "window.scrollTo(0, document.documentElement.scrollHeight)" >/dev/null; sleep 0.4
  ax eval "JSON.stringify({rows:[...document.querySelectorAll('.chief-profile a[href^=\"#/h/chief/\"]')].map(a=>a.innerText.replace(/\n/g,' | ')),sw:document.documentElement.scrollWidth,iw:innerWidth})" > "$OUT/profile-$MODE-$look.json"
  ax screenshot "$OUT/app-profile-$MODE-$look.png" >/dev/null
  for list in files links pictures; do
    # The profile's row opens the list; the switch at the top moves between the three.
    ax eval "document.querySelector('a[href=\"#/h/chief/$list\"]')?.click() ?? (location.hash='#/h/chief/$list')" >/dev/null
    until_js "location.hash==='#/h/chief/$list' && !!document.querySelector('.cp-seg button.on')"; sleep 0.4
    ax eval "JSON.stringify({on:document.querySelector('.cp-seg .on').textContent,tabs:[...document.querySelectorAll('.cp-seg button')].map(b=>b.textContent),rows:[...document.querySelectorAll('.chief-profile .card.list a')].map(a=>a.innerText.replace(/\n/g,' | ')),empty:document.querySelector('.cp-none')?.innerText,sw:document.documentElement.scrollWidth,iw:innerWidth})" > "$OUT/$list-$MODE-$look.json"
    ax screenshot "$OUT/app-$list-$MODE-$look.png" >/dev/null
  done
done
