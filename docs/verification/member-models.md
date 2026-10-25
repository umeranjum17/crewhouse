# Per-member AI accounts

Run `done-done run member-models` (`node scripts/verify/member-models.mjs --out <dir>`): the real crewd on the stub engine, in an isolated lab.

- Chief takes the chat order "use ChatGPT for Scout" (the stub model carries it as a `crew_use` call) and answers in one line.
- `<crew folder>/models.json` then holds `{"scout": ["chatgpt:quick-1"]}`. It is the one store: a hand edit and a chat order are the same thing, and no other member moves.
- Scout's next job runs on that account (`run.started` in `crew.db`).
- A second account of one provider is signed in from Settings (a name of its own: `chatgpt.work`), listed beside the first, and given to Scout in the person's words: "use my second ChatGPT for Scout" (or "ChatGPT · work"). Its own line leads `{"scout": ["chatgpt.work:quick-1", "chatgpt:quick-1"]}` and Scout's next job runs on that account (`run.started` says `chatgpt.work`); the first account stays as its fallback, never a replacement.
- "Use Grok for Scout" with Grok signed out is refused in plain words and the file does not change.

A limit still waits for the person, and the wait names the account that ran out ("ChatGPT · work"), so two accounts of one plan never blur into each other: nothing moves a member to another account by itself.

Claude is the one provider whose second account cannot run yet: Claude Code keeps one sign-in per computer, and the engine binds a second in place but does not route on that binding (kit 0.28.1). Settings says so in plain words instead of offering a sign-in that would not work.

Frames: `CHROME_DEVTOOLS_AXI_SESSION=<name> done-done run member-models-screens` captures Chief's thread with the order and his reply, dark and light at 1280 and 390. Chief's two lines are scripted (`CREWHOUSE_STUB_GOLDEN`, because the app hides stub-prefixed replies); the `crew_use` call behind each really runs and `models.json` is checked.

Screens: `CHROME_DEVTOOLS_AXI_SESSION=<name> done-done run member-models-ui` (`scripts/verify/member-models-ui.sh`, after `npm run build:web`) shows the same map in Settings › AI accounts › **Who uses which** and on each member's page (**Which AI … uses**), with a second ChatGPT account signed in and named, listed in Settings and offered in every member's picker beside the first. It changes Quill to GitHub Copilot (Quick 1) with real clicks on Quill's row, checks `models.json` and that Quill's next job runs on that account, gives Scout a job that hits a limit (its row says it waits, in one line) and hand-deletes Reel's line (**Not chosen**). Captures: the account list with both ChatGPT accounts, one account's page with its second-account form, Who uses which, the open picker and Scout's page, dark and light at 360, 390, 445, 1280 and 1440, plus the list and Scout's page in the installed app. One motion recording (`motion/two-accounts.webm`, CDP screencast via `scripts/verify/record.mjs`) shows Chief's thread taking the order and naming "ChatGPT · work" in his reply, then the list where both accounts sit and Scout's row on the second. `test/member-models.test.ts` pins screen pick → file → Chief's roster → next run's model.
