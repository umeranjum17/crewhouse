# Pair the PWA and get a real Chief reply

The core user journey, end to end on the real product: a person pairs the app to their own crew and Chief really
answers. The stub engine's `stub <bot>:` lines are hidden by the app on purpose (`STUB` in `web/src/adapter.ts`,
pinned by a test), so only the real route can show a reply — this drive runs the real engine (OpenClaw through the
BYOKit kit) on the account the person signed in with.

## Drive and witness

`scripts/verify/pair-chat.sh <out-dir>` (done-done journey `core`). One isolated
lab, all of it the person's own machine and nothing else:

- the real engine in a private HOME, XDG, state, crew and tools dir, on an OS-assigned port, with the kit's engine
  set in `CREWHOUSE_ENGINE_DIR` (the repo's own `runtime/openclaw` by default, so a later run reuses it);
- the repo's own relay (`relay/main.ts`, open signup) — the way a browser away from the computer reaches it;
- the built web shell served from a public-style origin (`http://crewhouse.localhost:<port>/`,
  `scripts/verify/serve-web.mjs`), because crewd itself answers only loopback;
- one Chromium under Xvfb (`scripts/verify/pwa-shell.mjs` with `scripts/verify/pair-chat-plan.mjs`).

The sign-in is the person's own: the key comes **by path** (`CHAT_KEY_FILE`, the repo's usual place,
`~/.config/openrouter/api_key`), is read into the sign-in request and nowhere else — never printed, logged, copied
or kept — and the key is never taken from an environment variable. The model is the
account's own — `openrouter:minimax/minimax-m3.1-flash:free`, the free MiniMax M3.1 Flash — named in Chief's
`bot.json` before the run, because the picker cannot choose a key sign-in's models (the engine's catalogue lists
them as unavailable) and the kit registers the model the bot already names. A model id may hold a colon
(`vendor/model:free`), which is why `parseBrain` splits on the first colon only.

What the person does, in the app: open it, tap "On my computer", paste the code the computer prints, check the two
words are the same, say hello. Chief answers in his thread.

## Capture

- `two-words-390.png` — the pairing in the person's hands ("coast beacon", "If they match, say yes there").
- `chief-reply-{day,night}-{390,1440}.png` — Chief's thread with the person's message and his real answer, in both
  looks and both widths.
- `reply.txt` — the words, the model that wrote them, and what was asked.
- `run.json` — every step of the drive; `steps.json` — the step record; `crewd.log`, `ready.txt`.

## The upgrade path

`scripts/verify/upgrade.sh <out-dir>` (done-done journey `upgrade`): the app ships
as an npm package with a bin, so the release path is the published one. The version before this checkout's is
installed into a throwaway prefix, this checkout's build is packed and installed **over it in place**, and the
upgraded app (its own daemon and its own web app, both from the installed package) runs the core journey above.
`upgrade.txt` names the version before and after.

## Limits

- The journey needs network (the sign-in, the model call, the engine set the first time) and a key in the
  environment; it is the one journey that spends model calls (the free model, no money).
- The browser is Chromium under Xvfb, not the person's own browser: the pairing, the words and the answer are the
  real product's, the browser is the harness.
- The `phones` command of the installed npm package cannot run (it reads `src/config.ts`, which the package does
  not ship); the drive uses the checkout's CLI against the installed daemon, which only talks to it over HTTP.
