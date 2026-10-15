# A desktop that cannot start says why (desktop-start refusal)

What it proves: opening a helper's screen on a machine whose engine cannot load a system
library fails **at start**, with the library named and its install hint — never later with a
generic error, and never "grant it on the Tools tab" for a computer that is already granted.
A healthy machine opens the same screen.

This is a CLI/API proof: no screen, screenshot or motion is involved (the web Screen card
renders its own sentence for any failure, unchanged).

## Drive

The checked-in driver boots the real crewd twice, isolated, and talks to the app's own
desktop socket (`/ws/desktop/<bot>`, subprotocol `crewhouse-person.<key>`, then
`session.open`) — the same call the web app's `desktopSignaling` makes:

```bash
node src/main.ts &                 # or let the driver start it; CREWHOUSE_ENGINE=stub, throwaway HOME/XDG
bash data/evidence/ch-desktop-start-readiness/run.sh "$EV" after
```

`run.sh` writes `<label>-broken.txt`, `<label>-healthy.txt` and the two crewd logs. Expected:

- broken: `{"id":1,"error":{"code":"engine","message":"bot desktops need the desklink engine:
  missing system library: libevdev.so.2 (Fedora: sudo dnf install '*/libevdev.so.2'; …)"}}`
- healthy: `{"id":1,"result":{…"sessionId":…}}` — the screen opened.

The broken engine is a task-private `/bin/sh` stub that prints the loader's own
`error while loading shared libraries: libevdev.so.2` line and exits 127. The host's own
engine and libraries are never touched.

## Fences

- The probe's cache still governs: a definite answer (ready, or a named library) is kept for
  the whole crewd process. A library removed while crewd runs is seen after a restart.
- `missing()`/`probeEngine()` own the words; the driver asserts them, never rewrites them.
- `test/stub.test.ts` `desktop setup refuses a loader failure in doctor, the tool kit and the
  live state` covers the doctor/kit/`/api/state` half of the same probe; this recipe covers
  the desktop **start** half.
