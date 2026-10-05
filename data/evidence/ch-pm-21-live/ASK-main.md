# What this lane needs from main (the captain's two steps)

crewd is already up on **http://127.0.0.1:7751** — PR 304's code (branch `fm/ch-pm-21`, HEAD `826a086`),
the real engine, the retained home's real ChatGPT sign-in (`/api/accounts` says `signedIn: true`).
`GET /api/connections` shows the real blocker, verbatim:

```
"house": "Google Calendar needs Google switched on for your crew first; set it up once in Settings."
```

So the connect path is one captain step away. Two steps, both in a browser, both on the
captain's own accounts. I type neither.

## 1. The household Google client (Settings → Google setup)

If the captain's **own** crewd already has Google switched on, the same two values work here —
that is the fast path and it is what I would ask for first. Otherwise `docs/google-setup.md`
steps 1-4, about twenty minutes, free:

1. Google Cloud console, project **Crewhouse (personal)**, no billing.
2. APIs & Services → Library: enable **Google Calendar API** (Gmail and Drive too if wanted later).
3. OAuth consent screen: **External**, app name Crewhouse, support + developer contact = own email,
   scopes `.../auth/calendar.events` (+ `gmail.readonly`, `drive.file`), then **Publish app**
   (In production) — in Testing every connection dies after 7 days.
4. Credentials → **OAuth client ID** → application type **Desktop app**, name `Crewhouse home computer`.
5. Open http://127.0.0.1:7751 → **Settings → Google setup**, paste the Client ID
   (ends `.apps.googleusercontent.com`) and the Client secret (starts `GOCSPX-`), press
   **Switch it on**.

Or, from a terminal on the captain's side (same two values, still no credential in my hands):

```
curl -fsS -X PUT http://127.0.0.1:7751/api/house/google -H 'content-type: application/json' -H 'x-crewhouse: 1' \
  -d '{"id":"<client id>","secret":"<client secret>"}'
```

## 2. The consent tap on Google's own page

Open http://127.0.0.1:7751, **Settings → Apps → Google Calendar → Connect**. Calendar is a
*sensitive* scope, so Google's unverified-app screen appears: **Advanced → Go to Crewhouse (unsafe)
→ Continue**, then tick Calendar and allow. That is the same shape as the ChatGPT sign-in already
done once for this home.

Nothing else about the session changes: I do not touch, reorder or close the captain's browser
session, and no credential, token or device code is ever copied or typed by me.

## What I do the moment step 1 lands

Drive the real web app at 1440 and 390, dark and light, into `data/evidence/ch-pm-21-live/`:
the connect card → Google's consent → **the proof** (PR 304's `proof()` read: today's events),
then the **first real use** — ask Chief for something a person would actually do with a
calendar, on the live account — and the outcome in the thread. One motion recording of the connect.
