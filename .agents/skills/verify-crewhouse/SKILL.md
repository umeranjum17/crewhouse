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
happens (scroll, wrap, overflow) rather than assuming support. For the longest-title probe,
use the longest visible strings (the standing jobs' idea asks, a helper's display name) and
prove placement with `eval` + `getBoundingClientRect`, not by looking at a screenshot.
`?demo` variants (`?demo=crew1|crew5|crew12|crew30|calm|office`, `web/src/demo.ts`) run
every screen with no crewd — fine for pure-UI layout checks, never a substitute for a real
drive.

## Evidence

Write to `$EV` (outside the repo): the curl transcripts and their HTTP bodies, browser
screenshots, geometry eval results, `crewd.log`. Proof standards: exercise the real user
path (the API the app itself calls — never test-only endpoints or direct SQLite writes as
the *action*); capture the action and the resulting state (the reply message and the task
row, not just a final screen); verify side effects where the feature has them (files under
`$LAB/crew/bots/<bot>/files/`, rows in `crew.db`); label anything the stub cannot prove
(no real model words, no real sign-in) as a stub-engine result.

## Cleanup

Kill only what you started (`kill -TERM $(cat "$LAB/crewd.spawn.pid")`, wait, then the
browser session: `chrome-devtools-axi` stop). Verify: the port no longer answers, no crewd
process owns `$LAB/state/crewd.pid`, `$LAB` removed. `$EV` survives — a cleanup that eats
the proof fails. Never kill by process name.

## Helpers

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
