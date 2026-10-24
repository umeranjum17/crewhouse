# Per-member AI accounts

Run `done-done run member-models` (`node scripts/verify/member-models.mjs --out <dir>`): the real crewd on the stub engine, in an isolated lab.

- Chief takes the chat order "use ChatGPT for Scout" (the stub model carries it as a `crew_use` call) and answers in one line.
- `<crew folder>/models.json` then holds `{"scout": ["chatgpt:quick-1"]}`. It is the one store: a hand edit and a chat order are the same thing, and no other member moves.
- Scout's next job runs on that account (`run.started` in `crew.db`).
- "Use Grok for Scout" with Grok signed out is refused in plain words and the file does not change.

A limit still waits for the person: nothing moves a member to another account by itself (`test/member-models.test.ts`).

Frames: `CHROME_DEVTOOLS_AXI_SESSION=<name> done-done run member-models-screens` captures Chief's thread with the order and his reply, dark and light at 1280 and 390. Chief's two lines are scripted (`CREWHOUSE_STUB_GOLDEN`, because the app hides stub-prefixed replies); the `crew_use` call behind each really runs and `models.json` is checked.

Screens: `CHROME_DEVTOOLS_AXI_SESSION=<name> done-done run member-models-ui` (`scripts/verify/member-models-ui.sh`, after `npm run build:web`) shows the same map in Settings › AI accounts › **Who uses which** and on each member's page (**Which AI … uses**). It changes Quill to GitHub Copilot (Quick 1) with real clicks on Quill's row, checks `models.json` and that Quill's next job runs on that account, gives Scout a job that hits a limit (its row says it waits, in one line) and hand-deletes Reel's line (**Not chosen**). Captures: Who uses which, the open picker and Scout's page, dark and light at 360, 390, 445, 1280 and 1440, plus both screens in the installed app. `test/member-models.test.ts` pins screen pick → file → Chief's roster → next run's model.
