#!/usr/bin/env bash
# Settled real campaign: capture recruitment and the complete plan, using stable DOM actions, not streaming refs.
set -euo pipefail
B=${1:?owned daemon URL}; EV=${2:?evidence directory}
: "${CHROME_DEVTOOLS_AXI_SESSION:?set a task-owned browser session}"
mkdir -p "$EV"
for theme in day night; do
  for width in 1440 390; do
    if [ "$width" = 390 ]; then height=844; else height=900; fi
    chrome-devtools-axi resize "$width" "$height" > "$EV/resize-$theme-$width.txt"
    chrome-devtools-axi open "$B/?$theme#/crew" > "$EV/recruit-$theme-$width.txt"
    chrome-devtools-axi wait 'Scout' >> "$EV/recruit-$theme-$width.txt"
    chrome-devtools-axi eval '() => ({width:innerWidth,height:innerHeight,helpers:[...document.querySelectorAll("a")].filter(a=>/\b(Scout|Scribe|Reel)\b/.test(a.innerText)).map(a=>({text:a.innerText,rect:a.getBoundingClientRect().toJSON()}))})' > "$EV/recruit-geometry-$theme-$width.txt"
    chrome-devtools-axi screenshot "$EV/recruit-$theme-$width.png" >> "$EV/recruit-$theme-$width.txt"
    chrome-devtools-axi open "$B/?$theme#/chief" > "$EV/plan-$theme-$width.txt"
    chrome-devtools-axi wait "Here's the campaign" >> "$EV/plan-$theme-$width.txt"
    chrome-devtools-axi eval '() => { const md=[...document.querySelectorAll(".chat-md")].find(e=>e.textContent.includes("campaign, Umer")); if(!md)throw Error("Campaign reply missing"); const b=md.querySelector(".chat-more"); const before=b?.getBoundingClientRect().toJSON(); if(b?.textContent.trim()==="More")b.click(); return {clicked:b?.textContent.trim(),before}; }' > "$EV/plan-expand-$theme-$width.txt"
    chrome-devtools-axi eval '() => { const md=[...document.querySelectorAll(".chat-md")].find(e=>e.textContent.includes("campaign, Umer")); const goal=[...md.querySelectorAll("li,p")].find(e=>e.textContent.startsWith("Goal:")); if(!goal)throw Error("Plan goal missing"); goal.scrollIntoView({block:"start"}); return {width:innerWidth,height:innerHeight,parts:[...md.querySelectorAll("li,p")].filter(e=>/^(Goal:|Offer:|Channels:|Scout|Scribe)|Nothing posts/.test(e.textContent)).map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()}))}; }' > "$EV/plan-geometry-$theme-$width.txt"
    chrome-devtools-axi screenshot "$EV/plan-$theme-$width.png" >> "$EV/plan-$theme-$width.txt"
  done
done
