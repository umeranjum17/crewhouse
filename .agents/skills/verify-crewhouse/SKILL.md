---
name: verify-crewhouse
description: Drive the real Crewhouse app the way a person does — start crewd isolated on the stub engine, exercise the HTTP API and the web UI in a browser, capture evidence outside the repo. Use for any runtime proof, screenshot, regression check, or behavior question about crewd, the web app, or the phone-facing API.
---

# Verify Crewhouse

The product is `crewd` (`src/main.ts`), a local daemon serving the HTTP API and the web
app (`web/dist`) on loopback, with the crew's people, bots and tasks in SQLite under its
state dir. Everything below runs the **real daemon on the stub engine** (`CREWHOUSE_ENGINE=stub`):
the real server, real crew logic, real SQLite — only the model is the scripted stub from
`src/stub-runtime.ts`. No account, no network, no quota, no sign-in. The same journeys are
pinned as tests in `test/stub.test.ts` (HTTP) and `test/office.test.ts` (browser); this
skill is how you run them by hand against a live instance.

## Launch

Never drive a crewd you did not start. One instance per verification run:

```bash
LAB=$(mktemp -d /tmp/crewhouse-verify.XXXXXX)          # runtime state, removed at cleanup
EV=/tmp/crewhouse-verify-evidence.$$                   # evidence, survives cleanup
mkdir -p "$LAB/home" "$EV" "$LAB"/{state,crew,tools}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')

# In the repo (deps installed, web built: npm ci && npm run build:web — web/dist is gitignored):
env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node src/main.ts > "$EV/crewd.log" 2>&1 &
echo $! > "$LAB/crewd.spawn.pid"
```

- The env mask (`env -i` + full XDG set + dead D-Bus path) keeps the run off the owner's
  home, keyring and sign-ins; `src/main.ts` refuses data dirs inside the repo.
- Ready = log line `crewd listening on http://127.0.0.1:$PORT (engine: stub, …)` **and**
  `curl -fsS "http://127.0.0.1:$PORT/api/state"` returning JSON with a `person` key.
  Poll for the condition; never a fixed sleep (CI disks are slow).
- Teardown: `kill -TERM $(cat "$LAB/crewd.spawn.pid")` and wait for exit. crewd also
  writes its own pid to `$LAB/state/crewd.pid` — only ever kill the process you spawned.

## Doctor

`node src/doctor.ts` under the same env mask prints the machine's readiness and exits 0
when ready; it never reads a sign-in. Run it once per verification when anything looks off.
The live-instance doctor is the two readiness checks above (state endpoint answers, engine
is stub) plus `curl -fsS "http://127.0.0.1:$PORT/"` returning HTML.

## Drive

