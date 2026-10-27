# Jobs eval

Is the jobs helper better than the same model asked plainly? This runs it on a real model against a written rubric, beside two plain-model baselines, and keeps a ledger so runs compare over time. It is not part of `npm test` or CI and nothing in the app calls it: it spends a real account's model calls, so a person runs it.

```
JOBS_EVAL_CLAUDE_HOME=<a HOME holding a signed-in Claude login> \
  flock <lockfile> scripts/jobs-eval.sh --out <dir> [--runs 3] [--model <id>] [--cases goal,shortlist,prep] [--wait 900] [--ledger <file> | --no-ledger]
scripts/jobs-eval.sh --engine stub --out <dir> --no-ledger     # scripted answers, no model: proves the harness, never a result
```

Use a dedicated test login, never your own: the engine and the baseline each use it in turn, and a login has one writer at a time (hence the `flock`). Run Node 24.16+ by path (`NODE=/usr/bin/node`) where a version manager's shim does not survive the throwaway HOME. Exit 0 leaves `report.md` (read this), `results.json`, `helper-<n>.json` and `baseline-<n>.json` (every output and score) in `<dir>`, and appends one line to the ledger, `scripts/jobs-eval/ledger.jsonl` by default.

## What runs

Each run is a fresh throwaway crewd (own HOME, state and ports). It is seeded on the stub engine with the product's own API (the goal accepted, one company's role moved to Interview), restarted on the real engine, and the three cases then go through the product:

| case | the person does | what is scored |
|---|---|---|
| `goal` | tells Chief what they want and pastes a nine-line CV | Chief's goal card (`crew_goal`); it is denied, nothing starts |
| `shortlist` | nothing: Rae gets her real find task (`jobs.findTask`) pointed at a fixed roles page | the roles Rae put on the board with `crew_role`, from eight fixed postings: four fit, three do not (below the pay floor, the wrong job, the wrong country), one is a repeat |
| `prep` | taps Prep for this interview on the seeded role | Will's `crew_prep` result: the company brief and the likely questions, from three fixed pages |

The fixed web is `scripts/jobs-eval/cases.json`, served on loopback; the CV is the same nine lines throughout.

## The rubric

Every check is a number from 0 to 1 that a script reproduces (`scripts/jobs-eval/rubric.mjs`); a case is the mean of its checks and the run the mean of its cases. Change a check, a case or a prompt and the ledger line says so (rubric and cases versions, prompt hash).

- `goal`: offers the goal in the first reply; names the right job; keeps both places; keeps the pay floor; keeps every line of the CV; adds no line the person did not write.
- `shortlist`: finds the roles that fit; leaves out the ones that do not; lists each role once; names only pages it was given; gives the pay as the page shows it (the whole range, word for word, empty when the page shows none); quotes the person's own CV lines; says what the CV does not show (a planted gap per posting).
- `prep`: every company fact is on the page it names; five to ten facts; six to ten questions, each with why; writes no answer for the person (no figure for a pay question, no "you should say"); the questions cover the role (checkout speed, the GraphQL move, on-call, React and TypeScript).

## The baselines

The same model, through the Claude CLI with no tools, no settings and a one-line system prompt, given the same CV and the same page text pasted in, and asked for the same JSON shape the helper's tools take. No tool calls, no crewd checks.

- `plain`: names the job and the shape of the answer, nothing else.
- `plain + the same rules`: adds the helper's own rules as sentences (copy the pay word for word, quote CV lines exactly, never claim what the CV does not show, leave pay and visa questions to the person). The gap between `plain` and this one is the prompt; the gap between this one and the helper is crewd's tools and checks.

The baselines are given more than the helper in one way (the pages are handed over, not fetched) and less in another (nothing refuses a bad answer and lets the model try again). The report says where each arm won.

## What each run records

The ledger line and `results.json` carry the commit (and whether the files under test were uncommitted), the engine and the account and model id the helper ran on, the model the baseline ran on, the Claude CLI version, a hash of every prompt that matters (the three templates' soul, job and settings, the task texts the cases send, both baseline prompts, the cases) and the rubric and cases versions. Two lines with the same prompt hash and model differ only by the model's variance; run `--runs 3` or more before reading a small gap.

## What it does not measure

- Whether a person likes the result: relevance is keyword coverage of planted topics, not judgement. An LLM judge for the prep's quality is the next slice, with its own model and a human spot-check.
- The application draft, the form fill and the practice interviewer: three cases only.
- One CV and one set of postings, in English: it can show where the helper loses, not that it generalises.
- The live web: the fixed pages are the point (a rerun is comparable), so how the helper searches is not tested.
- Cost and speed are recorded per case (seconds, tool calls, calls crewd refused, tokens when the engine reports them), not scored.

## First real result: not yet run

The harness is proven on the stub engine only (`scripts/jobs-eval.sh --engine stub`: the scripted helper scores 100%, the scripted baseline 45%, which shows the scorer tells them apart and nothing else). There is no real-model number yet, and none is claimed here. Two attempts at the real run on 27 Oct 2026 stopped before any case ran, with the same error both times:

```
Error: gave up after 120 s waiting for Claude to read as signed in; crewd's last view of that account:
{"account":"claude","provider":"claude","name":"Claude","signedIn":false,"restingUntil":0,"signIn":null,"notIncluded":false,"signedOut":false}
```

The engine had reached `crewd engine ready` and the dedicated test login was linked into its home, while `claude auth status --text` on that login's own HOME reported it signed in. The run needs a signed-in engine, which is the account owner's to give: run the command above with `JOBS_EVAL_CLAUDE_HOME` set once the engine sees the login (the runbook's "Real model words" section has the steps), then add the result and its ledger line here.
