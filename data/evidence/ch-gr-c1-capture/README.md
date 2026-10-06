# Growth skills on the real model: what PR #318 claimed, and what Claude actually did

PR #318 ("Growth skills for Scout and Scribe, and the run validator (C1)") is green on the stub engine, but its
own evidence line says the proof never ran:

> `evidence: not proven: the real-model leg is rate limited on the shared ChatGPT account (openai is asking us to
> slow down), so no capture from the retained home yet`

This folder is that missing capture: one person asking Chief for growth help in his thread, on the **real engine
and the real model**, end to end. Nothing about C1 is changed here; two defects the run turned up are filed, not
fixed.

## Which model produced every word

The **Claude** account, on the fleet's dedicated test credential, symlinked into the engine's own HOME and never
copied. `claude auth status` in that HOME before the run: `loggedIn: true`, `authMethod: claude.ai`,
`subscriptionType: max` (`claude-auth-status.json`). The engine's own log names the route on all nine runs —
`provider=claude-cli model=claude-opus-5` (`engine-model-lines.txt`) — and crewd's record agrees:
`run.started {"account":"claude","name":"Claude"}` for Chief, Scout and Scribe. No other account was signed in,
so there is no second model anywhere in this capture.

Real engine (`crewd listening on … (engine: openclaw …)`), real server, real SQLite, throwaway `HOME`/XDG/state
under `/tmp`, person addressed as **Umer** (crewd's default `person.name` "Owner" is still what the avatar shows —
the app's Hello screen is the only place that changes it, and this run used `POST /api/onboard`). The whole
journey is the route the app itself calls: `POST /api/onboard`, then **one** plain message to
`POST /api/bots/chief/messages`. Chief recruited Scout and Scribe and assigned both himself; nothing was scripted
into any model's mouth.

### The tree this ran on

PR #318's head **5f6c328** exactly, plus PR #326's two-line `src/openclaw/runtime.ts` change applied to the
**running tree only** and reverted before commit (`git checkout -- src/openclaw/runtime.ts`; this branch carries
no source change). At capture time #326 was still open, and without it `PROVIDER_OF.claude` asks the kit for
`anthropic` while the kit reports `claude-cli`, so the mandated credential cannot drive the product at all —
`GET /api/accounts` showed `claude signedIn: false` until the overlay was in place, and `true` after. #326 merged
to `main` as **7df1ce8** while this capture was being written up, and its merged `src/openclaw/runtime.ts` diff is
byte for byte what was overlaid. Nothing else was overlaid.

## The ask, and what the crew did with it

> This is my project: https://github.com/umeranjum17/crewhouse - a crew of AI helpers you run on your own
> computer. Get me more stars.

| | what happened |
| --- | --- |
| Chief | `crew_roster`, `crew_recruit scout`, `crew_recruit scribe`, then `crew_assign` to both |
| Scout (task 2) | read `find-competitors`, ran GitHub's API and search, Hacker News Algolia, an awesome-list hit and listicles into `growth/crewhouse/{card.md,evidence.csv}` (26 evidence rows: 16 `gh-search`, 7 `hn-alt`, 2 `listicle`, 1 `awesome`), delivered `files/who-else-does-this-and-w.docx` |
| Scribe (task 3) | read `growth-plan`, fetched r/selfhosted's and r/LocalLLaMA's own rule pages, wrote `files/growth-plan.md` (275 words) and `files/crewhouse-launch-drafts.docx`, opened **two** `crew_draft` cards |
| Chief | `crew_routine`: a weekly watch on the engine's releases (a third open card, not a draft) |

103 tool calls on crewd's own record, all free: no `crew_spend`, no paid data tool.

## The run validator, on a real run for the first time

`node scripts/validate-growth.mjs 3` (and 2, and 1 — the root task and both halves), with
`CREWHOUSE_STATE_DIR`/`CREW_DIR` on the run's own dirs: **12 of 12 PASS, exit 0** (`validate-growth.txt`).

```
PASS    rivals document: scout: files/who-else-does-this-and-w.docx
PASS    plan under 300 words: files/growth-plan.md: 275 words
PASS    1-3 draft cards: 2 crew_draft call(s)
PASS    notes for Show HN notes: all five labels are there
PASS    no spend ask: no spend card
PASS    no paid tool: free sources only
PASS    cap: 3 new draft cards a day: 2 in the last 1 day(s)      … and the other four caps
PASS    ended: done
```

## What the method actually produced

**The rivals document** is real research, not a shape. GitHub's own API on the day: the repo has 2 stars, 0
forks, 12 open issues and is 12 days old, so "three of the best listings are age-gated and the first month's work
is preparation, not submission". Rivals are ranked with stars shown and never scored, and attention is attributed
only where a Hacker News story or a release matches — everything else is marked unattributed, "which means my
method could not see it, not that it did not happen". The answer it reaches is a channel the default playbook
does not have: the engine's own ecosystem (a ~160k-member Discord, a skills registry, a forum whose
build-showcase category has zero topics) ahead of one well-prepared Show HN.

