# Per-member AI accounts

Run `done-done run member-models` (`node scripts/verify/member-models.mjs --out <dir>`): the real crewd on the stub engine, in an isolated lab.

- Chief takes the chat order "use ChatGPT for Scout" (the stub model carries it as a `crew_use` call) and answers in one line.
- `<crew folder>/models.json` then holds `{"scout": ["chatgpt:quick-1"]}`. It is the one store: a hand edit and a chat order are the same thing, and no other member moves.
- Scout's next job runs on that account (`run.started` in `crew.db`).
- "Use Grok for Scout" with Grok signed out is refused in plain words and the file does not change.

A limit still waits for the person: nothing moves a member to another account by itself (`test/member-models.test.ts`).

Frames: `CHROME_DEVTOOLS_AXI_SESSION=<name> done-done run member-models-screens` captures Chief's thread with the order and his reply, dark and light at 1280 and 390. Chief's two lines are scripted (`CREWHOUSE_STUB_GOLDEN`, because the app hides stub-prefixed replies); the `crew_use` call behind each really runs and `models.json` is checked.
