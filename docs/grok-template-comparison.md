# Crewhouse templates against a published Grok-bot setup

One page. The Grok-bot side is `florianthompson/grok-bot-setup` (a GitHub template: a home bot's `CHARTER.md`, a dev bot's
`CHARTER.md`, a `work/` board, per-ticket `HANDOFF.md`) and `0xNyk/awesome-grok-bot` (maturity tags and a trust-boundary
section), as read in `ch-research-helper`'s report, section 7. We take their documents, not their product.

## Where the pieces meet

| Grok-bot setup | Crewhouse |
|---|---|
| `agents/home/CHARTER.md`, the desk that routes | Chief: `templates/chief/soul.md` + `AGENTS.md` |
| `agents/dev/CHARTER.md`, one specialist | a helper template: `soul.md` (who) + `AGENTS.md` (job), e.g. `templates/cto/` |
| `work/STATUS.md`, a one-line board | Today's rows and Hand me a job in the app |
| `work/<ticket>/HANDOFF.md` | a task row, its session key (`tasks.session`) and the helper's own folder |
| `projects/<app>/CONTEXT.md` | `people/1/about.md` and `notes/<bot>.md` |
| `[TASK] <name>` bots | one session per task, hand-offs through Chief |
| maturity tags | `maturity` on each starter skill, shown in Settings |
| "check the trust boundary" | the five-question `trust` record on each starter skill |

## Where we are better

1. **The human gate.** A helper never asks or acts in the world on its own word: sends, spending, presses on signed-in sites
   and drafts in the person's name each stop on a card (`src/policy.ts`), and only Chief speaks to the person. A charter
   file can say "ask first"; ours is enforced at the tool call.
2. **Tool policy and the sandbox.** Unknown tools fail closed, the shell runs in bubblewrap, and a template's `net` list is
   the only network a helper has. A Grok-bot charter lists tools in prose.
3. **Memory the person owns.** What the crew knows lives in capped, committed files with Undo and Forget; a soul or job
   changes only through a card the person accepts. A fat chat or a private "brain" repo has none of that.

## Where we are worse

1. **One-screen hand-offs.** Their `HANDOFF.md` is fixed to goal, done-when, what happened, next step, do-nots. Chief's task
   brief had "done means" but no place for what already happened, the next step or the do-nots. Chief's job file now asks
   for one screen with those parts (`templates/chief/AGENTS.md`, Handing on).
2. **Skill trust documentation.** We recorded who reviewed a starter skill and its hash, not who can trigger it, what it
   receives, where it runs, what it can read, or how to stop it. Each starter skill now answers those five in
   `src/openclaw/starter-skills.json`, and `test/starter-skills.test.ts` fails if one is missing.
3. **Maturity at a glance.** Their directory marks every entry production, beta or experimental; ours showed a reviewed
   skill and nothing about how settled it is. Settings now shows the tag on each starter skill.

## Left alone on purpose

- Cursor connectors, xAI wiring and the one-file YAML bot format (GBDL): product machinery, and a scanner has already
  flagged the format.
- A "department" pack of helpers (the GTM-team shape): a product decision, not part of this change.
- A third-party install path for skills (`npx skills`): our reviewed, pinned path stays the only way in.

## The starter-skill review

A starter skill is added to `src/openclaw/starter-skills.json` only with all of these, and its `SKILL.md` pin in
`src/openclaw/trusted-skills.json`:

- `maturity`: `production` (read-only or well-proven, widely used), `beta` (needs the person's setup before it does
  anything), `experimental` (small publisher or it can touch the person's home or accounts).
- `trust`, one plain sentence each: `triggeredBy` (who can start it), `tools` (what it receives), `runsAt` (where its
  commands run), `credentials` (what it can read), `stop` (how the person stops it).
