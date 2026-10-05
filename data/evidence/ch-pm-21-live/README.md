# ch-pm-21-live — a connect proved against a LIVE Google Calendar account

Real `crewd`, **real engine**, the **one retained test home's real ChatGPT sign-in**
(`/home/umer/lab-tmp/crewhouse-retained`, `CREWHOUSE_ENGINE` unset), this branch's own code
(`src/main.ts` from `fm/ch-pm-21-live`, which carries PR 304's `proof()`), the real web app in a
real browser. Loopback only, port 7751, one lane.

**What is proved live:** a real Google Calendar account was connected through the product, and the
product proved the connection by making a real read of the real calendar before calling it connected.

**What is NOT proved:** the first real *use* (adding an event through Chief). The ChatGPT account on
the retained home is rate-limited and refused every model turn. Exact words, verbatim:

```
openai is asking us to slow down. Please wait a moment before trying again.
```

Three separate asks were sent through the app's own composer and each was refused the same way
(`engine-refusal.txt`, `screens/first-use-outcome-*.png`). No stand-in was substituted and nothing
here should be read as "the first real use was proved".

## The proof that it worked, live

`GET /api/connections` (`connections-live.json`):

```json
{ "app": "calendar", "name": "Google Calendar", "connected": true,
  "connecting": { "state": "done", "proof": "You have 0 things on today." } }
```

That proof line is PR 304's `Connections.proof('calendar')`: a live `GET` of today's events on the
person's own calendar through Google's API. The account's day is genuinely empty, so "0 things on
today" is the honest answer, not a stub. The same sentence reached the person in Chief's own thread
(`screens/connect-proof-*.png`, `chief-thread-live.json`):

> Google Calendar is connected, and it works. You have 0 things on today.

## How the connection was made

The Google OAuth client and the consent tap are the captain's, through the app's own Settings →
Google setup and Settings → Apps → Connect, exactly as `docs/google-setup.md` describes (Advanced →
Go to Crewhouse (unsafe) → Continue for the sensitive Calendar scope). This lane typed no credential,
no token and no device code, and never touched the captain's browser session. The consent round trip
happened before this session resumed after a relaunch, so the captures show the product's own connect
flow rather than Google's page:

- `screens/connect-sheet-{night,day}-{1440,390}.png` — the connect sheet open on Google's real
  sign-in URL for the same household client (Drive, the one app still free to open). Cancelled from
  the sheet; `connections-live.json` shows Drive left nothing behind.
- `motion/connect-sheet.webm` — that same interaction, 295 frames, 14.0s, real Chrome screencast.

## The first real use, and the refusal

Asked through the app's own composer, as a person would:

1. "put lunch with Dana on my calendar tomorrow from 12:30 to 13:30" — refused 16:38.
2. "put coffee with Sam on my calendar tomorrow at 9:00 for 30 minutes" — refused 16:48.

Chief's answer both times, in the thread, is the product's own failure line: *"ChatGPT couldn't
finish this one. Try again."* The engine's log carries the cause. `screens/first-use-outcome-*.png`
captures the request and the refusal in both themes at both widths; `motion/first-use-send.webm` is
the send itself (119 frames, 44.7s).

What is missing is one model turn. The Calendar connection is fine — `proof()` read it live minutes
earlier — and the ask card that would have carried the person's yes never appeared, because nothing
ever reached a helper.

## Known limitation, recorded not fixed

The Google app is in **Testing** mode, so this refresh token expires in 7 days (Google's documented
behaviour, and exactly what `docs/google-setup.md` step 3 warns about). Publishing the consent screen
is the captain's call and was deliberately not done here.

## Files

| file | what it is |
|---|---|
| `ASK-main.md` | what this lane asked the captain for, and where to paste it |
| `start.sh` | how this lane started the branch's crewd on the retained home's state |
| `connections-live.json` | the live connection list with PR 304's proof line |
| `accounts-live.json` | the retained home's ChatGPT sign-in, still signed in |
| `chief-thread-live.json` | Chief's thread: the proof sentence and both refused asks |
| `engine-refusal.txt` | the engine log lines behind the refusal, verbatim |
| `screens/apps-connected-*.png` | Apps screen, live connection, dark/light at 1440 and 390 |
| `screens/connect-proof-*.png` | Chief's thread carrying the proof sentence |
| `screens/connect-sheet-*.png` | the connect sheet on Google's real sign-in URL |
| `screens/first-use-outcome-*.png` | the real ask and Chief's refusal |
| `motion/connect-sheet.webm` | motion of the connect interaction |
| `motion/first-use-send.webm` | motion of the send that the account refused |
| `crewd.log` | the daemon's own log for this run |

`screens/connect-sheet-*-390.png` are 1170×2532 (390 CSS px at DPR 3, taken with the skill's
documented `emulate --viewport`): while Google's sign-in popup owns the browser window, a plain
`resize` no longer narrows the app page, so the skill's `screens.sh` cannot take that one at 390.
Everything else is a plain 1× capture.

## Reproduced by

```bash
data/evidence/ch-pm-21-live/start.sh                 # real engine, the retained home's state
curl -s http://127.0.0.1:7751/api/connections        # the proof line above
```
