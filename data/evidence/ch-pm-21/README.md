# ch-pm-21 — a connect is proved by using the app

Real `crewd` on the stub engine (`.agents/skills/verify-crewhouse`), loopback only, throwaway HOME, one lane.
Notion and Canva were pointed at a lane-owned OAuth 2.1 + remote MCP app (`provider.ts`, `daemon.ts`, `start.sh`,
copied here so the run can be repeated). Everything else is the product as shipped: the real server, the real crew,
the real SQLite, the real kit sign-in, the real web app in a browser.

## The journey, as a person drives it

1. In Chief's thread, in their own words: **"connect my notion so my helper can read my notes"** → Chief answers
   "Connect Notion." and a Connect card appears. No settings page, no key, no scope name.
2. **Connect Notion** opens the app's own consent page — real PKCE (`code_challenge_method=S256`), `state`,
   `redirect_uri` and `resource` — with one **Allow**.
3. Back in Crewhouse the sheet reads **"Notion is connected"** and, under it, the app's own answer to a real read:
   **"Your helper can ask it for 2 different things."** That line is an authenticated `tools/list` over the saved
   grant, not a promise: before this change the same screen said "Helpers can read and add pages you share with them."
4. Chief's thread carries the same line as a plain sentence.
5. **The helper used it.** Scout searched the connected app and got the note back from the app's own store
   (`scout-chat-after-use.json`), then wrote a new note — which asked first ("Scout wants to use your Notion: add a
   note.") and, once allowed, really landed in the app (`stand-in-app-log.json`: served `add-note`, notes now
   `Pool pass`, `Swimming lesson`, `Library card`). The job ended **not sure**, because the stub model never claimed
   to have seen a confirmation.
6. **The defect this change exists to catch**, on the same run: Canva took the sign-in and then answered nothing at
   first use. The screen says *"That didn't go through — Canva took the sign-in but didn't answer when we tried to use
   it, so nothing is connected. Try again in a moment."* and Canva stays off. Before this change it would have said
   "Canva is connected" and failed in the helper's turn instead.

## Labelled limits

- **Stub model, stand-in account.** No live Google, Notion or Canva account was used: the retained home
  (`/home/umer/lab-tmp/crewhouse-retained`) carries a ChatGPT sign-in only, and there is no household Google client
  anywhere in the lab, so a live Google consent round trip is not reachable from this lane. The account behind the
  connect is the lane's stand-in app. Every step except the third party's own servers is the product's own code.
- A real model would add Chief's own wording for the same steps; on the stub engine the app hides stub replies
  (`web/src/adapter.ts` filters `stub <bot>:`), so Scout's answer is in the API transcript rather than the chat.

## Files

- `screens/connect-sheet-done-{1440,390}-{day,night}.png` — the Connect sheet on Connected, with the proof line.
- `screens/chief-proof-line-{1440,390}-{day,night}.png` — Chief's thread after the connect.
- `screens/connect-sheet-unusable-{1440,390}-{day,night}.png` — the app that takes the sign-in and does not answer.
- `motion/connect-notion.webm` — the connect itself: card, consent page, Allow, callback, Connected (202 frames).
- `scout-chat-after-use.json`, `stand-in-app-log.json` — the helper's real use, and what the app actually served.
- `provider.ts`, `daemon.ts`, `start.sh` — the lane's stand-in app and launcher, so the run can be repeated.

Media is never committed (`.gitignore`); these files are produced by the run the PR names.
