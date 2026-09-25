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
| `bots[]` `{id, display, role, template, task, queued, pausedUntil, stuck, quietSince, step, computer, controls}` | Chats list, Crew, sidebar, stuck notes | `template` picks the pal. crewd sends no model or engine names; `thinks` is account names only, and never read |
| `bots[].last` `{author, text, at}`, `bots[].unread` | The chat list: each thread's last line and time, newest first (Chief pinned), and how many lines are new | The viewer's own thread only; `adapter.chats()` turns a delivered file into "Sent “Name”" and the person's own line into "You: …". `POST /api/bots/:id/read` clears `unread` when the chat is on screen; a view-only phone can't |
| `GET /api/search?q=` → `{messages[], things[]}` | Search your chats | The viewer's own lines and finished things, newest first; two letters at least. `adapter.found()` words them |
| `tasks[]` (done, with `files`) | Things, "done today" | `title` must be a short name, never the prompt |
| `asks[]` | Ask cards, the approval sheet | See below |
| `events` | Desktop "Today" rail | Mapped to steps by `adapter.step()` |
| `ideas[]` `{bot, promise, ask}` | Idea chips | `promise` is shown as written |
| `routines[]` `{name, words, next_at, state, kind, quiet, history}` | Routines | `quiet`: a check-in that only speaks up when something needs the person ("Only tell me if something's up"); a history run with `clear` found nothing. `thinks` (an account name) is never read |
| `resting` `{account: until}` | "Your ChatGPT is resting until 6:40 pm" | Only this member's resting accounts; only the earliest time is shown |
| `connections` | Apps grid: which apps are on | Array of app ids: `drive`, `calendar`, `gmail` (each its own Google connection), `notion`, `canva` |
| `share` `{choice, used}` | Settings, "How much of it the crew may use" | `choice` is `light` (default), `normal` or `full`; `used`: today's share is gone, so routines and check-ins wait for tomorrow (things the person asks for still run). Shown as words, never a number. Set with `PUT /api/people/:id {share}` |
| `money` `{cap, spent}` | Settings, Money (owner only; absent for everyone else) | Dollars this month: the cap (`PUT /api/house/money {cap}`, owner only, default 20) and what yeses to spends with a known price added up to. Past the cap a spend is refused before it asks |
| `house` `{google}` | Google's apps: connect, or "Ask the owner" | Whether the owner has switched Google on for the house |

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

A connection a task needs is an ask with `kind: 'connect'` and `detail.{app, words}` ("Let Pip use your Google Calendar"), opened by the helper's `crew_connect` tool.
It shows as a card in that helper's chat, never on Home. Answer `allow` once connected (the app does it by itself), `deny` for Not now; the task carries on either way.

## Messages: `GET /api/bots/:id` (today)

`messages[]` `{author: person|bot|chief|system, text}`; a system text `Delivered files/x.mp4: note` becomes a media card.
**Wanted**: `choices: string[]` on a bot message, shown as tap-to-reply chips ("Soft & sweet", "Upbeat").
`trail` (events) becomes the "What I did" step list; `run.tool` events carry crewd's own plain `words` ("Searched the web for “school trips”", "Worked on a video", "Used its browser").
**Wanted**: a crewd-written `task.progress` for each meaningful step ("Picked 8 photos from Eid"), because that is what makes the list worth reading.

## Who a helper is, and what the crew knows about you (today)