**The plan** is 275 of its 300 words, with the §2 shape intact: who, the one-line pitch, three channels each with
its reason, a two-week calendar as a table, what to measure, and the first cards. It also refuses a channel on
the evidence — *"Not r/LocalLLaMA: Crewhouse runs no local model"* — and says X is not a fourth channel at this
following.

**The cards** keep the two-styles rule of §1 exactly. Show HN arrived as **notes, not a written-out post**, with
all five labels (`Thread:`, `They asked:`, `What you know that helps:`, `Say you made it:`, `Their rule:`) and the
venue's own rule quoted with its link; the X launch thread arrived as finished words. Two cards, inside the cap of
three. Both read "Nothing is sent · post it yourself" over Approve / Edit / Reject, and nothing was approved or
rejected in this run, so nothing left the computer.

## The two defects this turned up (filed, not fixed)

- **The plan was written blind.** Chief started Scout and Scribe at the same time and told Scribe to "lean on
  [the rivals document] if it has landed, otherwise proceed", while `skills/growth-plan` §0 says to *stop*
  without it. crewd's own events: plan delivered 05:10:02, rivals document 05:17:39 — the plan is 7m37s older
  than the document it is built on, and says so in its first lines. →
  https://github.com/umeranjum17/crewhouse/issues/329
- **The validator does not notice.** `validate-growth.mjs` PASSes "rivals document" on exactly that run, because
  it only asks whether one exists somewhere in the kin tasks, never whether the plan came after it. →
  https://github.com/umeranjum17/crewhouse/issues/330

Neither blocks #318: the skills and the validator do what the PR says they do. Both are about the order the work
is started in, which is Chief's prompt and the validator's reach.

## The media

Media is never committed; it is in the private evidence folder (`data/evidence/ch-gr-c1-capture/` in the
supervising firstmate home), beside `REPORT.md`, the HTTP transcripts, the delivered files, `validate-growth.txt`,
`engine-model-lines.txt`, `geometry-doc-panel.txt` and `pi-before.sha256` / `pi-after.sha256`. `pi-diff.txt` is
committed here: it names the command that compared the two `~/.pi` hash lists and carries its empty result.

| File | What it shows |
| --- | --- |
| `screens/rivals-document-{night,day}-{1440,390}.png` | Scout's "Who else does this" open in the app's own document panel, with the ranked rivals table |
| `screens/growth-plan-{night,day}-{1440,390}.png` | the 275-word plan: channels, the two-week calendar, what to measure |
| `screens/draft-card-show-hn-{night,day}-{1440,390}.png` | the Show HN card: five labelled notes, "Nothing is sent · post it yourself" |
| `screens/draft-card-x-launch-{night,day}-{1440,390}.png` | the X launch thread card, finished words |
| `screens/scribe-chat-two-cards-{night,day}-{1440,390}.png` | both cards and both delivered files in one chat |
| `screens/home-needs-you-{night,day}-{1440,390}.png` | Home: Chief's own summary of the run, "2 need you" |
| `motion/open-draft-card.webm` | scrolling Scribe's thread to the card and opening it (35 frames, 3.4 s) |
| `motion/open-rivals-document.webm` | opening the rivals document and reading down it (43 frames, 8.1 s) |

Captured through `.agents/skills/verify-crewhouse/scripts/screens.sh` and `scripts/record.mjs`. The
personal-voice gate ran at the top of every capture: self-test ok (failing case 1 hit, passing case 0), scan clean
over 32 files (`personal-voice.txt`).

## What this does not prove

- **One account.** Only Claude was signed in; this says nothing about ChatGPT, Grok, Copilot, OpenRouter or
  MiniMax, and nothing about how the growth skills read on another model.
- **One run.** One real growth request, not a sample: the shape held once, which is not a distribution.
- **The native Expo app.** `mobile/` has its own surfaces; these captures are the computer's half.
- **#318 merging cleanly.** Its head is seven commits behind `main` and conflicts in three files
  (`skills/growth-plan/SKILL.md` add/add, `templates/chief/AGENTS.md`, `templates/scribe/bot.json`) — `main`
  already carries a different `skills/growth-plan`. #318 needs a rebase before it can land; this capture is of
  5f6c328 as it stands today.
- **One layout detail, observed and not filed.** In the document panel at 1440 the rivals table is wider than its
  box (`scrollWidth` 616 against `clientWidth` 511) so the last column sits 57 px past the right edge; it is
  reachable by horizontal scroll (`overflow-x: auto`, max 105), so no words are lost (`geometry-doc-panel.txt`).
