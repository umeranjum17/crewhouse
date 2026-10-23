# Chief inbox triage

While Gmail is connected, one quiet Chief routine checks every two hours through the existing Gmail connector. It uses the same paginated Gmail history reader as email-triggered routines, not a newest-25-thread snapshot. The first run, a legacy timestamp cursor, or expired Gmail history establishes a fresh baseline without alerting on old mail. Mail arriving in that baseline window is not recovered; do not claim exhaustive historical triage.

A changed batch starts one task. Its history cursor commits with that task; failed reads keep the cursor, report their cause once and retry on the next check. Overlapping tasks are skipped. Gmail message IDs resolve to thread IDs before case lookup and links. Multiple new messages on one thread become one contender.

Chief is instructed to read contenders, rank impact/urgency/personal relevance, choose the most important actionable change, distinguish facts from uncertainty, cite mail and read first-party sources, preserve vendor step order, and ask at most one focused question. Exact versions may only come from read sources. The profile and five recent cases (with links, even across senders) supply context, not proof of a relationship. Same-thread/sender held facts remain available; cases expire after 30 days. ALL-CLEAR posts no chat reply. These are model instructions, not a claim that scripted text proves judgement.

The automatic task gate permits only mail inbox/search/read, web reads/search and crew_case; it refuses writes, connection/sign-in requests, and delegation. Manual draft/label workflows retain their existing approvals. HTML mail reads preserve HTTP(S) href targets and include the Gmail thread source.

## Recorded-fixture proof

Build first: `npm run build:web`. On a clean committed candidate run:

```sh
~/firstmate/config/fm-mem-gate.sh done-done run inbox-triage
```

This uses the DEFAULT done-done evidence root, creates a private HOME/XDG/state and local synthetic Gmail provider, starts real crewd HTTP/chat on an OS-assigned port, then closes only its own browser/server/crew and removes its private scratch. No real login, model or Google request occurs. Fixture advisory URLs and version strings are synthetic, not current verified vendor advice.

Inspect `api-proof.json`, `browser-proof.txt`, `steps.json`, all four `chief-<390|1440>-<day|night>.png` captures, `routines-390-<day|night>.png`, `chief-390-day-answering.png`, `chief-390-day-answered.png` and the installed app's `pwa-chief-390-<day|night>.png` and `pwa-chief-1280-day.png` (the journey runs with `PWA=1` under `xvfb-run`; `pwa-run.json` records its standalone check). Confirm one linked scripted alert, a quiet repeat, cross-sender context delivery, an actual mail read with preserved source targets, and zero Gmail mutations. Open every shot; no raw Markdown, bare URL or horizontal overflow.

In Chief's thread a Mail watch reply is a card (`inboxOf` in `web/src/adapter.ts`, `InboxAlert` in `web/src/parts.tsx`): "From your inbox", Chief's first sentence as its lead, links in the words as plain underlined text, every source as a 44px row naming its site (Gmail for a mail link; a bare address reads as its site, and a sentence that is only a link moves to its row), and a closing question apart under "Chief asks". Answer shows only while that question is the newest line: it puts the person in the box under an "Answering Chief" strip, and the sent answer quotes the question (`> question`), because Chief's earlier lines reach him only in short. crewd's "Mail watch couldn't check Gmail: <cause>" reads as a card keeping that cause. Mail watch's runs on Routines read "No new mail", "New mail, nothing that needs you", "Couldn't reach Gmail" and "Started watching your inbox"; a quiet ALL-CLEAR still posts nothing in the thread. The journey asserts each of these in the browser (source rows, lead, question, failure card, run words, the focused box, the quoted answer in Chief's prompt). This proves the bounded plumbing outcome, not the quality of the scripted ranking or vendor research. No model judge is run under this task's no-real-model restriction; an unjudged done-done capture is not a passing judge receipt.

Extend existing integration journeys rather than adding isolated logic tests:

```sh
# One file per invocation, through the memory gate, each bounded to 240 seconds.
node scripts/test.mjs test/mail-watch.test.ts
node scripts/test.mjs test/notice-followup.test.ts
node scripts/test.mjs test/event-routines.test.ts
node scripts/test.mjs test/mail.test.ts
node scripts/test.mjs test/line-budget.test.ts
```

The watch journey covers a burst over 25 threads across pages, read failure/retry, malicious write/recruit instructions, no approval or send, silence on unchanged history, and restart deduplication. The notice journey covers same-thread/sender memory, unrelated noise, cross-sender Railway context, scripted Stripe alert delivery through HTTP, source preservation and Forget. The scripted words do not establish real-model performance.

## Full acceptance still required

Use only an authorized, isolated, already-connected route to the owner's personal Gmail and a working approved model plan. Never borrow the owner's installed Crewhouse state or copy credentials. If any real sign-in/password/phone-code step appears, stop and report blocked. No sends, replies, drafts, filing, archives or deletes. Trigger via `POST /api/routines/<id>/run`, the app's own button route; do not alter production rows.

Inspect the real inbox selection, factual support, exact first-party versions and step order, context separation and one-question message. Capture it on the actual phone and installed PWA, with recording and source/head provenance. Stub browser captures do not replace this. MiniMax's reported 402 and lack of an authorized connected lab prevent this leg under the current brief.
