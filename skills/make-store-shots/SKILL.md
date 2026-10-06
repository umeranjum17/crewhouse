---
name: make-store-shots
description: Make an app's five phone store screenshots (1290x2796) from the running app itself: a bold headline per panel, a drawn hero panel, the app's mascot, soft colour blocks and its real screens cropped large, with cards lifted out of the phone. Use for any App Store, Play Store or store screenshot request.
says: Make your app's store screenshots from the app itself
---

# Make store screenshots

You need the app's name and the address it runs at (an `http://` page, on this computer or the web). If the task gives no
address, ask once; never draw an app you have not seen. Every screen in the set is a real capture of that app.

1. Set up `work/<task-id>/` and copy `shoot.mjs` and `panel.html` from this skill's folder into it. Work there.
2. Look at the app: `node shoot.mjs "<address>" shots/home.png --map shots/home`. It shoots the page as a phone screen at
   1290x2796 and writes `shots/home/map.json`: `cards` (each card's words and its box in the shot's pixels), `art` (the
   app's own drawings, each saved as an .svg beside it), `fonts` (saved too) and `links` (its other screens).
3. Shoot four more screens from `links` (or addresses you know), each with `--map`, so you have five that show what the
   app does for the person: the main screen, a moment it asks them first, finished work, the people or helpers, a schedule.
   Prefer screens with real content. `jq '.cards[] | [.text, .x, .y, .w, .h]' shots/<name>/map.json` lists the cards.
4. Write five headlines, in the words the person would say about their own day, not feature names: 2 to 5 words, at
   most 26 letters ("Clear your head", "Brain dump everything", "Drag into your day"). Use the person's own lines when the task
   gives them. In each, mark the word that matters: `*word*` draws a ring round it, `_word_` a stroke under it.
5. Art and type: `mkdir -p art fonts`; copy the mascot and the rest of the cast from the maps' `art` into `art/`. If the app
   ships a serif font (a family with "Serif" in its name), copy it to `fonts/headline.ttf`; otherwise the panels use Noto Serif.
6. Write `panels.js`, one entry per panel, in order:
   ```js
   window.PANELS = [
     { layout: 'hero', bg: '#E9E4FF', title: 'Clear your *head*', note: 'A better planner.', art: 'art/mascot.svg', crew: ['art/a.svg', 'art/b.svg'] },
     { layout: 'phone', bg: '#DCEBFF', title: 'Nothing goes out without your *yes*', shot: 'shots/ask.png', lift: [{ x: 186, y: 1388, w: 1056, h: 953 }], art: 'art/b.svg', say: 'Shall I?' },
     { layout: 'cards', bg: '#FFF3C8', title: 'Say it once. _Done._', shot: 'shots/done.png', lift: [/* two to four cards */], art: 'art/a.svg', say: 'All sorted!' },
   ];
   ```
   - Panel 1 is always `hero`: the headline names the app or the person's gain, the mascot large (`art`), up to three of
     the cast small (`crew`), one short `note`.
   - `phone`: the screen in a phone frame running off the bottom; `lift` takes one or two cards from that screen's map
     (copy `x`, `y`, `w`, `h` exactly) and pulls them out past the frame. The screen scrolls to the first one.
   - `cards`: no phone; two to four cards from one screen, floating. Use it once in the set.
   - `say` is the mascot's own short line in a speech bubble (at most 22 letters); leave it out where nothing fits.
   - `bg`: a different soft pastel per panel, such as `#E9E4FF`, `#DCEBFF`, `#FFF3C8`, `#FFE3DB`, `#DFF3E4`.
7. Render each panel: `for n in 1 2 3 4 5; do node shoot.mjs "panel.html#$n" "files/<app>-store-$n.png" || break; done`
   (`<app>` is the app's name in lowercase, with hyphens).
8. Check before delivering: `magick identify files/<app>-store-*.png` shows five at 1290x2796; then make one sheet
   to look at, `magick files/<app>-store-[1-5].png -resize 25% +append files/<app>-store-sheet.png`.
9. crew_deliver the sheet first, then each panel with a one-line note (the headline). Reply with what you made, which
   screens you used, and the headlines, so the person can change any of them.
