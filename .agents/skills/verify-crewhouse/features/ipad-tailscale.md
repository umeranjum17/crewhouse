# iPad over Tailscale https

The README's route for a real iPad ("The installed web app"). The installed app pairs only on an https page
(`crypto.subtle`), and an https page may dial only `wss://`. crewd's phone link serves the web app too
(`link.page` in `src/server.ts`), `./crewhouse phones web` puts that port behind `tailscale serve` at
`https://<computer>.<tailnet>.ts.net:<link port + 1>`, and the 12-letter code dials the page's own `wss://<host>/link` first
(`pair` in `web/src/link.ts`). `./crewhouse phones web off` (and `uninstall`) stops the serve.

## What it proves

- `phones web` prints the https address; Safari opens it with a valid certificate and offers Open as Web App.
- The installed app pairs with the 12-letter code from `phones code`; its two words equal `phones pending`.
- From the installed app: a message to Chief lands in crewd, a card's Start it adds the routine, and Stop ends the job
  (task `failed`, "Didn't finish"), in Day and Night.
- `ss -tnp` shows the app's connection reaching the link port only from loopback (tailscaled's proxy).
- `phones web off` leaves every other `tailscale serve` entry untouched.

## How to drive it

Needs Tailscale on this host (operator rights for `tailscale serve`, HTTPS certificates on in the tailnet) and the Mac
iPad simulator, which resolves the ts.net name. Start a stub crewd with an isolated HOME, every XDG dir, its own
`CREWHOUSE_PORT`/`CREWHOUSE_LINK_PORT` (OS-free ports, never 7712) and `PATH=/usr/bin:/bin`, then under that env:

```bash
./crewhouse phones web          # prints https://<host>.<tailnet>.ts.net:<link+1>
./crewhouse phones code         # paste the 12-letter code into the installed app's Pair sheet
./crewhouse phones pending; ./crewhouse phones approve '<two words>'
```

On the simulator: Safari → address → Share → Add to Home Screen → open the icon → **Pair — yes, let's go** → paste
(`axe type`). For a card and a job, post to `/api/bots/<helper>/messages` from the computer with the person key: a
stub `[tool crew_routine {...}]` (a `propose` card routed to Chief) plus `ask permission` (holds the run working).
Settings → Look switches Day/Night. Record with `xcrun simctl io <udid> recordVideo`.

## Limits

- Shared tailnet host: stop only your own serve port (`phones web off` under the lab env); never touch 443 or other
  ports' serves.
- The stub engine's words only; a real model and a real relay are not exercised.
