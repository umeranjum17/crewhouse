# Onboard and chat with Chief

First contact: after computer setup the app opens Chief's own thread; he asks the name there, the
answer is saved as the address, and he pitches with ideas to try (no Hello screen). Run `scripts/verify/onboard-chat.sh <out>` (journey `onboard-chat`, stub engine) for the 390/1280, day/night captures. A plain message is a Chief turn; his stop-and-ask rules lead his
first message.

## Sub-features

- `first-run-chat` — first run opens Chief's chat (no Hello screen): his greeting asks "What shall I call you?"; a short first line sent there is saved as the address and Chief's pitch follows with three ideas to try and "How does this work?" (tap an idea to send it as the first job).
- `onboard` — the person's chosen address lands in `/api/state` (`person.address`).
- `chief-greeting` — Chief's thread opens with his greeting (`I am Chief, of the Crewhouse…`).
- `chief-chat` — a message becomes a task that settles with a reply.
- `trust-links` — Settings (under its title) says "What the crew remembers (see or forget any line)" and "Runs on this computer, nothing sent to us"; Hello (under the ideas) says one plain line, "Runs on this computer. See or forget anything the crew remembers." (`A.trust`). On Hello it opens How it works, whose promises include where memory lives (`A.keptWhere`); Settings leads the runs-at-home line with the second and links the first to the one Memory section (`#memory`).
- `memory-one-section` — Settings shows one "Memory" section (label `#memory`) with one description, listing both what Chief noted about the person and their work (`profileParts`, `.profile-part`, Change/Forget) and the whole crew's own lines (`memories`, `.memory-you`, Forget) in one card (`.memory-lines`), with one Add row (`.profile-add`).
- `memory-saved-line` — when the crew keeps a memory (a helper's `crew_remember`, or Chief's `crew_profile`), that chat shows one `Saved: <the line>` note with an Undo (`.saved-undo`); Undo removes it (crewd's `POST /api/bots/:id/memory/:seq/undo`, or dropping the sentence from the record) and the line does not come back.
- `shared-profile` — Chief saves directly stated personal/work facts from onboarding and chat with `crew_profile`; the complete merged record stays under 4000 characters and his reply says plainly what he noted.

## How to get to it (user POV)

- Open the app with no person onboarded yet; Chief's chat is the first thing shown. Type a name; tap one of the ideas (or write your own ask).

## Driving it with the API and browser

Preconditions: fresh lab (no onboarded person); `$B` and `$H` as in runbook.md.

- **State before.** `curl -fsS "${H[@]}" "$B/api/state"` → `person.address` is null, `person.name` "Owner".
- **Onboard.** `curl -fsS -X POST "${H[@]}" -d '{"address":"Sir"}' "$B/api/onboard"` → `/api/state` now shows `"address":"Sir"`.
- **Chief's page.** `curl -fsS "${H[@]}" "$B/api/bots/chief"` → first `author:"bot"` message matches `I am Chief, of the Crewhouse` and asks "What shall I call you?".
- **Chat.** `curl -fsS -X POST "${H[@]}" -d '{"text":"I need a demo video"}' "$B/api/bots/chief/messages"`; poll the same page until the reply `stub chief: done with "The person says: I need a demo video"` appears and the task row reaches `done`.
- **UI.** Run `scripts/verify/onboard-chat.sh <out>` (journey `onboard-chat`, stub engine): captures `ask-name`, `pitch`, `how` at 390 and 1280, day and night, then taps an idea. The pre-change Hello screen is captured by running it with `REPO_DIR=<older checkout>`.

## Trust links

Stub engine is enough (no model words). Fresh lab, browser bootstrapped per [Drive](runbook.md#drive).

- **Settings.** Onboard and seed `PUT /api/about` / `PUT /api/profile`, open `#/settings`, click `.link.trust`; eval `#memory` top ≈ 16 px (plus the safe-area inset in an installed app) and the seeded rows with Forget (`.profile-part` and `.memory-you`).
- **Memory (one section, saved line).** Settings shows the one `#memory` section with both stores' lines. In a chat, keep a memory — a helper's `crew_remember` lands `memory.learned`; Chief's `crew_profile` lands `profile.edited {added}` — and eval the chat has one `.saved-undo` row reading `Saved: <the line>`; click it and eval the line is gone from the chat and from the record.
- **Evidence.** `scripts/verify/screens.sh` for the first-run chat (fresh) and `#/settings` (seeded), `scripts/verify/record.mjs` around each tap; on the iPad installed app (route in `pwa-resume.md`) tap the same links and check nothing lands under the status bar.

## Shared profile (real-model words)

Use runbook.md's isolated real-engine launch and credential lock for the whole lifetime.
Select the signed-in Claude account for the crew by picking one of its models: `PUT /api/accounts/1/claude/model` with an id from `GET /api/accounts/1/claude/model`.
Onboard with `{address:"Umer", ask:"I run a bakery for local families. My business is called Morning Loaf. I am introducing myself, not asking for a helper or a job yet."}`.
Await the settled Chief task; retain `GET /api/profile` and `GET /api/bots/chief`.
The record must contain the bakery and audience, and Chief must plainly say what he noted.
Then send `My writing tone is warm and plain. I prefer short sentences.` in Chief's
composer, recording that send and reply. Read the record again: the business/audience
must remain and the tone must be added. No tool syntax belongs in these real-model requests.
Capture Chief's note before/after at 390×844 and 1440×900, `?day` and `?night`, and open
every shot. These web widths do not prove native Expo UI. `test/crew-profile.test.ts`
pins the HTTP onboarding/chat dispatch and over-cap preservation on the scripted runtime;
it does not prove model judgment or plain model words.

The helpers in runbook.md exist at this revision: `scripts/verify/screens.sh` for the four design-bar
captures and `scripts/verify/record.mjs` for one motion recording of an interaction (a CDP
`Page.startScreencast` muxed with ffmpeg), plus `scripts/verify/personal-voice.mjs` and its
`--self-test`. Drive with the fleet-required `chrome-devtools-axi` in its own task-scoped
session (`emulate --viewport`, `open <base>/?day` / `open <base>/?night`, `eval` for visible
text/geometry, `screenshot <EV>/<name>.png`), or any CDP harness that opens the app tab with
the private `#person=` capability. Do not substitute demo copy or injected messages for the
actual Chief reply. Stop every owned daemon/engine by its recorded port before releasing the
credential lock. Inspect the actual note's plain, single-person wording in the retained
replies and all four captures.

## Published template catalogue (real-model words)

With the real-engine launch in runbook.md, first prove browsing in two Chief turns:

1. Ask: "List the published Grok template categories and Claude skills. I want to find
   prospects and draft personal first messages. Propose one fitting template with one reason,
   but don't import yet." Record the request and settled reply from `/api/bots/chief`.
   Read `run.call` events: `crew_import {list:true}` must have fetched the real catalogue.
   No imported helper should exist yet. Each category has its count and only 2–3 examples
   (or all when fewer exist), using plain titles, never handles. Claude skills are one
   counted category with examples, not a second wall of names. Chief gives his pick
   and reason (the shared answer-first rule may put it first). Compare to the tool result,
   not a fixed list. Name a failed source plainly.
2. Ask for the full list of one category named in the first reply. `run.call` must show
   `crew_import {list:true,category:"<that category>"}`; its result contains all that
   category's titles and no other category's names. Chief must show titles, not handles.
   Wait for `/api/accounts` to report the real account ready; no sign-in card should remain.
   Capture both replies at 390/1440, day/night and record sending the follow-up.

Use `chrome-devtools-axi` in a task-named session: `emulate --viewport "390x844x3,mobile,touch"`
(or `"1440x900x1"`), `open <base>/?day#/chief` / `?night#/chief`, wait for the actual reply, then
`screenshot <EV>/<reply>-<theme>-<width>.png`. Resize after navigation and verify
`innerWidth`/`innerHeight`: mobile emulation can reset on navigation. Scroll `.lines`
when it owns the scroll; otherwise use `document.scrollingElement`. After the thread-layout
fix, `.lines` owns the phone scroll too. Preserve overlapping frames when a reply does not fit. Record with Chrome's
CDP `Page.startScreencast` and ffmpeg through `scripts/verify/record.mjs`, plus
`scripts/verify/screens.sh`. Keep API replies, tool-call events, capture geometry and decoded
motion-frame count alongside the images.

For the separate import journey, send only "yes" after the proposal, capture its settled
state at all four settings, and record the selected slug/skill, `/api/state` helper,
`SOURCE.md` and skill-file presence. It must import the proposed template without a
second confirmation or assigned work. This is separate from category browsing proof.
Open every saved screenshot; a 390-wide web capture is not a native Expo-device proof.
The stub-source regression in `test/import-grok.test.ts` exercises the same dispatch,
proposal hold and one-yes import without a model or network; it is not real-model proof.

## Gotchas

- Onboarding is one-shot per state dir: a second `POST /api/onboard` is not the fresh journey — make a new lab instead.
- The reply text quotes your message with the `The person says: ` prefix the prompt template adds; match on the suffix, not the whole string.
- Poll for the reply; on a loaded machine the turn takes seconds. Never assert after a fixed sleep.
