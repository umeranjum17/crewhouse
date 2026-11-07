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

Not covered here: the browser approved by two words (C2), the sign-in card leading with the code for such a browser (C3), and
a phone's route to a server (C6). Without a VM: `node --test test/failure-words.test.ts`.
