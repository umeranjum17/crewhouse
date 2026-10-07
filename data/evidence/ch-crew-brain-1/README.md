# Crew brain slice 1: one shared "About me and my work" record — real-engine proof

Slice 1 of the crew brain, proved on the **real engine** (`engine: openclaw`) with the **real
model** (Claude, fleet test credential): the person sets one record, and a Scribe job and a
Reel job started afterwards both use its voice and audience in their first output.

## Which model produced every word

The **Claude** account, on the fleet's dedicated test credential, symlinked into the engine's
own config dir (`.../run/state/openclaw/home/.claude/.credentials.json`, the `CLAUDE_CONFIG_DIR`
the gateway drives) and **removed after the run** — verified absent afterwards, and the
engine's own files carry no tokens (scanned `backups/*`, `.claude.json` for
`refresh_token`/`access_token`/`sk-ant`: no hits). The whole journey ran under
`fm-cred-lock.sh` (one engine run at a time on the shared credential). Person named **Umer**.

Ran this worktree's crewd (`fm/ch-crew-brain-1`) on the shared retained test home's
state/crew/tools (one lane at a time; it was idle, port 7751 closed). The retained home's
ChatGPT auth is expired (tasks failing there since Oct 5; every account read `signedIn:false`
at boot), so the Claude credential carried this run. Gateway `authStatus` picked the
symlinked credential up live — no restart, no sign-in flow, no device code.

## The record (set through crewd's API, read back byte-identical)

`PUT /api/profile` then `GET /api/profile` → `record.json`:

> I am a solo ops consultant. I write short, plain sentences for busy agency founders. I sell
> a weekly ops review that finds the one bottleneck. Past work: inbox-zero crews for two
> design studios.

## The journey (every step the route the app itself calls)

| # | Call | Result |
|---|---|---|
| 1 | `PUT /api/profile` (record above) | `{"ok":true}` |
| 2 | `GET /api/profile` | `record.json`, `cap: 4000` |
| 3 | recruit check | scribe present; `POST /api/recruit {reel}` → `{"id":"reel",...}` |
| 4 | `POST /api/bots/scribe/messages` "Write a post announcing my weekly ops review. One variant, plain words." | task 155 → `done` |
| 5 | `POST /api/bots/reel/messages` "Write a 30-second demo script for my weekly ops review. Plain words, no jargon." | task 157 → `done` |
| 6 | `PUT /api/profile {"text":""}` | `{"ok":true}`, verified `{"text":"","cap":4000}` — other lanes' prompts unaffected |

## Scribe's first output uses the record: holds (`scribe-first.txt`, full thread `scribe-thread.json`)

> Drafted it for LinkedIn — that's where **busy agency founders** actually read…
>
> I built **inbox-zero crews for two design studios**. … So that is what I am selling now:
> **a weekly ops review**. … find **the one thing** holding it up. … It is for **founders**…

Voice (short plain sentences), audience (agency founders), what I sell (weekly ops review),
past work (two design studios) — all four corners of the record, unbriefed.

## Reel's first output uses the record: holds (`reel-first.txt`, script `reel-script.txt`, thread `reel-thread.json`)

First reply plus the delivered `files/weekly-ops-review-30-sec.docx` (78 spoken words, five
beats). The voiceover opens "Your shop is busy. The work is still slipping… one thing is
holding everything else up… For one week I watch how work actually moves through your shop…
You get one page. The bottleneck, what it's costing you, and the one fix… One week. One
bottleneck." The notes say it outright: "that's the line **founders** recognise… Say
**'shop' or 'studio'**, not 'operations' or 'workflow'."

## Footprint on the shared retained home (documented, nothing hidden)

- `run/crew`: `people/1/profile.md` (set, then cleared via the same API), `bots/reel/` (recruited), tasks 154–157 + their chats, crew git commits for each. No soul/job edits.
- Task 154: my first scribe post from an earlier round with no usable account (`paused`, superseded by 155 — left paused, never stolen or deleted).
- Task 156: my own misfire (`POST …/reel/messages {"text":"x"}` from a broken local capture helper; ran to `done`, no files). Proof the queue is honest: it ran before 157.
- Oct-6 tasks 152/153 (another lane's, `paused`): never touched — no selective wake exists, so none was used.
- Credential symlink and profile: removed/cleared; retained home idle afterwards.

## How to replay

`bash data/evidence/ch-crew-brain-1/run.sh retained` under `fm-cred-lock.sh`
(see `run.sh` header). `run.out` + `transcript.log` are this run's logs; `crewd.log` is the
daemon log. No screen changes in this slice, so no screen capture.
