# The setup fixes on a fresh Ubuntu

Part of the crewhouse verification map. Source: `docs/verification/setup-fixes.md`.

## How to get to it (user POV)

A person installs Crewhouse on a rented Ubuntu server with the one-line install, presses Enter at "Start Crewhouse by itself whenever you log in?", and logs out. The crew must still answer, also after a reboot.

## Driving it

1. `node scripts/package.mjs <dist>` (memory gate), then `bash scripts/verify/setup-fixes.sh <out> fix1 <dist>/crewhouse-<version>-linux-x64.tar.gz alive` (needs /dev/kvm, Docker and a qemu image; about 4 minutes). Add `headless` for `crewhouse setup --headless`.
2. The bug on the same machine: the same command with the released `crewhouse-linux-x64.tar.gz` and `dead`.
3. Capture: `setup-fix1-<tarball>.txt`, the install's words, then port 7711 asked from the admin account 5 s and 60 s after the logout and after `sudo reboot`. Exit 0 means the run met its expectation.
4. Without a VM: `node --test test/start-home.test.ts`.
