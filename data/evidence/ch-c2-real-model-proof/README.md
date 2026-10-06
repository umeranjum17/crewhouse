# Draft cards on the real model: what PR #273 claimed, and what Claude actually does

PR #273 ("Draft cards show the exact words, and no longer collapse", merged 2026-10-04) was proved on the
**stub engine**. Its own evidence line said so — *"not verified on the real app: the real-model capture did
not complete."* This folder is the same surface driven on the **real model**, as evidence. Nothing about the
draft card is changed here; a defect the run turned up is filed, not fixed.

## Which model produced every word

The **Claude** account, on the fleet's dedicated test credential, symlinked into the engine's own HOME and
never copied. `claude auth status` in that HOME before the run: `loggedIn: true`, `authMethod: claude.ai`,
`subscriptionType: max`. The engine's own log names the route on every one of the five runs —
`provider=claude-cli model=claude-opus-5` — and crewd's record agrees (`run.started {"account":"claude"}`).

Real engine (`engine: openclaw`), real server, real SQLite, throwaway `HOME`/XDG/state under `/tmp`, person
named **Umer**, one helper (Scribe). Every step is the route the app itself calls: `POST /api/onboard`,
`POST /api/recruit`, then five plain person messages to `POST /api/bots/scribe/messages`. Scribe wrote the
files and called `crew_draft` itself; nothing was scripted into the model's mouth.

## The journey

| # | What the person asked | What Claude did |
|---|---|---|
| 1 | an email to the host's support, blank lines, name `deploy.sh`, mention ChatGPT (GPT-5) | wrote the file, `crew_draft` → card 1 |
| 2 | a second, blunter email to the **same address**, different words | wrote a second file, `crew_draft` → card 2 |
| 3 | "put the first email in front of me again, change nothing" | re-delivered the file; never called `crew_draft` |
| 4 | "put it up for my approval again, same words" | `crew_draft` on the same file, same hash → **no new card** |
| 5 | a long handover email, 4000+ characters, "do not shorten it" | wrote 5,455 bytes, `crew_draft` → card 3 |

## "The card shows the exact words": holds

For all three real drafts the helper's own file, crewd's API body and the text the screen renders are
**byte-identical** — compared against the real adapter (`web/src/adapter.ts` → `needsYou()` → `draftText`),
not against a screenshot:

| card | subject | file (trimmed) | `detail.preview.body` | screen `draftText` |
|---|---|---|---|---|
| 1 | Deploy failed last night | 567 B | 567 B | 567 B |
| 2 | Restore last night's build | 271 B | 271 B | 271 B |
| 3 | Full deploy history and what we have tried | 5,455 B | 5,455 B | 5,455 B |

One sha256 per card covers all three sides (card 1: `9ba57eb5…a49aacf5`), and it equals the `draft.sha`
`crew_draft` recorded. Shape survives with it: card 1 keeps its 4 blank lines, its 4 backticks
(`` `deploy.sh` ``) and the literal "ChatGPT (GPT-5)"; card 3 keeps 11 blank lines and 24 backticks.

## "No longer collapse": holds

Three open draft cards under **one title** (`Scribe wrote your email.`) and **one recipient**
(`support@myhost.example`) — the exact case that collapsed before #273:

```
openDraftAsks: 3   distinctTitles: 1   distinctRecipients: 1   distinctShas: 3
needsYouCards: 3   needsYouDraftCards: 3
```

Home reads "3 need you" and "NEEDS YOU · 3" over three separate rows; Scribe's chat carries three separate
cards. The repeat with identical words (step 4) correctly added **no** fourth card, so the hash key still
suppresses a true duplicate.

## "Does not truncate": holds, with a limit worth saying

Live DOM at both themes and both widths: `-webkit-line-clamp: none`, `text-overflow: clip`,
`white-space: pre-wrap`, and the element holds the whole string (565 / 271 / 5,455 characters). No word is
dropped. The limit: `.draft-body` is `max-height: 240px; overflow: auto`, so the long draft is **scrollable,
not all visible at once** — 240 px of a 2,633 px body at 1440. Every word is present and reachable; the
recording scrolls through it. Home's one pinned needs-row shows only the body's first lines by design
(`main.tsx`); the card itself is behind Approve.

## What the real model did not support

Nothing contradicts #273. One shape its test builds was **not reproduced**: `test/drafts.test.ts` drives three
`crew_draft` calls, two with identical text. Asked to re-offer the same words, the real model called
`crew_draft` once more and skipped it entirely the other time — "three calls, two cards" is a stub-engine
construction. The behaviour under it (identical words → one card) did hold on the single real repeat.

## The defect this turned up (filed, not fixed)

Same words to a **different recipient** still collapse: `Crew.propose` keys on `(title, draft.sha)` and ignores
`draft.to`, so Scribe's repeat with `to: "Hosting support"` opened no card while the tool answered "The person
sees your suggestion on a card." — https://github.com/umeranjum17/crewhouse/issues/327.

## The media

Media is never committed; it is in the private evidence folder
(`data/evidence/ch-c2-real-model-proof/` in the supervising firstmate home), beside `REPORT.md`,
the HTTP transcripts, the three draft files, `check-draft.mjs`, `geometry-draft-body.txt` and the
`~/.pi` hash lists.

| File | What it shows |
|---|---|
| `screens/draft-panel-long-{night,day}-{1440,390}.png` | the 5,455-byte draft on its card: every word, scrollable |
| `screens/draft-panel-backticks-{night,day}-{1440,390}.png` | card 1 with its backticks and "ChatGPT (GPT-5)" intact |
| `screens/scribe-chat-three-drafts-{night,day}-{1440,390}.png` | three separate cards in one chat, one shared title |
| `screens/home-needs-you-three-{night,day}-{1440,390}.png` | Home: "NEEDS YOU · 3", three rows, not one |
| `motion/open-draft-card.webm` | opening the card and scrolling the whole long draft (25 frames, 4.3 s) |

Captured through `.agents/skills/verify-crewhouse/scripts/screens.sh` and `scripts/record.mjs`. The
personal-voice gate ran at the top of every capture: self-test ok (failing case 1 hit, passing case 0), scan
clean over 32 files.

## What this does not prove

- **One account.** Only Claude was signed in; this says nothing about ChatGPT, Grok, Copilot, OpenRouter or MiniMax.
- **The native Expo app.** `mobile/` has its own draft surface and its own proof; these four captures are the
  computer's half.
- **A distribution.** One model turn per case: three real drafts, not a sample.
- **This branch's HEAD alone.** On `12f938a` the Claude account is unusable (`PROVIDER_OF.claude` asks for
  `anthropic`; the kit reports `claude-cli`), so PR #326's two-line `src/openclaw/runtime.ts` change was applied
  to the **running tree only** and reverted before commit. It touches nothing #273 changed. Without it the
  mandated credential cannot drive the product at all.