`GET /api/bots/:id` also carries `soul` (who the helper is, in plain sentences under a `# Name` heading), `soulCap`, `skills[]` `{name, says}` (`says` is the skill in the person's words; the app never shows `description`), and `notes`: what that helper learned about **the viewer**, never another member.
`PUT /api/bots/:id/soul` `{text}` saves the person's words (the app keeps the `# Name` heading); `POST /api/bots/:id/soul/reset` puts back how it started. No bot can change its own.
`PUT /api/bots/:id/notes` `{text}` is the viewer's own notes with that helper. `GET`/`PUT /api/about` `{notes, cap}` is what the whole crew knows about the viewer: every helper reads it before a job for them. A `memory.learned` step with `everyone` went there; Undo works on the viewer's own only.

A **suggestion** is an ask with `kind: 'propose'` and `detail.{words, preview: {head, body}}`: a skill a helper would like to keep (from `crew_learn`), or a new personality Chief suggests for a helper (from `crew_suggest`). It is a yes-or-no card ("Yes, keep it" / "Not now"), never "always"; nothing changes until `allow`, and it belongs to no running job, so it waits across restarts.
`skills[]` rows carry `learned`; `DELETE /api/bots/:id/skills/:name` puts a learned one away (kept, no longer used). A skill it came with can't be removed.

## First run (today)

`POST /api/onboard` `{address, ask}`: how Chief addresses the person and, from an idea card, their first request, in one tap.
Her Chief thread then starts with that request. With no AI account yet it waits (a `paused` task with no wake time) and Chief says one line ("Delighted, Sara. To think, the crew uses your own ChatGPT, the same one you already use."); the app shows the sign-in right under it. Signing in starts it by itself, and Chief says "You're signed in. Thank you, Sara. On it now."

## Sign in with ChatGPT (today)

`GET /api/accounts` rows `{member, account, name, signedIn, restingUntil, signIn, notIncluded, work}`; the app reads `account: 'chatgpt'` for the viewer's member id.
`POST /api/accounts/:member/chatgpt/login` answers at once with `signIn: {state: 'waiting', via: 'browser', url}`: ChatGPT's own page, which the app opens in a tab it opened in the same tap (so it is never blocked as a pop-up). ChatGPT sends that tab back to crewd's own listener on port 1455, which shows Crewhouse's words only once the sign-in works; the sheet moves on when `signedIn` turns true.
`{via: 'code'}` ("Having trouble?") turns the same sign-in into `{via: 'code', code, url}`; crewd does it by itself when the page hasn't come back in three minutes. `{fresh: true}` asks ChatGPT's page which account again ("Use my personal account").
A sign-in that fails ends as `signIn: {state: 'failed', error, why?}`: `why: 'declined'` (Cancel on ChatGPT's page), `why: 'busy'` (something else on this computer is signing in to ChatGPT), or `error` saying "expired"/"took too long"; each has its own words in the app.
`work` is the email of a work ChatGPT (Business, Enterprise, Edu), read from the sign-in itself; the app offers "Use my personal account".
`notIncluded`: the plan has no helpers (ChatGPT's `usage_not_included`). `…/ask-owner` puts a note in the owner's Chief thread; `…/retry` is "I've changed my plan".
`…/cancel` stops a sign-in, `…/logout` signs out. No other provider is shown. Claude is never offered.

## Connecting an app (today)

| Call | Returns |
|---|---|
| `POST /api/connections/:app` | `{url}` of the app's own sign-in page, or `{state: 'on'}` if already connected; 409 for a Google app before the owner switched Google on; 404 for an app not in v1 |
| `GET /api/connections/:app` | `{state: 'waiting' \| 'on' \| 'declined' \| 'unticked' \| 'expired' \| 'failed' \| 'cancelled', error?}`, polled |
| `DELETE /api/connections/:app` | Cancels a pending one, or disconnects |
| `PUT /api/house/google` `{id, secret}` | Owner only: the household Google app's client, once ([google-setup.md](google-setup.md)) |

`drive`, `calendar` and `gmail` are one Google service each, on the household's Google app; `calendar` and `gmail` show Google's "unverified app" screen, which the card warns about first. `notion` and `canva` need nothing set up.

## Share to Crewhouse (today)

`web/manifest.webmanifest` makes the installed app a Share target: `/share?title&text&url` opens a card, and Chief asks what to do with it (Add to my calendar + remind me, Just remember it, Something else…). It goes to Chief as a request.

## Phones

`GET /api/phones` → `[{id, name, member, person, role, seen, online}]`; `POST /api/phones/pair {role: 'control'|'view'}` → `{qr, expires, urls}`;
`DELETE /api/phones/:id`; `GET /api/phones/link`, `PUT /api/phones/lan {on}` and `PUT /api/phones/relay {url}` → `{on, lan, pinned, tailscale, hosts, relay, relayDefault, asking: [{id, name, words, role}]}`.
`relay` is the address phones use from anywhere (`''`: none); `relayDefault` says it is Crewhouse's own. `url` is an `https://` or `wss://` address, `''` for none, or `null` to go back to the default.
A phone that scans the code waits in `asking` until the person compares its two words and answers `POST /api/phones/answer {id, yes}`.
These answer on the computer only, never over the phone link (`src/link.ts`, on `@byokit/link`). A 404, or `on: false`, shows "The phone app is on its way".
The phone app (`mobile/`) reads crewd through this same adapter and `web/src/api.ts`, with the link as its transport: each call is one request `METHOD /path`.

## Unreachable

Any request that fails without an HTTP status is "the home computer isn't answering": a full screen before first load, a banner after.
Both retry by themselves and say "Back in touch" when it answers again.
