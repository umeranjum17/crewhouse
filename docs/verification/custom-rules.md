# Confirmed custom rules (A021, ch-user-rules)

Run `done-done run custom-rules` on a clean committed candidate. The journey uses
`scripts/verify/custom-rules.sh` and the repository's `pwa-shell.mjs` harness under
Xvfb (`xvfb-run -a`). No owner state, AI key, real model, mailbox or real account is
used: the one outward act is an add on emulate's stateful Google Calendar
(`test/emulate-google.ts`), connected the way Settings connects it.

Chief offers “Only prepare drafts. I will send messages myself.” on a **New custom
rule** card: a shield, the box (When the crew wants to: send messages, submit forms,
or make purchases or commitments; The crew should: only prepare a draft; In your
words), **Create rule** and **Cancel**. The API must still return no rules. Create
rule leaves **Saved** on the card. Cancel a different rule: its card must say
**Cancelled**, and the original rule must stay unchanged.

Then the rule at work. “Put lunch with Ada on my calendar for tomorrow at 1.” must
leave Chief's draft and crewd's own line “Held by your rule, so nothing has gone
out.”, with nothing added to the calendar. “Keep drafts, but when I say send, do
it.” offers an **Update custom rule** card naming what it replaces; Update rule.
“Send it.” adds the lunch exactly once. The calendar count is the emulator's, never
the helper's word. In the editable list, cancel one edit, then save a shorter-draft
instruction (the hold choice stays). Reload the daemon from the same private SQLite
state and check that only the edited confirmed rule survives.

The helper's scripted turn must produce a draft for Alex, not a send (a mail draft is
never held). `test/standing-rules.test.ts` checks the exact confirmed text in the
helper's actual RunSpec and that no safety permission was granted;
`test/google-emulator.test.ts` pins the hold, the update card, the one-call go-ahead
and that no permission card opened. This proves routing, context and the gate on a
scripted engine, **not** a real model's interpretation of arbitrary instructions.

Capture the new and update cards, the held line, the sent line, Saved/Cancelled
cards, the rules list, its edit form and the helper draft at 390×844 and 1440×900 in
day/night, plus a recording of the journey. The driver waits for the startup overlay
to leave, then records geometry and the scroll-container count beside each shot,
exact rule persistence, the calendar count, helper tool outcomes and the step
record. Open every shot; capture limitations are not a pass.

The phone app: on an owned emulator, with a release APK built from the head,

```bash
SERIAL=emulator-5612 bash scripts/verify/phone-rules.sh <out> <apk>
```

pairs to a lab (`pair-lab.sh` with `LAB_GOLDEN=1 LAB_GOOGLE=1`) by the typed relay
code and types the same four lines to Chief on the phone: the shield card and Create
rule, the held line, the Update card and Update rule, then “Send it.” and the sent
line, recorded in two parts; then Settings › Custom rules and its edit form, each at
390 wide, day and night. `lunches.json` must read 0, 0, 0, 0, 1.

`BASELINE=1 bash scripts/verify/custom-rules.sh <out>` captures the Settings hub of
an existing pre-change web build before rebuilding. Keep baseline captures outside
the final sealed run. The drivers tear down their private daemon, browser and lab;
evidence survives. Run the build and these journeys through the task's memory gate.