**HTTP (the app's own consumer path).** Every non-GET needs the header `x-crewhouse: 1`
(403 otherwise — same-origin CSRF guard). The canonical journey, from `test/stub.test.ts`:

```bash
B="http://127.0.0.1:$PORT"; H='-H content-type:application/json -H x-crewhouse:1'
curl -fsS "$B/api/state"                                   # person.name "Owner", bots list with chief
curl -fsS -X POST $H -d '{"address":"Sir"}' "$B/api/onboard"   # then /api/state shows person.address "Sir"
curl -fsS -X POST $H -d '{"text":"I need a demo video"}' "$B/api/bots/chief/messages"
# poll GET /api/bots/chief until the bot reply appears:
#   stub chief: done with "The person says: I need a demo video"
```

The stub answers any plain message with `stub <bot>: done with "<your text>"`, and executes
tool calls written into the message: `[tool crew_recruit {"template":"reel","name":"Reel"}]`,
`[tool crew_assign {"bot":"reel","task":"Make a 10 second demo"}]` (Chief then wraps up with
one `All done.` line; see `features/recruit-assign.md`). SQLite truth lives at
`$LAB/state/crew.db` (read-only probe: `node -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1],{readOnly:true})…'`).

**UI (browser).** Open `http://127.0.0.1:$PORT/` with the fleet's browser tool
(`chrome-devtools-axi` with `CHROME_DEVTOOLS_AXI_SESSION=<task-name>` — the default session
is shared across lanes; any CDP harness works, as `test/office.test.ts` shows). First run
shows the Hello screen (person's name, three ideas); picking one onboards and opens Chief's
thread. Layout is pure CSS, so `resize` then reload works: **1440×900** (desktop),
**390×844** (phone), and **320** wide as the narrowest probe — at 320, report what actually
happens (scroll, wrap, overflow) rather than assuming support. For a phone capture use
`chrome-devtools-axi emulate --viewport "390x844x3,mobile,touch"` (`"1440x900x1"` back to desktop).
Themes: `?day` or `?night` on the URL pins light or dark (otherwise the app follows the clock),
so a theme pair is two loads, e.g. `/?night#/h/scout`. For the longest-title probe,
use the longest visible strings (the standing jobs' idea asks, a helper's display name) and
prove placement with `eval` + `getBoundingClientRect`, not by looking at a screenshot.
`?demo` variants (`?demo=crew1|crew5|crew12|crew30|calm|office`, `web/src/demo.ts`) run
every screen with no crewd — fine for pure-UI layout checks, never a substitute for a real
drive. Anything a person sees also owes the Review evidence set below.

**Real model words** (a proof of what Chief or a helper actually says) need the real engine
and a signed-in account: run the same isolated launch without `CREWHOUSE_ENGINE=stub`.
For Claude proofs hold `/home/umer/firstmate/config/fm-cred-lock.sh` for the entire engine
lifetime, through `/home/umer/firstmate/config/fm-mem-gate.sh`. Use
`PATH=/home/umer/.local/bin:/usr/bin:/bin`, `MISE_OFFLINE=1`. After the log says
`crewd engine ready`, symlink only the dedicated test credential
`/home/umer/lab-tmp/claude-test-cred/home/.claude/.credentials.json` into
`$LAB/state/openclaw/home/.claude/.credentials.json`; never read/copy the person's credentials.
Check `claude auth status` with that engine HOME and CLAUDE_CONFIG_DIR and the engine's own
Claude CLI preflight before sending; select `["claude"]` with `PUT /api/bots/chief/models`.
A positive preflight does not witness a successful turn: the CLI may fail to refresh an
expired OAuth session. If the turn parks, inspect its terminal failure in the engine log,
retain pre/post results and stop; never infer admission from missing crewd tool events.
This route is hosted, not a scripted provider.
Stop crewd with TERM and await its exit before releasing the lock.
Sign-in tests alone reuse `/home/umer/lab-tmp/crewhouse-retained`; never copy its history.
Quota errors mean the account rests: report the bound, never mint another sign-in.

## Evidence

Write to `$EV` (outside the repo): the curl transcripts and their HTTP bodies, browser
screenshots, geometry eval results, `crewd.log`. Proof standards: exercise the real user
path (the API the app itself calls — never test-only endpoints or direct SQLite writes as
the *action*); capture the action and the resulting state (the reply message and the task
row, not just a final screen); verify side effects where the feature has them (files under
`$LAB/crew/bots/<bot>/files/`, rows in `crew.db`); label anything the stub cannot prove
(no real model words, no real sign-in) as a stub-engine result.

## Review evidence (fleet standard)

Every user-visible change carries its own proof, so no one has to ask for it twice. On
every run that touches what a person sees, capture **each changed screen in dark and in
light, at 390 and at 1440** (four files per screen), plus **one motion recording of each
changed interaction**, into one stable evidence folder that the PR body names. Text-only
runs (API, data, policy) skip this section — say so in the report rather than leaving it
silent.

### Mandatory: personal voice (one person, one assistant)

Crewhouse is a personal assistant for **one** person. No screen, capture or reply may speak
as if several people share it — the word list lives in
`scripts/personal-voice.mjs` (`TERMS`). The check runs automatically at the top of every
`scripts/screens.sh` capture, and by hand anywhere else:

```bash
node scripts/personal-voice.mjs               # the copy surfaces: demo seed, screens, prompts
node scripts/personal-voice.mjs --self-test    # its negative test (see below)
```

It scans the **rendered copy and the producers**: `web/src/demo.ts` (the seed and the
generator — the wording that once escaped was produced by a generator, so a copy-only sweep
would have missed it), the screen components in `web/src/*.tsx` and `mobile/src/*.tsx`, and
the prompts in `templates/`. Exit 0 clean, 1 a hit (each with file, line and term), 2 could
not run.

**A hit is a blocker, fixed at the producer** — the seed, the prompt or the component that
made the string. Never edit it out of a screenshot, a capture or a transcript, and never
weaken the term list to make a run pass; the word belongs to a product that serves one
person.

`--self-test` is the negative test: it writes a known-bad string (the exact wording that
merged once) and a clean one, and fails unless the checker flags the first and passes the
second. Run it and paste **both** lines into the PR. A later edit that empties the term
list makes the self-test fail instead of quietly passing every screen.

```bash
export CHROME_DEVTOOLS_AXI_SESSION=<task-name>          # never the shared default session
export CDP_PORT=9924                                    # Chrome's own port, distinct from the bridge's
FM_HOME=${FM_HOME:-$HOME/.treehouse/firstmate}          # the supervising firstmate home
EV=$FM_HOME/evidence/<task-name>/<change-slug>          # stable: named in the PR, survives cleanup
mkdir -p "$EV/screens" "$EV/motion"
```

For the custom-hire journey, use the verified native browser capture and recording recipe in
[`features/recruit-assign.md`](features/recruit-assign.md): the `screens.sh` and `record.mjs`
helpers below are absent at this revision. That recipe needs neither helper and retains
all four theme/width captures plus the approval recording.

**Four captures per changed screen** — `scripts/screens.sh <dest> <slug> <url> [extra-query]`
drives the app's own theme switch (`?day` / `?night`, `useLook` in `web/src/main.tsx`; the OS
colour scheme does nothing here) at both widths, and writes `<slug>-night-1440.png`,
`<slug>-night-390.png`, `<slug>-day-1440.png`, `<slug>-day-390.png`. Drive the real crewd
to the screen first; `?demo=…` only when the change is pure layout. Pair each capture with
the `eval` its feature file asks for — a screenshot alone proves nothing about a text-only
read.

**One recording per changed interaction** — Chrome's own screencast, so the motion is real
pixels:

```bash
# Launch scoped, before the first open of the run: the browser keeps this Chrome
# answering CDP so the recorder can screencast it. Its port is the bridge's port.
export CHROME_DEVTOOLS_AXI_CHROME_ARGS="--remote-debugging-port=$CDP_PORT"
node scripts/record.mjs --cdp "$CDP_PORT" --out "$EV/motion/office-switch.webm" --seconds 8 &
chrome-devtools-axi click @e12                          # the interaction under proof
wait                                                     # the recorder prints file + frame count
```

It prints the frame count and the span (first paint to last, so a settled screen is a
short clip); fewer than two frames means nothing moved or the wrong page was recording —
fix that, never file the empty clip. Record the interaction
a person performs (a tap, a send, the Chat↔Office switch), not a synthetic animation.
Reduce Motion (`chrome-devtools-axi emulate`, or `?demo=calm`) is its own case: with motion
off the screen must still say what changed.

**What this app does not have, so this section skips it** — say each skip in the report:

- **The native Expo app (`mobile/`) on its own screens.** A separate surface with its own build: these
  four web captures prove the computer's half, never the phone's. A PR changing `mobile/` runs the
  native proof in `features/phone-pairing.md` (`scripts/phone-pair.mjs`: an emulator whose camera reads
  the live code, the computer confirms, the phone lands on "You're in") and says so instead of claiming
  these four captures. A change to Chief's bubble or its panel runs `features/bubble-write-it-here.md`.
- **A third form factor.** 1440 (desktop) and 390 (phone) are the two widths the app is
  designed at; 320 stays the narrowest *probe* in the Drive section, reported as measured
  behaviour, not a fifth capture.

**PR body.** Name the evidence folder and the files (`screens/hello-night-1440.png`,
`motion/office-switch.webm`, …). Media is never committed; a public repo links the private
evidence page.

## Cleanup

Kill only what you started (`kill -TERM $(cat "$LAB/crewd.spawn.pid")`, wait, then the
browser session: `chrome-devtools-axi` stop). Verify: the port no longer answers, no crewd
process owns `$LAB/state/crewd.pid`, `$LAB` removed. Both `$EV` and the Review evidence
folder survive — a cleanup that eats the proof fails. Never kill by process name.

## Helpers

- `scripts/screens.sh <dest> <slug> <url> [query]` — the four design-bar captures of one
  changed screen (dark and light, 1440 and 390), after the mandatory personal-voice check.
- `scripts/personal-voice.mjs [paths…] [--self-test]` — the mandatory personal-voice check
  (one person, one assistant) over the demo seed, the screens and the prompts: exit 0 clean /
  1 a hit to fix at the producer / 2 could not run. `--self-test` is its negative test.
- `SERIAL=<emulator> node scripts/phone-ui.mjs texts | tap '<regex>' [n] | shot <png>` — the phone driven by what
  is on screen (uiautomator), for the bubble recipe.
- `scripts/record.mjs --cdp <port> --out <file.webm> --seconds 8` — one motion recording of
  a changed interaction: screencast frames timed by their own timestamps, muxed by ffmpeg.
- `node scripts/phone-pair.mjs --out <dir> [--serial …] [--base …] [--apk …] [--runs n]
  [--record]` — the native pairing proof (`features/phone-pairing.md`): the phone's camera
  reads the live code, the computer confirms, the phone reaches "You're in"; screenshots, an
  mp4 and `timings.json`.
- `node scripts/floor-guard.mjs` — the CONSTRAINTS.md floor on the current diff (exit 0
  clean / 1 violation / 2 could not run). Not app verification; run it before claiming done.
- `npm run check` (tsc, strict) and `npm test` (`scripts/test.mjs`, full isolated suite)
  are the repo's own gates; a verification run does not replace them.
- `docs/ui-contract.md` — what the web app may read from crewd; `web/src/adapter.ts` is the
  only reader. `test/ui.test.ts` keeps machinery words off screens.

## Maintenance

When the app changes out from under this map, run `/maintain-verification-skill` (the
fleet's global skill; source `/home/umer/firstmate/config/skills`) — every feature file
read against source and driven live, one PR of proven corrections at most.
