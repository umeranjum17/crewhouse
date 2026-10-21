# Pairing the phone's browser by the computer's QR

The computer's QR is a link to the computer's own web app with the pairing offer after `#` (`Link.offer()` once `link.web` is set). The phone's camera opens that page; the page pairs by itself (`web/src/flows.tsx` `PairSheet`, `offerHere`), shows two words, and the computer approves. A plain LAN `ws://` address can never work from an https page, and `crypto.subtle` (the device key) needs a secure context, so an https address for the computer (Tailscale `serve` on the link port + 1, or the person's own server forwarding to the link port with websockets) or a relay is required.

## Drive and witness

`CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/phone-web-pair.sh <out-dir> <minimax-key-file>` (done-done journey `phone-web-pair`, which spends a few model calls on that key). An isolated crewd on the real engine, signed in to MiniMax by key paste, Flash in Chief's `bot.json` (as `chat-real`). Its link port serves the app at `http://crewhouse.localhost:<port>/` (a secure context standing in for the https address; the lab never touches the host's Tailscale). The script sets `PUT /api/phones/web {address}`, mints the offer, opens the QR link in a 390-wide mobile session, answers yes at the computer, then types a message to Chief through the page's own box and waits, bounded by `REPLY_SECONDS`, for his real reply.

## Capture

`shots/`: `phone-where-*` (no "Just on this phone" row), `phone-pair-sheet-*` (plain steps, no commands), `computer-phones-off-*` and `computer-phones-on-*` (Settings, Phones), `phone-two-words-night-390.png`, `phone-paired-home-day-390.png`, `phone-chief-reply-day-390.png`; `reply.txt` holds Chief's words.

## Limits

The real `tailscale serve` path (`Link.setWeb({on})`) needs a signed-in tailnet and is not run in the lab. `test/pwa-pair.test.ts` covers the address check, the QR shape and the link pairing end to end on the stub engine.
