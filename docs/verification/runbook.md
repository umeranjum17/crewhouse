# Verification runbook

The product is `crewd` (`src/main.ts`), a local daemon serving the HTTP API and the web
app (`web/dist`) on loopback, with the crew's people, bots and tasks in SQLite under its
state dir. Everything below runs the **real daemon on the stub engine** (`CREWHOUSE_ENGINE=stub`):
the real server, real crew logic, real SQLite — only the model is the scripted stub from
`src/stub-runtime.ts`. No account, no network, no quota, no sign-in. The same journeys are
pinned as tests in `test/stub.test.ts` (HTTP) and `test/office.test.ts` (browser); this
runbook is how you drive the feature recipes through done-done against a live instance.

## Launch

Never drive a crewd you did not start. One instance per verification run:

```bash
LAB=$(mktemp -d /tmp/crewhouse-verify.XXXXXX)          # runtime state, removed at cleanup
EV=${DONE_DONE_EVIDENCE_ROOT:?run through done-done}    # evidence, survives cleanup
mkdir -p "$LAB/home" "$EV" "$LAB"/{state,crew,tools}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')

# In the repo (deps installed, web built: npm ci && npm run build:web — web/dist is gitignored).
# crewd leads a process group of its own (setsid; with no job control setsid never forks, so
# $! is crewd) and dies with this shell (setpriv's parent-death signal).
set +m
setsid setpriv --pdeathsig KILL -- env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node src/main.ts > "$EV/crewd.log" 2>&1 &
CREWD=$!; echo "$CREWD" > "$LAB/crewd.spawn.pid"
for _ in $(seq 100); do kill -0 -- "-$CREWD" 2>/dev/null && break; sleep 0.05; done   # the group exists: it is crewd's
gone() { ! kill -0 -- "-$CREWD" 2>/dev/null; }
drain() { kill "-$1" -- "-$CREWD" 2>/dev/null; for _ in $(seq 100); do gone && return; sleep 0.05; done; gone; }
cleanup() { trap '' HUP INT TERM; drain TERM || drain KILL || { echo "crewd's group outlived KILL; keeping $LAB" >&2; return 1; }; rm -rf "$LAB"; }
trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
```

- The env mask (`env -i` + full XDG set + dead D-Bus path) keeps the run off the owner's
  home, keyring and sign-ins; `src/main.ts` refuses data dirs inside the repo.
- Ready = log line `crewd listening on http://127.0.0.1:$PORT (engine: stub, …)` **and**
  `curl -fsS -H x-crewhouse:1 -H "Authorization: Bearer $(<"$LAB/state/person.key")"
  "http://127.0.0.1:$PORT/api/state"` returning JSON with a `person` key.
  Every `/api` read needs the person's authority, like every write; loopback alone proves nothing.
  Poll for the condition; never a fixed sleep (CI disks are slow).
- Teardown is `cleanup` above (`scripts/verify/screens-smoke.sh` and `stub-drive.mjs` do the
  same; `test/verify-tools.test.ts` holds them to it): TERM to crewd's whole process group
  (`kill -TERM -- -$CREWD`), KILL after a 5 s grace, then wait until `kill -0 -- -$CREWD` finds
  no member. Only an empty group lets `$LAB` go; a group that outlives KILL keeps it. crewd also
  writes its own pid to `$LAB/state/crewd.pid` — only ever signal the group you spawned, never
  your shell's own, a shared one or another lab's.

## Doctor

`node src/doctor.ts` under the same env mask prints the machine's readiness and exits 0
when ready; it never reads a sign-in. Run it once per verification when anything looks off.
The live-instance doctor is the two readiness checks above (state endpoint answers, engine
is stub) plus `curl -fsS "http://127.0.0.1:$PORT/"` returning HTML.

**Desktop prerequisites:** the shared readiness check runs the engine's non-prompting
`capabilities` command with a three-second bound, not just an executable-file check.
The engine is probed per engine key (engine override, PATH, LD_LIBRARY_PATH), at boot first. A
definite answer (ready, or a named missing library) is kept for the whole crewd process; a library
installed, removed, or an engine broken in place while crewd runs is seen only after a restart. Any
other answer (timeout, spawn failure, nonzero exit) is kept for sixty seconds, then probed again.
A loader failure must name its library and an install command; doctor exits nonzero,
the Computer kit row is unavailable, and the live `GET /api/state` has
`desktops.ready: false`. Under the isolated env above, run
`node --test --test-name-pattern='desktop setup refuses' test/stub.test.ts`:
the real HTTP server and doctor are driven against a task-private command that emits
the native loader's refusal for libevdev and for an unknown library. This synthetic
prerequisite failure is not proof that the host itself lacks either library.
Also run doctor and the live state on the normal engine; never remove a host library
to reproduce the failure. The desktop **start** refuses with the same words, at start:
[desktop-start refusal](desktop-start-refusal.md). No UI layout or motion changed by this CLI/API readiness check.

