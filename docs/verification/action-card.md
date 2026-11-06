# The inline draft card

`done-done run action-card` (`scripts/verify/action-card.sh <out>`) drives real crewd on the stub engine, emulate's stateful Google and a real relay, in one lab. No real mailbox, no account, no model.

On the computer's own web app, at 390 and 1280, day and night, and in standalone window mode at 390:

- `waiting-*`: Scribe's draft in Chief's thread, the words in an editable box, Copy and Discard, `Waiting for you`.
- `draft-*`: the person's words in the box turn the state line to `Draft · your changes · nothing sent yet`.
- `phone-only-*`: Tracer's email is read-only there, Copy held, Discard live, and it says to approve on the paired phone.
- `receipts-*`: a double tap on Copy and a tap on Discard end `Copied, you send it` and `Discarded`. The script fails on any Sent and counts one `draft.approved`, one `draft.rejected`, no `mail.sent`.

Then `action-card-plan.mjs` installs the web app in a real Chromium window and pairs it as a control device: the person's words, **Review one email**, the Send card at each look (`paired/send-*`), a double tap on Send (`paired/send-once.webm`), the Sent receipt (`paired/sent-*`). `paired/sent.txt` is the witness: one `mail.sent` event, one message in emulate's Sent box, and emulate's own copy of the person's words.

Lab setup, stated rather than hidden:

- The organisation's attestation is a seeded settings row: the web app has no marking screen, that stays on the phone.
- `@byokit/connect` moves only its named Google presets onto the emulator, so `gmailsend` signs in on emulate's page with the authorize address swapped by the seed script and the code exchange routed by a lab preload (`scripts/verify/google-token-route.mjs`). The fix belongs in the kit.

Real Gmail stays under `find-clients-send.md`: never press Send on a real account without approval for that exact message.
