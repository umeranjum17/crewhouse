# Reply as a Gmail draft, and file an email

`mail draft <thread-id> <reply>` and `mail label <thread-id> <label>` reuse `MailSend` and
`effectOf`. The separate published Connect `gmailwrite` grant requests modify/compose;
reading alone cannot write. Each effect asks once, without a standing grant. Nothing sends.
The draft uses the default send-as address and signature, excludes every own send-as from
recipients, and refuses a thread with no correspondent. Its escaped Markdown becomes HTML
(headings, bold, lists; no active HTML, links or images). Provider failures reach the chat.

## Drive

Use the real `src/main.ts`, isolated per Launch, with the stub model and a synthetic HTTP
Gmail/OAuth transport only. Never use a personal mailbox or invoke sending. The retained
private driver is runnable from the candidate checkout:

```bash
EV=<firstmate-home>/data/evidence/ch-cap-email-reply-v2
bash "$EV/run-proof.sh" "$EV/api-new-run" > "$EV/api-new-run.log" 2>&1
```

The output directory must be fresh; existing proof is never overwritten. The driver owns
its server, HOME/XDG/state/crew, callback and mailbox. It exercises the real HTTP endpoints
and published Connect code, not saved-grant injection, and removes its scratch on exit.
Assert one card before each write, one draft/modify after approval, own address/signature
and formatted MIME, all-own-address refusal, invalid arguments without cards/writes, literal
write arguments (including `--full`), and zero sends. A parked approval must not authorize
another task/message/body: the grant and reused-card identity include all three. A synthetic
403 after creating a label must not claim that nothing changed.

## Screens and motion

Use the owned app's permission route `#/ask/<id>` and Apps `#/apps`. Capture day/night at
390/1440 in a normal tab and a genuinely installed PWA (see `pwa-shell.md`); assert the
loaded bundle and actual standalone media query. The draft says **Create draft**, the label
**Apply label**, both say **Nothing will be sent**, and neither exposes a raw thread id or
calls approval “Sent”. The draft preview retains headings/bold/lists and its entire text.
Apps says **On · changes ask first** for Gmail drafts & labels, not “read only”. Inspect all
captures. Record both real approval clicks, taking a fresh snapshot immediately before each
click; an elapsed recording or a stale ref is not interaction proof. Witness the resulting
HTTP mailbox writes and `mail.drafted` / `mail.labelled` events, not just the closing card.

Run `scripts/verify/look-check.mjs` on the card, inline chat and Apps at 360/1.3x, both themes.
A fixed modal scrim covering its sibling page is intentional; checks *inside* its dialog
remain active. The retained contained-overlap negative control must still fail.
The existing Crew journey in `test/mail.test.ts` covers these writes/refusals and a parked
approval crossing tasks; run it and the source-budget test in an isolated HOME.

## Limits

This is a real-app/stub-model/synthetic-mailbox result, not live Google, real model prose,
iOS/Android installation, or an actual send. The installed-PWA proof here is Chromium under
an owned Xvfb display. No credential or historical PASS is reused as fresh acceptance.