## Drive

**HTTP (the app's own consumer path).** Follow the authority contract in
[`docs/ui-contract.md`](../ui-contract.md).
Read the capability only from your own `$LAB/state/person.key`; never from the owner's
install. The canonical journey, from `test/stub.test.ts`:

```bash
B="http://127.0.0.1:$PORT"; PERSON=$(<"$LAB/state/person.key")
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON") # never log the capability
curl -fsS "${H[@]}" "$B/api/state"                        # person.name "Owner", bots list with chief
curl -fsS -X POST "${H[@]}" -d '{"address":"Sir"}' "$B/api/onboard"   # then /api/state shows person.address "Sir"
curl -fsS -X POST "${H[@]}" -d '{"text":"I need a demo video"}' "$B/api/bots/chief/messages"
# poll GET /api/bots/chief until the bot reply appears:
#   stub chief: done with "The person says: I need a demo video"
```

The stub answers any plain message with `stub <bot>: done with "<your text>"`, and executes
tool calls written into the message: `[tool crew_recruit {"template":"reel","name":"Reel"}]`,
`[tool crew_assign {"bot":"reel","task":"Make a 10 second demo"}]` (Chief then wraps up with
one `All done.` line; see `recruit-assign.md`). SQLite truth lives at
`$LAB/state/crew.db` (read-only probe: `node -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1],{readOnly:true})…'`).

**UI (browser).** Bootstrap only your owned browser with the private launcher URL
`http://127.0.0.1:$PORT/#person=<contents of $LAB/state/person.key>`; the app removes the
fragment and keeps authority in that tab's sessionStorage. Subsequent themed loads use
the same tab. No API read or public page may mint or return this capability.
Open with the fleet's browser tool
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
Stop crewd's process group as in Launch (TERM, KILL after the grace, wait until it is empty) before releasing the lock.
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

## Finished-action receipt

See [Chief's finished-action receipt](done-receipt.md): an approved order's actual browser result, complete facts, muted approval outcome, and approved follow-up, with web/PWA/native proof and its runnable private-shop driver.

## Gmail drafts and labels

See [Reply as a Gmail draft, and file an email](mail-reply-labels.md): real app and
published Connect grants against a private HTTP mailbox, one card per write, formatted
own-sender drafts, parked approval identity, refusals, and normal/installed-PWA captures.

## Headless Linux host

See [Headless host and first-phone authority](headless-host.md): portable-artifact setup, private tailnet relay, first-phone owner enrolment, scripted integration gate and the real phone's printed-code journey. Ordinary desktop pairing remains unchanged.

## Person authority (shared ingress)

Run the real paired-phone journey with `node --test test/link.test.ts` under an isolated
HOME/XDG/TMPDIR. It pairs a control phone with Noise, asks for a synthetic unsent draft,
then drives an unfenced Tracer shell's exact public-header HTTP approval attack: expect
403, the ask still open and no `draft.approved` event. Answer through the paired phone:
expect 200 and the event. Pairing approval itself also requires the private computer
capability; a phone cannot approve itself, and a view-only grant cannot write.
For the original `probe-person-authority.mjs`, adjust only the owned repo/evidence/scratch
paths and legitimate setup calls to use the owned `person.key`; leave the shell's forged
POST without authority. Wait for its recorded shell result, then witness denial and the
unchanged ask, rather than waiting for the old success event. Never send real mail.
This is API-only proof: no changed screen, screenshots or motion required.

## Cloud public relay address

See [Public relay pairing](relay-public.md): real crewd on the stub engine dials a private relay,
while its offer and typed code advertise a separate public proxy. The kit's phone side resolves and pairs
through that proxy, reads the public route and gets a finished Chief turn. This is backend/API-only proof.

## Review evidence (fleet standard)

Every user-visible change carries its own proof, so no one has to ask for it twice. On
every run that touches what a person sees, capture **each changed screen in dark and in
light, at 390 and at 1440** (four files per screen), plus **one motion recording of each
changed interaction**, into one stable evidence folder that the PR body names. Text-only
runs (API, data, policy) skip this section — say so in the report rather than leaving it
silent.

### Mandatory: look check (360 wide, largest text, light and dark)

Every UI change runs `scripts/verify/look-check.mjs` on each changed screen before it claims done;
eyeballing the 390/1440 captures does not replace it. It measures what a person sees at the
hardest size: a 360-wide screen with the largest text, in light and in dark. A screen is
**web/PWA** (headless Chromium, every text box × 1.3) or **Android** (the emulator at 360 dp
with the system's largest `font_scale`), and it runs on Android whenever the native shell draws
the screen differently (`mobile/`). Any hit fails the change: fix it, or name it in the PR as a
known defect with its crop.

```bash
L=scripts/verify/look-check.mjs; export FM_HOME=<firstmate home>   # mocks resolve there
node $L web --out "$EV/look" --person "$LAB/state/person.key" chief-chat="$B/#/chief" crew="$B/#/crew"
node $L web --out "$EV/look" --then "document.querySelector('[data-mode=office]')?.click()" office="$WEB/?demo=office"
SERIAL=<your emulator> node $L android --out "$EV/look" --then 'Settings>>Your crew' crew   # taps reach the screen
node $L shot --out "$EV/look" captain-photo=/path/to/phone-shot.png   # someone else's shot: strips and mock only
```

Checks, each with the element and a red-outlined crop (`hits/`), and exit 0 clean / 1 a hit / 2 could not run:

- **stretched**: a picture drawn off its own shape by more than 3% (an `<img>`/video with `object-fit: fill`,
  a canvas, an SVG with `preserveAspectRatio="none"`, a sized background image; on the phone, a dot-drawn helmet
  whose cells are not art.ts's 10:16).
- **clipped**: words running past a box that hides overflow. A designed cut (ellipsis, line clamp) passes while it
  shows at least half; a hard cut always fails.
- **overlap**: a sibling on top of another's words or pictures (covering padding is layout; a sticky bar over a page
  that still scrolls is content passing under it; a sibling pulled on by a negative margin is a stack on purpose).
- **offscreen**: a part past the screen's sides, a fixed part past its bottom, or a page that scrolls sideways.
- **strip**: a one-colour band at a screen edge (at least 6 px and 1.5% of the side) that is not one of the theme's
  page colours (`web/src/tokens.ts` bg/surface/sunken).

Each shot is saved beside its approved mock (`<slug>-<theme>-vs-mock.png`). **Where mocks live:** approved mocks
stay in the Firstmate home, never in the repo; `scripts/verify/mocks.tsv` maps a screen slug to its mock path under
`$FM_HOME` (`{theme}` = day|night). A mock counts as approved only when a Main message approves that mock round
(`data/done-archive.md`, `data/backlog.md`); the newest approved round wins, and adding a row is part of the change
that brings a new approved mock. A screen with no row says "(no approved mock)" in every report. Recipe, tuning
evidence and limits: [look-check.md](look-check.md).

### Mandatory: personal voice (one person, one assistant)

Crewhouse is a personal assistant for **one** person. No screen, capture or reply may speak
as if several people share it — the word list lives in
`scripts/verify/personal-voice.mjs` (`TERMS`). The check runs automatically at the top of every
`scripts/verify/screens.sh` capture, and by hand anywhere else:

```bash
node scripts/verify/personal-voice.mjs               # copy sources
node scripts/verify/personal-voice.mjs --self-test    # negative test
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

For the custom-hire journey, retain the approval recording and all four theme/width
captures required by [recruit-assign.md](recruit-assign.md).

**Four captures per changed screen** — `scripts/verify/screens.sh <dest> <slug> <url> [extra-query]`
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
# answering CDP so the recorder can screencast it. Use Chrome's own CDP port.
export CHROME_DEVTOOLS_AXI_CHROME_ARGS="--remote-debugging-port=$CDP_PORT"
node scripts/verify/record.mjs "http://127.0.0.1:$CDP_PORT" "$B/" "$EV/motion/office-switch.webm" > "$EV/motion/record.log" 2>&1 &
REC=$!
# Poll record.log for RECORDING: with a deadline and check that REC is alive.
# Drive the interaction with the current browser ref, then wait for its outcome.
kill -TERM "$REC"
wait "$REC"
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
  native proof in `phone-pairing.md` (`scripts/verify/phone-pair.mjs`: an emulator whose camera reads
  the live code, the computer confirms, the phone lands on "You're in") and says so instead of claiming
  these four captures. A change to Chief's bubble or its panel runs `bubble-write-it-here.md`.
  A change to phone-only mode (its screens or sign-out) runs `phone-only-signout.md`.
  A change to the first screen ("Where should I work?") or the cloud steps runs `where-cloud.md`.
  A change to Settings › Chief's computer runs `chief-computer.md`.
  A change to the phone-only chat's keeping, stopped/interrupted turns, offline queue or the approval
  sheet runs `phone-chat-keep.md` (`scripts/verify/phone-chat-keep.mjs`). A change to carrying that chat to
  Chief on a paired computer runs `phone-continue.md` (`scripts/verify/phone-continue.mjs`).
  A change to the helmet art or how it is sized (`web/src/art.ts`, `Ink`/`Face`) runs
  `term-screens.md` "The helmet keeps its own shape" on web and on the native app.
- **A third form factor.** 1440 (desktop) and 390 (phone) are the two widths the app is
  designed at; 320 stays the narrowest *probe* in the Drive section, reported as measured
  behaviour, not a fifth capture.

**PR body.** Name the evidence folder and the files (`screens/hello-night-1440.png`,
`motion/office-switch.webm`, …). Media is never committed; a public repo links the private
evidence page.

## Cleanup

Kill only what you started (crewd's process group as in Launch: TERM, KILL after the grace,
wait until it is empty; then the browser session: `chrome-devtools-axi` stop). Verify: the
port no longer answers, `kill -0 -- -$CREWD` finds no process group, `$LAB` removed. Both `$EV` and the Review evidence
folder survive — a cleanup that eats the proof fails. Never kill by process name.

## Helpers

- `scripts/verify/screens.sh <dest> <slug> <url> [query]` — the four design-bar captures of one
  changed screen (dark and light, 1440 and 390), after the mandatory personal-voice check.
- `node scripts/verify/look-check.mjs web|android|shot|native --out <dir> …` — the mandatory look check (above): 360 wide,
  largest text, light and dark; stretched, clipped, overlapping, off-screen and edge-strip hits with crops, each shot
  beside its approved mock (`scripts/verify/mocks.tsv`). `native --xml <uiautomator xml> <slug>=<png>` replays a saved Android
  capture through the same tree and pixel checks with no emulator. Exit 0 clean / 1 a hit / 2 could not run.
- `node scripts/verify/personal-voice.mjs [paths…] [--self-test]` — the mandatory personal-voice check
  (one person, one assistant) over the demo seed, the screens and the prompts: exit 0 clean /
  1 a hit to fix at the producer / 2 could not run. `--self-test` is its negative test.
- `SERIAL=<emulator> node scripts/verify/phone-ui.mjs texts | tap '<regex>' [n] | shot <png>` — the phone driven by what
  is on screen (uiautomator), for the bubble recipe.
- `node scripts/verify/record.mjs <cdp-url> <owned-page-prefix> <file.webm>` — one motion recording of
  a changed interaction: screencast frames timed by their own timestamps, muxed by ffmpeg.
- `node scripts/verify/phone-pair-timed.mjs --out <dir> --state <owned-state-dir> --serial … --base … [--cps 2]` — the
  typed-code pairing proof on a real phone as its app stands (`phone-pairing.md`, "The typed code").
- `node scripts/verify/phone-pair.mjs --out <dir> --state <owned-state-dir> [--serial …] [--base …] [--apk …] [--runs n]
  [--record]` — the native pairing proof (`phone-pairing.md`): the phone's camera
  reads the live code, the computer confirms, the phone reaches "You're in"; screenshots, an
  mp4 and `timings.json`.
- `node scripts/floor-guard.mjs` — the CONSTRAINTS.md floor on the current diff (exit 0
  clean / 1 violation / 2 could not run). Not app verification; run it before claiming done.
- `npm run check` (tsc, strict) and `npm test` (`scripts/test.mjs`, full isolated suite)
  are the repo's own gates; a verification run does not replace them.
- `docs/ui-contract.md` — what the web app may read from crewd; `web/src/adapter.ts` is the
  only reader. `test/ui.test.ts` keeps machinery words off screens.

## Selection and reporting

Read [the feature map](README.md) before driving. Select every feature affected by the
diff, not just one smoke screen. Run the named primitives in `.done-done.yaml`
(`done-done run <journey>`), or wrap a recipe that has none with `done-done run -- <command>`.
A journey with `spends:` is the exception: `done-done run` refuses it, so start it with
`done-done verify <journey> --outcome "<claim>"` and let the person approve or skip the spend
([feature map](README.md#done-done-primitives-and-selection)); never drop `spends:` or wrap its
driver to get around the ask. For a multi-step manual recipe,
put its drive commands in a task-owned script and pass that script to `done-done run`;
write proof under `$DONE_DONE_EVIDENCE_ROOT`, bound external commands with `timeout`,
bound HTTP requests with `--max-time`/AbortSignal, and trap owned-process cleanup.
Use each recipe's preconditions, success criteria and limitations unchanged. The smoke
journeys do not replace pairing, authorization, workbook rendering, installed PWA,
real-model or native evidence. A missing tool or device is NOT RUN with its concrete
reason; never substitute a screenshot of another surface.

On a clean candidate, check and receipt the same claim and explicit files:
`done-done check --outcome "<claim>" <evidence-files...>` then
`done-done receipt --outcome "<claim>" <evidence-files...>`.
Send asks, reports and evidence through sign-off-axi (the repository's sign-off skill);
retros use learn-from-mistakes. The retired local verification skill is not installed.
Maintain these project recipes and primitives together when the app changes.
