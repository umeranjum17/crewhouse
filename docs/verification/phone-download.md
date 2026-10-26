# The phone app's download link

The Get-the-app card on Settings › Phones (and on the public shell's "Just on this phone" sheet) offers the newest
phone preview from the project's public forge, so a person who scans it installs today's build. `web/src/download.ts`
asks `api.github.com` for the releases list, takes the first phone-preview tag (`v1.0.0-preview.<date>.<n>`) that is
not a draft, picks its `-arm64-v8a.apk` asset and uses that link, keeping the answer ten minutes per page. The
hand-made rolling release `phone-preview/crewhouse.apk` stays the fallback: an unreachable, blocked or rate-limited
forge leaves the card on it, and nothing else on the screen says anything about the lookup.

## What it proves

- With the forge reachable, the card's code and its plain-text link are the newest preview's arm64 asset — not the
  rolling release — at 390 and 1440, day and night.
- The browser makes that request itself (`GET https://api.github.com/repos/umeranjum17/crewhouse/releases?per_page=20`),
  and its answer names the release the drive expects, read independently by the driver.
- With the forge's name unresolvable in the browser, the same card reads the stable link, and the request record shows
  the failure (`net::ERR_NAME_NOT_RESOLVED`). No error words reach the person.

## How to drive it

On a clean committed candidate, with the web app built (`npm run build:web`) and `chrome-devtools-axi` on `PATH`:

```bash
CHROME_DEVTOOLS_AXI_SESSION=<task-name> bash scripts/verify/phone-download.sh "$EV"
```

It boots one isolated crewd on the stub engine with the phone link on (a source checkout leaves it off, and Settings ›
Phones then shows no card), onboards Umer, and captures `download-{day,night}-{390,1440}.png` and
`download-forge-down-{day,night}-{390,1440}.png` into `$EV/screens`. Each capture waits for the card to read the link
that pass must show, so reading the old link fails the drive. Beside them: `forge-releases.json` (the forge's own
answer), `network-live.txt` and `network-forge-down.txt` (the browser's request record for each pass) and `steps.json`.

The unresolvable-forge pass is a second headless Chromium the driver starts with
`--host-resolver-rules="MAP api.github.com ~NOTFOUND"` and its own profile inside the lab; it is closed through
DevTools, never by signal. Nothing else is touched: no release is published or moved, and no account or credential is
used.

One shot to a browser: `chrome-devtools-axi` derives a bridge port from the session name, and on a host running several
lanes two sessions can hash to one port, where the second attaches to the other lane's bridge and its shots time out.
So each capture gets a session of its own on a port the driver picked free, and one theme per call (`screens.sh`
`THEMES=day|night`), which is also why the four shots take a couple of minutes on a loaded box.

## Limits

This is the web app's own card on a computer's browser. The installed phone app has no download card, and a paired
phone's app hides Settings › Phones, so there is no native or installed-PWA surface for this link. The demo
(`?demo`) screens run with no network and keep the stable link by design.
