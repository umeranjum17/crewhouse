# The setup fixes, on a fresh Ubuntu

Four fixes to first setup on Linux, each proved on a stock Ubuntu 24.04 cloud image in a throwaway qemu VM (KVM, systemd 255)
by `scripts/verify/setup-fixes.sh`. The VM has an admin login `ops` (only to look from outside) and, per run, a fresh stock
login with no sudo that does the install through a real ssh terminal. Container tests cannot see these problems: a container
has no login session to end, no logind, and no reboot.

```bash
node scripts/package.mjs <dist>                         # this checkout's cloud download (memory gate)
bash scripts/verify/setup-fixes.sh <out> fix1 <dist>/crewhouse-<version>-linux-x64.tar.gz alive           # the fix
bash scripts/verify/setup-fixes.sh <out> fix1 <the released crewhouse-linux-x64.tar.gz> dead              # the bug, same machine
bash scripts/verify/setup-fixes.sh <out> fix1 <tarball> alive headless                                      # crewhouse setup --headless
bash scripts/verify/setup-fixes.sh <out> fix2 <tarball> honest         # fix 2; `ready` on the released build shows the bug
```

Needs /dev/kvm, Docker and a qemu image (`QEMU_IMAGE`, default `byk-cloud-qemu:1`); about 4 minutes a run. Each run writes
`setup-<fix>-<tarball name>[-headless].txt`, the stamped words of every command, and exits 0 only when it met its expectation.

## Fix 1: keep running after logout

A user service stops at the last logout unless the account lingers. A yes to "Start Crewhouse by itself whenever you log in?"
(and `crewhouse autostart on`, and `crewhouse setup --headless`) now also turns linger on with `loginctl enable-linger`, which
needs no admin rights for your own account, and says so. A machine that refuses prints the one line an administrator pastes
(`sudo loginctl enable-linger <you>`); Crewhouse still starts at login.

Pass: the one-line install, Enter, logout, 60 seconds; from a second account `curl 127.0.0.1:7711` answers 200; and 200 again
after `sudo reboot` with nobody logged in. The released 0.1.10 answers 000 after the logout and after the reboot.
`autostart off` leaves linger as it is: the account's linger is a machine setting other programs may rely on.

Without a VM: `node --test test/start-home.test.ts` (a stub login manager records the one call and the refusal's line).

## Fix 2: an honest `crewhouse doctor`

Doctor said "ready" with a port another program holds, a corrupt database, the engine folder gone and no internet, and
crashed with a stack trace when the app's own files were gone. `bin/health.mjs` (Node only, read-only, outside crewd's
line budget) now finds the first four before anything loads, and the launcher's `doctor` case catches the last. Each is a
`✗` with its cause and one `fix:` line; exit 1; the unbroken machine is still ready, and a doctor that throws prints one
`✗` line, not a stack. Doctor never changes anything: the corrupt database is left exactly as it was.

The internet check looks at github.com (`CREWHOUSE_ONLINE_URL` moves it, empty skips it; tests and lab runs skip it).
The engine-folder check only fires after a first run (`person.key` exists) so a fresh install is not blamed.

Pass: `setup-fixes.sh <out> fix2 <tarball> honest` makes each break on the VM, one at a time, and asks doctor after each:
exit 1, a `✗` line, a `fix:` line, no "ready" and no stack trace; healthy before and after is ready (exit 0). On the
released 0.1.10 (`ready`), doctor calls the other four ready and crashes on the missing files.
Without a VM: `node --test test/failure-words.test.ts`.
