# Onboard and chat with Chief

First contact: the Hello screen takes the person's name, onboarding records it, and Chief
greets in his own thread. A plain message is a Chief turn; his stop-and-ask rules lead his
first message.

## Sub-features

- `hello-screen` — first run shows the greeting screen with the person's name and three ideas.
- `onboard` — the person's chosen address lands in `/api/state` (`person.address`).
- `chief-greeting` — Chief's thread opens with his greeting (`I am Chief, of the Crewhouse…`).
- `chief-chat` — a message becomes a task that settles with a reply.
- `shared-profile` — Chief saves directly stated personal/work facts from onboarding and chat with `crew_profile`; the complete merged record stays under 4000 characters and his reply says plainly what he noted.

## How to get to it (user POV)

- Open the app with no person onboarded yet; the Hello screen is the first thing shown.
- Type a name, pick one of the three ideas (or send your own ask); the app opens Chat with Chief.

## Driving it with the API and browser

Preconditions: fresh lab (no onboarded person); `$B` and `$H` as in SKILL.md.

- **State before.** `curl -fsS "$B/api/state"` → `person.address` is null, `person.name` "Owner".
- **Onboard.** `curl -fsS -X POST "${H[@]}" -d '{"address":"Sir"}' "$B/api/onboard"` → `/api/state` now shows `"address":"Sir"`.
- **Chief's page.** `curl -fsS "$B/api/bots/chief"` → first `author:"bot"` message matches `I am Chief, of the Crewhouse` and names his stop-and-ask rules (`stop and ask you first before sending anything, spending money`).
- **Chat.** `curl -fsS -X POST "${H[@]}" -d '{"text":"I need a demo video"}' "$B/api/bots/chief/messages"`; poll the same page until the reply `stub chief: done with "The person says: I need a demo video"` appears and the task row reaches `done`.
- **UI.** Bootstrap the browser per [Drive](../SKILL.md#drive), then visit `/` in that same tab: the Hello screen shows the name field and three ideas (eval their labels and `getBoundingClientRect`); after onboarding the Chief thread shows hero + Needs-you row and the composer. Capture 1440 and 390 screenshots; at 320 record the actual wrap/scroll behavior of the longest idea label.

## Shared profile (real-model words)

Use SKILL.md's isolated real-engine launch and credential lock for the whole lifetime.
Select the signed-in Claude account for Chief through `PUT /api/bots/chief/models`.
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

The screenshot/recording helpers mentioned in SKILL.md are absent. When using the
fleet-required `chrome-devtools-axi`, use its own task-scoped session, `emulate --viewport`,
`open <base>/?day` / `open <base>/?night`, `eval` for visible text/geometry, and
`screenshot <EV>/<name>.png`. Record real browser frames from that same session's CDP
`Page.startScreencast` (acknowledge frames, retain timestamps), then mux with ffmpeg.
Do not substitute demo copy or injected messages for the actual Chief reply.
Stop every owned daemon/engine by its recorded port before releasing the credential lock.
`node scripts/personal-voice.mjs` and its self-test are also absent at this revision;
report them as unperformed rather than claiming a clean scan. Inspect the actual note's
plain, single-person wording in the retained replies and all four captures.

## Published template catalogue (real-model words)

With the real-engine launch in SKILL.md, first prove browsing in two Chief turns:

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
CDP `Page.startScreencast` and ffmpeg; `scripts/screens.sh` and `scripts/record.mjs` are
absent at this revision. Keep API replies, tool-call events, capture geometry and decoded
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
