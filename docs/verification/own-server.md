# A person's own server

On a computer with no screen (reached over SSH, or Linux with neither `DISPLAY` nor `WAYLAND_DISPLAY`) `crewhouse start` and
`crewhouse open` cannot open a browser, so the launcher prints the one step for the person's own computer instead. The check
runs in the launcher, in the person's own session, never in crewd: its login service has no display or SSH variables at boot,
on a desktop too.

```
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:7711:127.0.0.1:7711 -L 127.0.0.1:1455:127.0.0.1:1455 you@this-server
```

- Explicit `127.0.0.1:` binds and `ExitOnForwardFailure=yes`: with the plain `-L 7711:...` form ssh keeps running on the IPv6
  side when the laptop's own program holds 127.0.0.1:7711, and the browser then shows the laptop's own page.
- A second line with 17711 in place of the laptop's 7711, for a laptop that already uses it.
- A third line without 1455: ChatGPT's sign-in comes back to the laptop's 1455, and a taken 1455 stops the whole line.
- `crewhouse open --link` prints the private link, with a warning on stderr first. It is the only place a server prints the
  key; `start` and `open` never do. A person at a desktop with a screen sees none of this: the browser opens as before.

```bash
node scripts/package.mjs <dist>                                  # this checkout's cloud download
bash scripts/verify/own-server.sh <out> <dist>/crewhouse-<version>-linux-x64.tar.gz printed
bash scripts/verify/own-server.sh <out> <the released crewhouse-linux-x64.tar.gz> released   # the build before
```

Needs /dev/kvm, Docker and a qemu image (`QEMU_IMAGE`, default `byk-cloud-qemu:1`); about 6 minutes a run. Two stock Ubuntu
24.04 cloud-image VMs share a virtual LAN (the second network card, 192.168.77.1 and .2). The server has the install and no
screen; the second VM is the person's own computer and runs only what the server printed. `printed` passes when the first
printed line reaches Chief's app, with its own program on 7711 the first line stops with ssh's "Could not request local
forwarding" and the 17711 line reaches Chief, with its program on 1455 the same and the line without 1455 reaches Chief, and
the key is in no server log. `released` passes when the build before prints only "Open http://127.0.0.1:7711/ in your browser."
Writes `own-server-<mode>.txt` (the private key never appears) and `steps.json`.

## Sign-in from such a browser (C3)

`crewhouse open --link` on a computer with no screen adds `&remote=1` to the link (`web/src/api.ts` keeps it for that browser
session only; crewd's own environment is never asked). For a browser with the mark the ChatGPT sheet starts the code route first
and offers the browser route second; the browser route names the exact forward it needs
(`-L 127.0.0.1:1455:127.0.0.1:1455`, the sign-in page comes back to port 1455). When the account has device codes turned off
the engine's refusal (`failure() === 'deviceCodeOff'`, the kit's own class) is shown as "ChatGPT has codes turned off", with a link to
ChatGPT's security settings, Try again and the browser route. A browser with no mark, a screen on the machine itself, keeps the
browser route first, as before.

`CHROME_DEVTOOLS_AXI_SESSION=<task-name> bash scripts/verify/signin-remote.sh <out>` captures the four sheets (demo data, one stub
lab to serve the app) day and night at 1440 and 390. Without a browser: `node scripts/test.mjs test/openclaw-wizard.test.ts` (a code the
account refuses is the kit's `deviceCodeOff`) and `node --test test/failure-words.test.ts` (the mark on `--link`, never on a screen).

Not covered here: a real device code through a real ssh session (asked first, one code, the retained test home), the browser
approved by two words (C2), and a phone's route to a server (C6). Without a VM: `node --test test/failure-words.test.ts`.
