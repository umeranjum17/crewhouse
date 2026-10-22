# A skill, measured against its own baseline

**What it proves.** The paired skill eval (`scripts/skill-eval.mjs`): the same prompts run twice on the stub
engine — once with a bundled skill in the helper's folder, once without it — every run's document checked
against a fixed rubric, every raw run kept in a JSONL file, and the two arms diffed on one page. It measures
three things: whether the skill's own name and description match the prompt (the prompt set's `should_trigger`
column is the label), what the skill adds to the document the person gets, and what the skill costs the run in
prompt and tokens. A skill that does not beat the baseline is said so plainly: *"The skill does NOT beat the
baseline: 30 checks with it, 32 without it (-2). It does not ship in that form."*

**What it cannot prove.** The stub engine has no model: the run's actions are scripted from the skill's own
steps when the skill fires, and from a plain good answer when it does not. So the harness measures whether a
skill is actionable on this product and whether its description matches the prompts it is for - not a model's
judgement. A live-model arm (the same prompts on a real account) is the next slice.

**Drive and prove** (stub engine; no account, no network, no model - the pages a run reads are fixture pages
on loopback, served by the harness itself):

```bash
node scripts/skill-eval.mjs --out "$EV/skill-eval"            # the harness on its own
bash scripts/verify/skill-eval.sh "$EV/skill-eval"            # the journey: the run, then the capture
```

The prompt set is `scripts/skill-eval-prompts.csv` (id, prompt, should_trigger) and the pages each prompt's
"web" serves are `scripts/skill-eval-world.json`. It writes:

- `results.jsonl`: one line per run - the arm, the tools the run really called, the pages it fetched, the
  document's parts, the reply, the prompt it carried, its tokens, and every check's answer.
- `skill-eval.txt`: the printed diff - the trigger table with the reason each prompt did or did not fire, the
  checks both arms passed, and the verdict.
- `report.html` and `skill-eval-report.png`: the same diff as one page a person can read.
- `crew.log`: crewd's own log of the sixteen runs.

Read the capture: the trigger table names every prompt, whether it should fire and why it did or did not; the
checks table gives each arm's count; the verdict line says whether the skill beats the baseline and by how much.

The pinned test is `the bundled research skill beats the no-skill arm, and every run is kept` and `a skill with
no steps does not beat the baseline, and the harness says so` in `test/skill-eval.test.ts`.
