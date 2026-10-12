# How Crewhouse works

The [README](../README.md) shows Crewhouse at a glance. This page is the longer tour: what each part of the app does for you, then the pieces underneath.

## Why Crewhouse exists

Your to-do list is full of small jobs that take an afternoon each: chasing a refund, comparing flights, planning the week's dinners, writing the thank-you note. AI can do most of them now, but only if it can act, and nobody wants a chatbot sending emails or placing orders on its own.

Crewhouse is your personal assistant: a crew that does the work and a calm place to say yes. You talk to Chief. Chief hands the job to the right helper: Scout looks things up, Scribe drafts, Reel makes videos, Tracer finds leads. Each helper is a folder on your disk that thinks with your own AI account. When a helper wants to send, spend or delete something, it asks you first, in one plain sentence, on your computer or your phone.

The helpers run on your own computer, with your own AI account sign-in. There is no Crewhouse server and no telemetry. What leaves your computer is what a job needs: your AI account, the pages and searches a helper opens, the apps you connected, and a content-free "Crewhouse has news" ping to your phone.

## Ask in your own words

Tell Chief what you need. He hands it to the helper who does that kind of work, or asks one short question when he isn't sure who that is. A job that should repeat ("weekdays 8am…") comes back as a routine card, and nothing is scheduled until you tap Start it.

## It asks before it spends

Helpers work in their own folders without bothering you. Anything that costs money asks every time. The card is built from what the shop's own page shows, never from the model's description of it. Sending, deleting, or opening something of yours also asks first. Some of those can get a standing "Always OK" (say, adding events to your calendar). Spending never can, and neither can acting as you on a site you signed a helper in to. Set your monthly spending cap under Settings → Money; every purchase still asks first.

## Drafts, never sent behind your back

