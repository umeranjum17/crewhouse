# Onboard and chat with Chief

First contact: the Hello screen takes the person's name, onboarding records it, and Chief
greets in his own thread. A plain message is a Chief turn; his stop-and-ask rules lead his
first message.

## Sub-features

- `hello-screen` — first run shows the greeting screen with the person's name and three ideas.
- `onboard` — the person's chosen address lands in `/api/state` (`person.address`).
- `chief-greeting` — Chief's thread opens with his greeting (`I am Chief, of the Crewhouse…`).
- `chief-chat` — a message becomes a task that settles with a reply.

## How to get to it (user POV)

- Open the app with no person onboarded yet; the Hello screen is the first thing shown.
- Type a name, pick one of the three ideas (or send your own ask); the app opens Chat with Chief.

## Driving it with the API and browser

Preconditions: fresh lab (no onboarded person); `$B` and `$H` as in SKILL.md.

- **State before.** `curl -fsS "$B/api/state"` → `person.address` is null, `person.name` "Owner".
- **Onboard.** `curl -fsS -X POST $H -d '{"address":"Sir"}' "$B/api/onboard"` → `/api/state` now shows `"address":"Sir"`.
- **Chief's page.** `curl -fsS "$B/api/bots/chief"` → first `author:"bot"` message matches `I am Chief, of the Crewhouse` and names his stop-and-ask rules (`stop and ask you first before sending anything, spending money`).
- **Chat.** `curl -fsS -X POST $H -d '{"text":"I need a demo video"}' "$B/api/bots/chief/messages"`; poll the same page until the reply `stub chief: done with "The person says: I need a demo video"` appears and the task row reaches `done`.
- **UI.** Browser to `http://127.0.0.1:$PORT/`: the Hello screen shows the name field and three ideas (eval their labels and `getBoundingClientRect`); after onboarding the Chief thread shows hero + Needs-you row and the composer. Capture 1440 and 390 screenshots; at 320 record the actual wrap/scroll behavior of the longest idea label.

## Gotchas

- Onboarding is one-shot per state dir: a second `POST /api/onboard` is not the fresh journey — make a new lab instead.
- The reply text quotes your message with the `The person says: ` prefix the prompt template adds; match on the suffix, not the whole string.
- Poll for the reply; on a loaded machine the turn takes seconds. Never assert after a fixed sleep.
