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
bash scripts/verify/setup-fixes.sh <out> fix4 <tarball> repairs         # fix 4; `missing` on the released build shows the bug
bash scripts/verify/setup-fixes.sh <out> fix3 <crewhouse-X.tgz> works  # fix 3, a tgz from `npm pack` of a clean export; `fails` with crewhouse@0.1.10 shows the bug
```

Needs /dev/kvm, Docker and a qemu image (`QEMU_IMAGE`, default `byk-cloud-qemu:1`); about 4 minutes a run. Each run writes
`setup-<fix>-<tarball name>[-headless]-<expectation>.txt`, the stamped words of every command, and exits 0 only when it met its expectation.

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

## Fix 3: the npm install on a default Ubuntu login

`npm install -g crewhouse` then `crewhouse start` died on a stock Ubuntu login with a raw `KeystoreError` stack: the login's
umask (002) makes every folder a program creates group-writable, our start created `~/.local` that way, and the sign-in
store refuses a folder others can write to. Retrying failed the same way.

`bin/crewhouse.mjs` now makes the state folders the person's alone before `start` or `setup` runs (new ones mode 700, like
`install.sh`); a group-writable one of theirs loses the group's write bit and the command says so ("Only you can write to X
now. It was 775; chmod 775 X puts it back."). `doctor` stays read-only. A folder that is someone else's cannot be fixed by
the person's own login, so `scripts/prepare-engine.mjs` prints plain words and one next line (a `sudo chown` of the state
folder) instead of the kit's stack trace.

Pass: on the VM, a default login installs Node 24 with nvm, `npm install -g <tgz>` and `crewhouse start`: running, exit 0, port
7711 answers 200, with no hand steps. Then `~/.local/state` is made root's: the start says "The AI engine could not be installed:
The folder your sign-ins would be kept in is not private to you ..." with `Next: sudo chown ...` and no stack trace, and after
that line is run the start succeeds. The released 0.1.10 (`fails`) dies with `KeystoreError`.
Build the tgz from a clean export, never the working copy: `git archive HEAD | tar -x -C <dir>` then `npm pack` there (the
working copy's ignored `dist/` leftovers would ship, 700 MB).
Without a VM: `node --test test/failure-words.test.ts`.

## Fix 4: `crewhouse triage`, one repair command

There was no command to run when Crewhouse would not start. Moving a corrupt database aside by hand did not work either: the
fresh database wanted to create Chief and found `bots/chief` already on disk ("a bot folder already exists"). Now
`crewhouse triage` (`bin/triage.mjs`, Node only, no AI, no network) runs even when the app cannot load, and keeps four rules:

- **Fixes itself**: its own folders' permissions (the shared `bin/private.mjs`, also used by `start`), and the pid/endpoint record of a Crewhouse that is no longer running (the files go; no process is touched, and a pid is only ever treated as Crewhouse's when its folder and command both prove it).
- **Asks first** (`--yes` answers yes; with no terminal and no `--yes` it only says what it would ask and exits 1): keeping Crewhouse running after logout (linger); moving a damaged database aside. The database is renamed (with its -wal and -shm) to `crew.db.damaged-<time>`, kept whole, never removed; a taken-over Chief folder is adopted as it is (`Crew.addBot`) instead of refused.
- **Hands over one line** for what it must not do itself (added in the next change).
- **Never**: deletes data, prints a key, kills what it cannot prove is Crewhouse's own, or loosens a setting that belongs to the whole machine (no sudo, nothing wider than the person's own folders).

`crewhouse doctor` now points a damaged database at `crewhouse triage`.

Pass: on the VM, with the state folder group-writable, a stale pid file and a corrupt database, `crewhouse triage` fixes the first two, asks one question and, on `y` in a real terminal, moves the database aside; the kept file is byte for byte the damaged one, `crewhouse start` runs again, Chief's folder is unchanged and doctor says ready. On the released build there is no `triage`, and moving the database by hand makes start fail.
Without a VM: `node --test test/failure-words.test.ts` (the three triage cases).
