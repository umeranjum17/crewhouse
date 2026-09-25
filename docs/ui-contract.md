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
| `bots[]` `{id, display, role, template, task, queued, pausedUntil, stuck, quietSince, step, computer, controls}` | Home bubbles, Crew, sidebar, stuck notes | `template` picks the pal. crewd sends no model or engine names; `thinks` is account names only, and never read |
| `tasks[]` (done, with `files`) | Things, "done today" | `title` must be a short name, never the prompt |
| `asks[]` | Ask cards, the approval sheet | See below |
| `events` | Desktop "Today" rail | Mapped to steps by `adapter.step()` |
| `ideas[]` `{bot, promise, ask}` | Idea chips | `promise` is shown as written |
| `routines[]` `{name, words, next_at, state, kind, history}` | Routines | `thinks` (an account name) is never read |
| `resting` `{account: until}` | "The crew is resting until 6:40 pm" | Only this member's resting accounts; only the earliest time is shown |
| `connections` | Apps grid: which apps are on | Array of app ids; today `gmail`, `calendar`, `drive` (one Google connection), `notion`, `canva` |

## Asks: the approval moment

Today a permission ask carries `title` and `detail.{effect, words, spends, covers, always}`, written by crewd's gate from the tool and its input, never by the model:
`effect` is `send`, `spend`, `delete` or `files`; `words` is the sentence ("Reel wants to change a file in your Documents folder: “plan.txt”."); `always` is what "Always OK" would cover, and is absent for spending.
There is no `summary`, `tool`, `rule` or terminal text any more.
**Wanted** still, on `ask.detail`:

| Field | Example | Shown as |
|---|---|---|
| `thing` | `note` | "Scribe's note is ready to send" |
| `preview` `{head, body}` | `{head: "To Aunty Sara · from your Gmail", body: "Dear Aunty Sara, …"}` | Exactly what goes out, in the sheet |
| `chief` | "A lovely note, if I may say so." | Chief's line under the preview |
| `question` | "Which photos, the Eid ones or the beach?" | For a question ask, instead of terminal text |

A connection a task needs is an ask with `kind: 'connect'` and `detail.{app, words}` ("Want a copy in the family Drive too?").
It shows as a card in that helper's chat, never on Home. Answer `allow` once connected, `deny` for Not now.

## Messages: `GET /api/bots/:id` (today)

`messages[]` `{author: person|bot|chief|system, text}`; a system text `Delivered files/x.mp4: note` becomes a media card.
**Wanted**: `choices: string[]` on a bot message, shown as tap-to-reply chips ("Soft & sweet", "Upbeat").
`trail` (events) becomes the "What I did" step list; `run.tool` events carry crewd's own plain `words` ("Searched the web for “school trips”", "Worked on a video", "Used its browser").
**Wanted**: a crewd-written `task.progress` for each meaningful step ("Picked 8 photos from Eid"), because that is what makes the list worth reading.

## Sign in with ChatGPT (today)

`GET /api/accounts` rows `{member, account, name, signedIn, restingUntil, signIn}`; the app reads `account: 'chatgpt'` for the viewer's member id.
`POST /api/accounts/:member/chatgpt/login` with `{via: 'code'}` answers at once with `signIn: {state: 'waiting', url, code}`: the page to open and the one-time code to type there.
The sign-in finishes by itself (`signedIn` turns true); `…/cancel` stops it, `…/logout` signs out.
A sign-in that fails ends as `signIn: {state: 'failed', error}` with `error` in plain words and one next step; a code that ran out says "expired" or "took too long".
No other provider is shown. Claude is never offered.

## Connecting an app (today)

| Call | Returns |
|---|---|
| `POST /api/connections/:app` | `{url}` of the app's own sign-in page, or `{state: 'on'}` if already connected; 404 for an app that can't be connected here yet |
| `GET /api/connections/:app` | `{state: 'waiting' \| 'on' \| 'expired' \| 'failed' \| 'cancelled', error?}`, polled every 2 s |
| `DELETE /api/connections/:app` | Cancels a pending one, or disconnects |

`gmail`, `calendar` and `drive` are one Google connection, and need the household's own Google app (set up once by the owner); `notion` and `canva` need nothing set up.
`outlook`, `photos` and `spotify` answer 404 for now.

## Phones (wanted)

`GET /api/phones` → `[{id, name, member, seen}]`; `POST /api/phones/pair` → whatever the pairing QR needs.
A 404 shows "The phone app is on its way".

## Unreachable

Any request that fails without an HTTP status is "the home computer isn't answering": a full screen before first load, a banner after.
Both retry by themselves and say "Back in touch" when it answers again.
