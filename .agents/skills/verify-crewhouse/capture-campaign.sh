#!/usr/bin/env bash
# One real campaign decision/outcome, four theme/width captures; each screen is settled by a visible condition.
set -euo pipefail
B=${1:?owned daemon URL}; EV=${2:?evidence directory}; phase=${3:?before, approval, declined or approved}
: "${CHROME_DEVTOOLS_AXI_SESSION:?set a task-owned browser session}"
mkdir -p "$EV"
case "$phase" in
  before) route='#/h/scribe'; text='Copy'; selector='.card.ask';;
  approval) route='#/chief'; text='Approve'; selector='.card.ask.campaign';;
  declined) route='#/chief'; text='Campaign put aside'; selector='.card.ask.campaign';;
  approved) route='#/chief'; text='Ready to copy'; selector='.card.ask.campaign';;
  *) echo 'unknown capture phase' >&2; exit 2;;
esac
node .agents/skills/verify-crewhouse/scripts/personal-voice.mjs
for theme in day night; do
  for width in 1440 390; do
    if [ "$width" = 390 ]; then height=844; else height=900; fi
    log="$EV/$phase-$theme-$width.txt"
    chrome-devtools-axi open "$B/?$theme$route" > "$log"
    chrome-devtools-axi resize "$width" "$height" >> "$log"
    chrome-devtools-axi wait "$text" >> "$log"
    # The most recent matching card is the decision/outcome for the currently driven journey.
    chrome-devtools-axi eval "() => { const cards=[...document.querySelectorAll('$selector')]; const c=cards.filter(e=>e.innerText.includes('$text')).at(-1); if(!c)throw Error('Campaign screen missing'); c.scrollIntoView({block:'start'}); return {width:innerWidth,height:innerHeight,text:c.innerText,card:c.getBoundingClientRect().toJSON(),buttons:[...c.querySelectorAll('button,a.btn')].map(e=>({text:e.innerText,rect:e.getBoundingClientRect().toJSON()})),images:[...c.querySelectorAll('img')].map(e=>({complete:e.complete,width:e.naturalWidth,height:e.naturalHeight,rect:e.getBoundingClientRect().toJSON()})),horizontalOverflow:document.documentElement.scrollWidth>innerWidth}; }" > "$EV/$phase-geometry-$theme-$width.txt"
    chrome-devtools-axi screenshot "$EV/$phase-$theme-$width.png" >> "$log"
    # A long campaign remains readable by scrolling; retain its end/action area too.
    chrome-devtools-axi eval "() => { const c=[...document.querySelectorAll('$selector')].filter(e=>e.innerText.includes('$text')).at(-1); c.scrollIntoView({block:'end'}); return {card:c.getBoundingClientRect().toJSON()}; }" >> "$log"
    chrome-devtools-axi screenshot "$EV/$phase-end-$theme-$width.png" >> "$log"
    if grep -Eiq '(^|[[:space:]])error:' "$log" "$EV/$phase-geometry-$theme-$width.txt"; then echo 'capture command error; inspect retained logs' >&2; exit 1; fi
  done
done
