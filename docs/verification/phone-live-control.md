# Phone live control

A person watching a helper work on the phone layout (the installed PWA at 390 wide) can stop it, take it over or approve it there. The helper's chat carries one control bar under its header (`LiveControl` in `web/src/main.tsx`): the status word, Take control (a helper with a computer; Open screen once you hold it) and Stop. Approvals stay the existing card with Yes, go ahead. Everything is crewd's existing `/reset`, `/takeover`, `/giveback` and ask routes.

## Drive and witness

`PATH=/usr/bin:$PATH CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/phone-live-control.sh <out-dir> <minimax-key-file>` (done-done journey `phone-live-control`, which spends a few model calls on that key). It boots an isolated crewd on the real engine, signs in to MiniMax through the key paste (read from the file into that request only), recruits Research Rae on `MiniMax-M3.1-Flash`, then through the app's own buttons:

1. Approve: a job reading a file outside the helper's space; the bar reads Waiting, one tap on Yes, go ahead lets it through (each further ask is its own tap) and the reply carries the file's words;
2. a live job: three engine steps, the bar reads At work, Take control, Stop; Stop ends it "Stopped by you." and no step arrives after;
3. a second long job: Take control moves the controls to the person, the helper stops stepping, the live card gives way to "You have the controls" and the bar reads You have control, the helper's screen opens with Hand it back, and handing back returns the controls.

Every bounded wait fails the journey and keeps `thread.json` and `crewd.log`. `test/office.test.ts` holds the same bar's fit and words on the stub engine at 390.

## Capture

`{live,stopped,takeover,handed-back,ask,approved}-{night,day}-390.png`, `held-day-390.png` and `report.txt` in the evidence folder.
