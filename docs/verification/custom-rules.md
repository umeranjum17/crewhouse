# Confirmed custom rules (A021)

Run `done-done run custom-rules` on a clean committed candidate. The journey uses
`scripts/verify/custom-rules.sh` and the repository's `pwa-shell.mjs` harness under
Xvfb. No owner state, AI key, real model, mailbox or send is used.

Chief offers “Only prepare drafts. I will send messages myself.” on a **Confirm
custom rule** card, with the complete text, **Create rule** and **Cancel** visible.
The API must still return no rules. Create rule leaves **Saved** on the card and a
link to **Settings › Custom rules**. Cancel a different rule: its card must say
**Cancelled**, and the original rule must stay unchanged. In the editable list,
cancel one edit, then save a shorter-draft instruction. Reload the daemon from the
same private SQLite state and check that only the edited confirmed rule survives.

The helper's scripted turn must produce a draft for Alex, not a send. The HTTP
integration journey in `test/standing-rules.test.ts` additionally checks the exact
confirmed text in the helper's actual RunSpec and that no safety permission was
granted. This proves product routing and context on a scripted engine, **not**
a real model's interpretation of arbitrary instructions. Custom rules never alter
the separate safety policy, tool grants or per-action approvals.

Capture confirmation, Saved/Cancelled cards, the rules list and the helper draft
at 390×844 and 1440×900 in day/night, plus a recording of confirmation/editing.
The driver waits for the startup overlay to leave, then records geometry and the
scroll-container count beside each shot, exact rule persistence, helper tool
outcomes and the step record. The A021 journey is browser-only: installed-app
capture was explicitly excluded from its acceptance scope; it is not witnessed.
Open every shot and compare the confirm/save/list journey with the approved
custom-rule reference; capture limitations are not a pass.

Native parity: on an owned emulator paired to this same lab, open Chief's rule
card, save/cancel, then Settings › Custom rules, edit and cancel/save. Capture both
themes. The web driver does **not** certify the native APK or iPad Safari.

`BASELINE=1 bash scripts/verify/custom-rules.sh <out>` captures the Settings hub of
an existing pre-change web build before rebuilding. Keep baseline captures outside
the final sealed run. The driver tears down its private daemon, browser and lab;
evidence survives. Run the build and this journey through the task's memory gate.
