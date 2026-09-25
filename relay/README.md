# Crewhouse relay

How a phone reaches the family computer from anywhere, without the computer opening a port: crewd dials out to the
relay, the phone dials the relay, and the relay passes [link](https://www.npmjs.com/package/@byokit/link) frames
between them. It runs [`@byokit/relay`](https://www.npmjs.com/package/@byokit/relay) (pinned exactly) with Crewhouse's
settings, in `main.ts`.

What the relay can and can't see:

- **Messages:** it can't read them. They are end-to-end encrypted (Noise IK) between the phone and the computer.
- **Push:** content-free. Whatever a computer asks for, a phone is told only "Crewhouse has news", with no body, data
  or buttons, and fetches the words over the encrypted link. `main.ts` enforces this on the relay itself.
- **Metadata:** which computers are registered, when phones connect to them, and phones' push addresses.

There is no hosted Crewhouse relay, and the app has no relay address built in. A family runs their own and sets it: **Settings, Phones** on the computer (`PUT /api/phones/relay {url}`), or
`CREWHOUSE_RELAY=https://relay.example` for crewd. `''` turns the relay off.

## Run your own

With Docker, from the repository root:

```bash
docker compose -f relay/compose.yml up -d
```

It listens on `127.0.0.1:7300`. Put TLS in front of it, for example `tailscale serve --bg 7300` (the family's phones on
the tailnet) or Caddy with `reverse_proxy 127.0.0.1:7300` (a public name). Check it with
`node relay/health.ts https://relay.example`.

Without Docker: `cd relay && npm ci && node main.ts` (Node 22.19 or later).

| Setting | Default | |
|---|---|---|
| `PORT`, `HOST` | `7300`, `127.0.0.1` | where it listens (`0.0.0.0` in the image) |
| `RELAY_DATA` | `./relay-data` (`/data` in the image) | its one state file, `relay.json` (mode 600): registered computers, push addresses, its Web Push key. Back it up; never restore an old copy over a newer one (it would bring back a removed computer). |
| `RELAY_SIGNUP` | `enrol` | `enrol`: a computer needs a one-use, five-minute enrolment from the owner. `open`: any computer that proves its key may register, up to `RELAY_MAX_HOSTS` (1000). Nobody can take another computer's address either way. |
| `RELAY_OWNER_TOKEN` | off | turns on the owner's routes, with `Authorization: Bearer <token>`: `POST /relay/v1/enrolments` (an enrolment for one computer), `GET /relay/v1/hosts`, `DELETE /relay/v1/hosts/<id>` |
| `RELAY_TRUST_PROXY` | off (`1` in `compose.yml`) | rate-limit by `X-Forwarded-For`; only behind a proxy you run |
| `RELAY_PUSH_SUBJECT` | the project's page | Web Push contact, `mailto:` or `https:` |

`GET /health` answers `{"ok":true}`; the image's `HEALTHCHECK` runs `health.ts`.

## Limits

Per client address, per minute: 60 WebSocket connections, 10 short-code lookups, 20 notification button presses, 10
enrolment claims and 10 failed computer proofs. At most 256 phones connected to one computer at once, 2 MB per frame.
These are `@byokit/relay`'s own (`LIMITS`).

## Tests

`test/relay.test.ts` runs the relay on this machine: health, a computer registering with an enrolment, a phone pairing
by typed code and exchanging frames through it, content-free push (against a stand-in push service) and open signup.
CI also builds the image and checks its health.
