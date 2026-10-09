# Find-clients: one guarded Gmail message

Source: `src/mail-send.ts`, `src/server.ts`, `src/link.ts`, `mobile/App.tsx` (`MailSetup`),
`web/src/adapter.ts` and `web/src/parts.tsx`. Finding and drafting remain in
`skills/find-clients/SKILL.md`; the draft itself never sends.

## Authority and prerequisites

Only an authenticated **control** phone may attest, prepare the send review or approve
an email. Local HTTP and the desktop refuse approval of Tracer email drafts and send
cards, even with forged `phone`/`person` fields. Watch-only phones cannot attest.
The computer connects the separate **Gmail sending** app in Settings through BYOKit;
reading Gmail alone does not grant sending. Its scopes are `openid`, `email`,
`gmail.send`; userinfo confirms the sending address. Never sign in to a real account
unless that sign-in is explicitly authorized. The real-send boundary below always holds.

## Repeatable offline integration proof

```bash
node --test test/mail.test.ts
```

The last journey starts the real HTTP server and real encrypted BYOKit phone link,
pairs control and watch-only fixture devices, and runs a real Tracer sandbox shell
attempt to approve a synthetic draft. It proves refusal of local approval/attestation,
unknown organisations, free-mail domains (attestation refused, suppression still
recordable), sole traders, small partnerships and suppressed addresses;
then creates one exact From/To/Subject/Body review card and backs out. It uses a
scripted model and a synthetic provider identity, never a real mailbox or a Send press.
The long body (100 grounded-opener repetitions) is the extreme case: every character
must survive in `detail.preview.body`; repeated Review calls must return the same card.
An attestation records person 1, authenticated phone, server time, organisation domain,
organisation name and type. The helper cannot supply this authority.

A send stranded by a stop between the durable claim and Gmail's answer (the mail ask
left in `sending`) becomes the same `check Gmail` card when crewd starts, so it shows in
Needs you and clears through the existing dismiss path; it is never re-sent or reopened.
`MailSend` reconciles this on construction, at the same startup where the server makes it.

## Real product drive and captures

Launch and health-check an isolated stub-engine crewd per `../SKILL.md` (OS-assigned
HTTP **and link** ports; link port 0 disables pairing). Generate a real Tracer email
draft through its normal `crew_write` and `crew_draft` dispatch. Pair the candidate
Android app using `phone-pairing.md`, on this task's own emulator. On the phone:

1. Open the draft; leave organisation unknown and tap **Review one email**. Capture
   the plain refusal. Name the organisation and tap **Sole trader**, then Review;
   capture the UK email-rules refusal. Repeat for Small partnership.
2. Mark **Corporate-eligible** from the person's own knowledge, once. This records
   eligibility only, never message approval. Tap **Do not email this address**, then
   Review; capture the suppression refusal. Remove suppression explicitly.
3. Stay in **Chief's thread** and tap **Review one email**. The separate approval
   belongs to Chief (`asks.bot = chief`), never a helper's Needs-you panel. Capture
   From, To, Subject and complete body with **Send** untouched, in dark/light, plus
   one recording of reaching this review. Scroll its body for long text. Open the
   original draft's sheet too: Chief and the organisation controls must remain
   reachable (the sheet scrolls). Inspect every capture; back out with **Not now**.
   Read-only SQLite probes must show zero `mail.approved`/`mail.sent` and an answered
   `not now` review. `/api/events` is the person-facing view, not the raw audit ledger.
4. On the desktop, drive `chrome-devtools-axi` directly: `open`, then `resize`
   (1440x900 or 390x844), a bounded dialog/body check with `eval`, then `screenshot`.
   Use `?day`/`?night`; the send button must be disabled and direct approval to the
   paired phone. Record geometry at 320, not assumed support. For before pictures,
   export base `web` **and `src/routines.ts`**: demo imports that shared file even on
   a live run. Check build exit before serving. After rebuilding, navigate a fresh
   URL: opening the same URL may retain the old document. Keep browser output in
   evidence (the wrapper redirects it away). Never claim web captures prove native.

Run the same real bot-shell curl denial before and after: POST
`/api/asks/<draft>/answer` with `x-crewhouse:1` and `answer:allow`; after the change it
returns 403, the card remains open and no `draft.approved` event exists. HTTP PUT
`/api/mail` with forged authority also returns 403. GET `/api/mail?to=<address>` is
read-only; only the authenticated control link may PUT an organisation type or
suppression change, POST `/api/mail/review {draft}`, or approve a send card.

## Hard stop and honest limitations

**Never press Send without Main approval for that exact message.** Successful Gmail
transmission, ambiguous-send recovery and the single-use claim under an actual send
remain **not proven: real send requires Main approval** in this lane. Read the code's
pre-send checks and durable claim, but do not relabel code inspection as runtime proof.
The claim is consumed before the network request; uncertain attempts are not retried.
Shared local front-door/pairing hardening is a separate follow-up, not a claim this
phone-only slice makes. No batch route or agent send tool exists.