When a helper writes in your name (a reply to the clinic, a refund chase, a cancellation email), it arrives as a draft. You approve it or you don't, and nothing is sent either way. The one exception is Tracer's find-clients emails, which can go from your own Gmail one at a time, each after a yes on your paired phone (see [Connected apps](#also-included)). For everything else the helper hands you the words to send yourself.

## Real files, ready to use

Ask for a spreadsheet or a document and you get a real `.xlsx` or `.docx`. The helper describes what goes in it, and Crewhouse builds the file. You can open it right in the chat to read it, or download it.

## A crew you can grow

Each helper has a soul (who it is, written by you), a job, its own skills and tools, and notes about you. Every note it keeps is a git commit you can undo. Add a helper from a template, or describe one to Chief and approve what he suggests.

Ask Chief to hire CTO to watch and nudge your terminal agents. It needs [Herdr](https://herdr.dev), installed by you, never bundled or installed by Crewhouse, and available on Crewhouse's PATH. On the computer, Settings → Your apps → Plugins shows its status: install it if missing, open Herdr once if it is not answering, then tap Retry. CTO's Tools settings let you revoke access. Looking asks first and can get a standing answer; every drive asks separately, showing the complete terminal arguments with **Yes, go ahead** / **Not now**. Terminal text read for the job goes to the helper's AI account.

## Routines, without the setup

"Every Friday 5pm" or "weekdays 8am" become routines that run on the computer's own clock. If the computer slept through one, it catches up once. If the last run is still going, the next one is skipped, not stacked. A quiet check-in only tells you when something changed. Chief's morning digest (what finished, what needs you, what's coming) is written by Crewhouse itself, so it uses none of your account.

## Sign in once, inside the app

There are no terminal logins and no API keys. The first time you ask for something, Chief puts a **Sign in with…** button under his reply, naming the account the crew will think with. That account's own page opens, you say yes, and the job starts. A one-time code is the fallback. Every account the engine supports is under Settings, Your AI accounts ([the list](supported-subscriptions.md)); each row says whether it uses a plan you already pay for or is charged to your account per use.

## Day and night, desk and pocket

The same app works at desktop and phone width, and switches to night colours in the evening. The Android app pairs with the computer by QR code or a typed code, over the home Wi-Fi, over Tailscale, or through a relay you run yourself. Its notifications only ever say "Crewhouse has news". The words themselves come over the encrypted link. Setup is in [Install and run](install.md#the-phone-app).

## Also included

- **Your personal assistant.** One install is for you and your crew of helpers. Ask in your own words, read what comes back, and tap yes when a helper needs you. No technical knowledge needed to use it.
- **Each helper's own computer (Linux).** A helper with the Computer tool gets its own virtual display and browser, never yours. Watch it live, take the wheel (the helper pauses until you hand it back), or show it how to do a task so it can keep the steps as a skill.
- **Connected apps.** Connect your Notion, Canva, Google Drive, Calendar or Gmail. A helper that needs one asks with a Connect card in the chat. Reading happens straight away; changing or sending asks first. Gmail sending is a separate connection, and each email it sends is its own card, approved on your paired phone. On the crew's own Google app a Google app connects in one tap; a computer without one needs a one-time setup under Settings → Google setup ([google-setup.md](google-setup.md)).
- **Picks up after a restart.** Stop the computer mid-job, start it again, and the job carries on in the same conversation. A question waiting on you is still there.
- **Learns how you work.** After a long job the helper can keep what it learned as a skill. You can review or forget what it kept on its page, and Settings can switch this off. Background learning stays out of your chats.

## Under the hood

```
 browser or phone app
        │ HTTP + WebSocket on 127.0.0.1 · the phone over an encrypted link
        ▼
 crewd ── SQLite (state, append-only events, per-helper queue)
   │ supervised child process, loopback + token
   ▼
 the bundled OpenClaw engine ── the retained m1 agent: your own sign-ins
   └─ one session per task ── every tool call passes crewd's gate first
        └─ tools: the helper's files, a sandboxed shell, the web, its own browser, the person's connected apps
```

- **crewd** (`src/`) is one Node process with one SQLite file. Every change is an event, and the web app and paired phones follow one event stream for the person. Model choices and engine failures keep their internal details out of that stream, including historical payloads. The web app reads crewd only through `web/src/adapter.ts`. The contract is [ui-contract.md](ui-contract.md).
- **The engine** is [OpenClaw](https://www.npmjs.com/package/openclaw), pinned and installed with scripts off by the pinned npm [`@byokit/openclaw`](https://github.com/umeranjum17/byokit) kit's `prepare()` during setup, update, packaging and CI (`scripts/prepare-engine.mjs`), and run through `src/openclaw/runtime.ts` as a child process with an environment built from nothing. It uses loopback only, with token auth, and channels, Control UI, Tailscale and mDNS are all off. Crewhouse never reads or runs your own agent setup (`~/.openclaw`, `~/.codex`, `~/.pi` and the like). `test/openclaw.test.ts` and `test/isolation.test.ts` check that on every CI run.
- **Tasks** are engine sessions on the retained `m1` agent, keyed by helper and task. A restart, or switching to another account when one hits its limit, continues the same session.
- **The gate** (`src/policy.ts`) decides every tool call from the tool and its input, never from the model's words. Unknown tools fail closed. Sign-in and key folders are refused outright. A question waits a few minutes, then the helper parks, and your later answer resumes it.
- **The shell** currently runs in bubblewrap (sandbox and network-proxy foundations are BYOKit migration debt): `/usr` and `/etc` read-only, an empty `/home` with only the helper's folder in it, and no inherited environment. A template can restrict a helper to a list of hosts, reached only through crewd's allowlisting proxy (`src/net.ts`).
- **On disk:** a helper is `~/Crewhouse/bots/<id>/` (`soul.md`, `AGENTS.md` for its job, `bot.json`, `skills/`, `files/`). What the crew knows about a person is in `~/Crewhouse/people/<id>/` (`about.md` and one `notes/<helper>.md` per helper), and every change is a git commit.
- **Tools** are curated manifests (raw installation/execution, browser SDKs and document libraries are BYOKit migration debt), one manifest per tool in `tools/<id>/tool.json`, saying what it does, its licence, and when it asks you first. Pinned tools install into Crewhouse's own folder, never globally and never with sudo. The browser is [playwright-axi](https://github.com/brycehamrick/playwright-axi) with its own Chromium. Command-line programs that use your own sign-in are typed tools, never shell.
- **Helpers' screens** (`src/desktop.ts`, desktop/streaming infrastructure is BYOKit migration debt) are one Xvfb display and one Chromium per helper, streamed to you with [desklink](https://www.npmjs.com/package/@desklink/host). DevTools goes over a pipe that crewd relays at a secret loopback path, so no other helper's shell can reach it.
- **Routing** a message to Chief uses [`@byokit/decide`](https://www.npmjs.com/package/@byokit/decide): rules for the obvious cases, then the person's own AI. The phone link and relay use [`@byokit/pair`](https://www.npmjs.com/package/@byokit/pair) and [`@byokit/relay`](https://www.npmjs.com/package/@byokit/relay).
- **Settings by environment:** `CREWHOUSE_STATE_DIR`, `CREWHOUSE_CREW_DIR`, `CREWHOUSE_TOOLS_DIR`, `CREWHOUSE_PORT` (default 7711), `CREWHOUSE_MAX_CONCURRENT` (default 3), `CREWHOUSE_RELAY`, and `CREWHOUSE_ENGINE=stub` (the scripted test model).

## Not yet

- An iPhone build, and a signed Android release. The iPhone app is set up (share sheet, shortcuts, Control Center buttons in `mobile/targets/actions`, and the crew on the Lock Screen and Dynamic Island in `mobile/src/island.ios.tsx`) but has never been built or signed. The Android app is a debug-signed preview, and its push notifications need the builder's own push credential. Editing a helper, signing in and connecting apps stay on the computer.
- Helpers' shell and screens on macOS and Windows. The desktop download is for Ubuntu and Debian; elsewhere you install from source.
- Signing in from the phone. For now, everyone signs in on the computer, in the browser, with a one-time code as the fallback.
- A per-person login. Anyone at the computer can pick who they are.

## Development

```bash
npm run check        # typecheck (tsc, strict)
./crewhouse test     # the suite, on a scripted model: no account, no network, no quota
```

`./crewhouse test` runs in a throwaway HOME and then checks that your own `~/.pi` sign-ins, settings and extensions are unchanged, byte for byte. CI runs the typecheck, the suite (`npm test`) and the web build on Node 22.22.3 and 24. Project conventions for contributors and coding agents are in [AGENTS.md](../AGENTS.md). The README's pictures are retaken with `node scripts/capture-readme.mjs <address>` against a stub-engine crewd.
