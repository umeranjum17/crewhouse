# Crewhouse

[![CI](https://github.com/umeranjum17/crewhouse/actions/workflows/ci.yml/badge.svg)](https://github.com/umeranjum17/crewhouse/actions/workflows/ci.yml)

Local-first, open-source crew of persistent AI teammates run by Chief on your own signed-in agent CLIs.

You talk to **Chief**. Chief recruits bots from templates (Reel makes demo videos, Scout researches, Scribe drafts, Tracer finds leads) and hands them work. Each bot is a folder on your disk with its own persona, notes, skills and files. It runs the real, unmodified `claude` (or `codex`) CLI, signed in through the vendor's own login. Approvals and questions come to you in one place, from a desktop or phone browser.

Nothing leaves your machine: there is no server of ours and no telemetry, and Crewhouse never reads a CLI's credential files.

> Status: first working slice (MVP). Chief, Reel, approvals, the web app and the Herdr runner work end to end on Linux. Each bot with the Computer tool gets its own desktop you can watch and take over. Phone pairing, push, routines and Codex turns come next; see "Not yet".

## Quick start

You need Linux or macOS, [Node](https://nodejs.org) 22.18 or later, [Herdr](https://herdr.dev) 0.9.x, and [Claude Code](https://claude.com/claude-code) signed in with your own account (run `claude` once).

```bash
git clone https://github.com/umeranjum17/crewhouse && cd crewhouse
./crewhouse setup     # installs dependencies, builds the web app, offers the tool kit, checks your machine
./crewhouse start     # starts crewd and prints the address, http://127.0.0.1:7711
```

Open the address. Chief introduces himself and asks how to address you. Then try:

> Please recruit Reel and have it make a 6 second title card that says Crewhouse.

Chief recruits Reel and hands it the task. When Reel wants to run something outside its allow list, it shows up under **Needs you**. Tap **Allow once** and the video appears in Reel's chat and on its **Files** tab.

Other commands: `./crewhouse doctor` (what's installed, what's missing, how to add it), `./crewhouse tools [install [ids...]]` (the tool kit) and `./crewhouse test` (the test suite; it uses a stub runner, so it needs neither Herdr nor a signed-in CLI and uses no model quota). CI runs the typecheck, the web build and this suite on every pull request.

## How it works

```
 browser (desktop or phone width)
        │ HTTP + WebSocket, 127.0.0.1 only
        ▼
 crewd ── SQLite (state, append-only events, per-bot queue)
   │  one Runner interface → HerdrRunner
   ▼
 Herdr session "crewhouse" ── one workspace per bot, cwd = the bot's folder
   └─ real `claude` in each pane ── its own hooks call back into crewd (bin/crew hook …)
```

- **crewd** (`src/`) is one Node process with one SQLite file (`node:sqlite`). Every change is an event; the UI follows the event stream over a WebSocket.
- **The runner** (`src/runner.ts`) is the only place that knows how CLIs run. `HerdrRunner` starts each bot's CLI in its own Herdr workspace inside crewd's own `crewhouse` session, never your `default` one. `StubRunner` backs the tests.
- **Facts come from the CLI's own hooks, not from reading the screen.** Crewhouse writes them into each bot's `.claude/settings.local.json`:
  - `PermissionRequest` holds a tool call while you decide. After 3 minutes it denies with "wait", and your later answer resumes the same session.
  - `Stop` delivers the finished turn and its answer.
  - `SessionStart` records the session id; `PostToolUse` produces the activity lines.
  - The statusline reports your plan's usage windows.
  - Herdr's lifecycle (idle, working, blocked) is the fallback, plus the live terminal behind **Show the work**.
- **Bots on disk** live at `~/Crewhouse/bots/<name>/`: `AGENTS.md` (persona), `CLAUDE.md` (imports persona, notes and how to address you), `notes.md` (what it learned, capped at 2,500 characters), `skills/*/SKILL.md` ([agentskills](https://agentskills.io) format), `files/` (deliverables) and `work/`. Bots start with `--setting-sources project,local`, so only their own skills and settings load; your global Claude setup stays out.
- **Tools** are a curated kit, one manifest per tool in `tools/<name>/tool.json`: what it does, its licence, how it installs and when it **asks you first**, in plain words (shown on the recruit card and the bot's Tools tab).
  - Pinned tools install into Crewhouse's own folder (`~/.local/share/crewhouse/tools/`), never globally and never with sudo: the browser ([Playwright MCP](https://github.com/microsoft/playwright-mcp) with its own Chromium), [MarkItDown](https://github.com/microsoft/markitdown) and [yt-dlp](https://github.com/yt-dlp/yt-dlp) (checksum-verified). System tools (gh, ffmpeg, ImageMagick, ripgrep, jq) are detected, and doctor prints the install line. Web search and fetch are the CLI's own.
  - A bot's grants become its CLI's allow list, its own MCP config (`--strict-mcp-config`, so your MCP servers stay out) and PATH. Anything else asks you first; file edits outside the bot's folder ask; credential folders are always denied. A tool that spends money lists its commands under `ask`, which asks you every time, even over an allow rule.
  - Each bot's browser has its own profile in `bots/<name>/browser/`. A `PreToolUse` hook asks you before a click or keystroke on a checkout or payment page, or on a site listed in the bot's `bot.json` `signedIn`.
- **Each bot's own desktop** (the Computer tool, Linux): when a task starts, crewd gives the bot a virtual display (`Xvfb :1NN`, 1280×800, its own X cookie) with its own Chromium on it, profile in `bots/<name>/browser/`. The browser MCP drives that Chromium over CDP, and the bot's CLI gets `DISPLAY` for that display only, never yours. The desktop stops after 10 idle minutes.
  - On the bot's **Screen** tab, **Watch** streams it live through [desklink](https://www.npmjs.com/package/@desklink/host) (WebRTC, view only). crewd starts the desklink engine and picks the display and permissions; the page never can.
  - **Take over** pauses the bot: its turn is interrupted and every tool call is refused ("the owner has the controls; wait") until you **Give back**, which resumes its task with your note of what you did. Use it to sign the bot's browser in to a site.
  - Needs Xvfb and Chromium; `./crewhouse doctor` names what is missing.

  | Watch | Take over | Phone width |
  |---|---|---|
  | ![Watching Scout's screen](docs/screenshots/desktop-watch.webp) | ![You have the controls](docs/screenshots/desktop-drive.webp) | ![Phone width](docs/screenshots/desktop-phone.webp) |
- **Skills** live in a shared library (`skills/`, agentskills format). Each template lists the ones it starts with, and the bot gets its own copy.
- **Tracer** finds people, work emails and phone numbers through [treg](https://github.com/superdesigndev/treg) (Apache-2.0 with an added no-hosted-resale term; Crewhouse only calls your installed `treg` CLI). Setup is yours, in your own terminal: `curl -fsSL https://treg.to/install.sh | sh` (Python 3.12 or 3.13), then `treg login` (new accounts get $1 of credit). Your own provider keys (`treg secret add`, or the treg dashboard) are used first and never billed by treg. Searching the catalog and reading prices is free and needs no account. Every paid `treg call` comes to you as an approval, and the command shows its price cap (`X-Treg-Route-Max-Cost`, which treg enforces on its routed people endpoints). No key ever goes into Crewhouse, and bots can't read `~/.treg`.
- **A household.** One person needs nothing new. Add someone under **Settings, People** and they get their own thread with Chief (who asks how to address them), their own bots, tasks and questions, and quiet hours during which a bot's question waits instead of holding the bot (standing answers still apply). The screen's owner is picked under **Who is using this screen?**; it is a view, not a login.
  - **Each person runs on their own AI accounts.** Anthropic's and OpenAI's terms forbid making your account available to anyone else, so crewd never lends one. The owner keeps the CLIs' usual sign-in; everyone else gets their own config homes (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) under `~/.local/state/crewhouse/people/<id>/`, and signs in from **Settings, AI accounts**, which runs the vendor's own `claude auth login` or `codex login --device-auth` and shows its link and code. Readiness comes from `claude auth status` and `codex login status`; crewd never reads what they store, and bots are denied those folders.
  - A task runs on the accounts of whoever asked for it (Chief's hand-offs too), so a bot switches sessions when the next task is someone else's. Limits and "resting until" are per person: one person's spent week never pauses another's work, and nobody's work falls back onto someone else's account.

  | Settings | Signing in | Sam's Home |
  |---|---|---|
  | ![People and AI accounts](docs/screenshots/people-settings-owner.webp) | ![ChatGPT device sign-in](docs/screenshots/people-signin-sam.webp) | ![Sam's own Home](docs/screenshots/people-home-sam.webp) |
- **Routines** hand a bot the same task on a schedule, written in plain words by this computer's clock: "every Monday 9:00", "weekdays 8am", "every day 7:30pm", "every 2 hours" (`src/routines.ts`). Add one on the **Routines** screen or a bot's Routines tab, or just tell Chief ("every Friday at five, have Reel make a demo of what shipped"), who sets it up with `crew routine`. Each routine can pick its own model, and runs on the accounts of whoever set it up.
  - The schedule lives in SQLite and crewd's own loop fires it: no cron, no model call to decide when. A computer that slept through a run catches up **once** when it wakes; if the last run is still going (or waiting on you), the next one is **skipped**, not stacked. A paused routine never catches up. Every card shows the next run and the history.
  - **Chief's morning digest** is on for everyone at 8:00: while you were away, what finished, what didn't go well, what needs you and what is coming up, in your own thread with Chief. It is written by crewd, so it costs no tokens. Move it or pause it under Routines.

  | Routines | Adding one from a bot's page | Chief sets one up, then the digest |
  |---|---|---|
  | ![Routines](docs/screenshots/routines-list.webp) | ![Adding a routine](docs/screenshots/routines-add.webp) | ![Chief and the digest](docs/screenshots/routines-chief.webp) |
- **The crew tool** (`bin/crew`) is how bots talk to crewd: `report`, `deliver`, `remember`, and for Chief, `recruit`, `assign`, `routine` and `call-me`. Each bot carries its own token.

Data lives outside the repo: the database is in `~/.local/state/crewhouse/`, the bots in `~/Crewhouse/`. The tool kit is in `~/.local/share/crewhouse/tools/`. Override with `CREWHOUSE_STATE_DIR`, `CREWHOUSE_CREW_DIR` and `CREWHOUSE_TOOLS_DIR`. Other settings: `CREWHOUSE_PORT` (default 7711), `CREWHOUSE_HERDR_SESSION` (default `crewhouse`), `CREWHOUSE_MAX_CONCURRENT` (default 3) and `CREWHOUSE_RUNNER=stub`.

## Not yet

- The phone app (Expo) and phone pairing with an encrypted link. The web UI is plain React with shared `tokens.ts` and `api.ts`, so the Expo app can reuse both. Today it works at phone width on the same machine, because crewd listens on 127.0.0.1 only.
- Push notifications (they will follow each person's quiet hours), triggers (a folder or a webhook), Telegram. A per-person login: on this computer anyone can pick who they are.
- Bot desktops on macOS (desklink is Linux only), watching from another device (crewd listens on 127.0.0.1), and a sandbox that hides your own X display from a bot's shell. A bot's `signedIn` list is still edited by hand in its `bot.json` after you sign it in.
- Codex turns. The runner starts `codex` with its `notify` hook, `--search` and the granted MCP servers wired in, but this path is untested, and Codex has no hook for the browser's asks-first rules.
- The crew tools as an MCP server (today they are the `crew` CLI), limit-based fallback between accounts, and Undo for memory.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
