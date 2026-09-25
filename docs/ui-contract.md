# What the app needs from crewd

The web app (and later the phone app) reads crewd only through `web/src/adapter.ts`, which turns crewd's rows into plain-words view models.
The engine can change underneath; when a field below lands, the adapter picks it up and the screens don't change.
Fields marked **today** already exist; **wanted** ones have a fallback in the adapter until crewd sends them.
`?demo` in the app URL runs every screen on `web/src/demo.ts`, which is written in this shape, wanted fields included.

The rule behind every field: nothing a person reads may be a command, a file path, an engine or model name, a usage percentage, a raw prompt or terminal text.
`test/ui.test.ts` feeds the adapter the owner's MVP screenshot (a raw `fc-list` approval, "Claude · 9% used") and fails if any of it reaches a screen.

## State: `GET /api/state` (today)

| Field | Used for | Notes |
|---|---|---|
| `person` `{id, name, address, onboarded}` | Hello gate, greeting | `id 1` is the owner; owner-only helpers (Tracer) hide from others |
| `members` | Settings → People, "who's using this screen" | |
| `bots[]` `{id, display, role, template, task, queued, pausedUntil, stuck, quietSince, step, computer, controls}` | Home bubbles, Crew, sidebar, stuck notes | `template` picks the pal. `thinks`, `runtime`, `model` are never read |
| `tasks[]` (done, with `files`) | Things, "done today" | `title` must be a short name, never the prompt |
| `asks[]` | Ask cards, the approval sheet | See below |
| `events` | Desktop "Today" rail | Mapped to steps by `adapter.step()` |
| `ideas[]` `{bot, promise, ask}` | Idea chips | `promise` is shown as written |
| `routines[]` `{name, words, next_at, state, kind, history}` | Routines | `brain` is never read |
| `resting` `{runtime: until}` | "The crew is resting until 6:40 pm" | Only the earliest time is shown, never which account |
| `connections` **wanted** | Apps grid: which apps are on | Array of app ids: `photos`, `gmail`, `calendar`, `drive`, `outlook`, `notion`, `canva`, `spotify` |

## Asks: the approval moment

Today a permission ask carries `title` and `detail.{tool, summary, rule, spends}`.
The adapter never shows `summary` or `tool`; it says "Reel would like your OK to carry on." with Yes / Always OK for Reel / Not now.
**Wanted**, on `ask.detail`, written by the tool rather than the model:

| Field | Example | Shown as |
|---|---|---|
| `effect` | `send` \| `spend` \| `delete` \| `files` | Button words; `spend` never offers "Always" |
| `words` | "Scribe wants to email your thank-you note to Aunty Sara. Send it?" | The card's sentence |
| `thing` | `note` | "Scribe's note is ready to send" |
| `preview` `{head, body}` | `{head: "To Aunty Sara · from your Gmail", body: "Dear Aunty Sara, …"}` | Exactly what goes out, in the sheet |
| `always` | `Aunty Sara` | "Always OK for Aunty Sara" (answers `scope: 'always'`) |
| `chief` | "A lovely note, if I may say so." | Chief's line under the preview |
| `question` | "Which photos, the Eid ones or the beach?" | For a question ask, instead of terminal text |

A connection a task needs is an ask with `kind: 'connect'` and `detail.{app, words}` ("Want a copy in the family Drive too?").
It shows as a card in that helper's chat, never on Home. Answer `allow` once connected, `deny` for Not now.

## Messages: `GET /api/bots/:id` (today)

`messages[]` `{author: person|bot|chief|system, text}`; a system text `Delivered files/x.mp4: note` becomes a media card.
**Wanted**: `choices: string[]` on a bot message, shown as tap-to-reply chips ("Soft & sweet", "Upbeat").
`trail` (events) becomes the "What I did" step list; `run.tool` events show only as "Worked on it", "Read a page on bbc.co.uk", "Used its browser".
**Wanted**: a crewd-written `task.progress` for each meaningful step ("Picked 8 photos from Eid"), because that is what makes the list worth reading.

## Sign in with ChatGPT (today, with one wanted field)

`GET /api/accounts` rows for `runtime: 'codex'` and the viewer's member id; `POST /api/accounts/:member/codex/login` starts it, `…/login/cancel` stops it.
The adapter pulls the link and one-time code out of `login.out` today. **Wanted**: `login.url`, `login.code`, and `login.state: 'expired'` when the code runs out, so nothing is parsed.
`state: 'missing'` shows "Almost ready: ask the owner to open Crewhouse at the home computer".
No other provider is shown. Claude is never offered.

## Connecting an app (wanted)

| Call | Returns |
|---|---|
| `POST /api/connections/:app` | `{url}` of the app's own sign-in page (or `{state: 'on'}` if already connected) |
| `GET /api/connections/:app` | `{state: 'waiting' \| 'on' \| 'expired' \| 'failed' \| 'cancelled'}`, polled every 2 s |
| `DELETE /api/connections/:app` | Cancels a pending one, or disconnects |

Until these exist, a 404 shows "Connecting Drive arrives with the next Crewhouse update" instead of a dead end.

## Phones (wanted)

`GET /api/phones` → `[{id, name, member, seen}]`; `POST /api/phones/pair` → whatever the pairing QR needs.
A 404 shows "The phone app is on its way".

## Unreachable

Any request that fails without an HTTP status is "the home computer isn't answering": a full screen before first load, a banner after.
Both retry by themselves and say "Back in touch" when it answers again.
