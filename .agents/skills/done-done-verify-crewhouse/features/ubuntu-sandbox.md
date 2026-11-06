# The helpers' sandbox on a stock Ubuntu

Part of the crewhouse verification map. Source: `docs/verification/ubuntu-sandbox.md`.

## How to get to it (user POV)

A person on a stock Ubuntu 24.04 desktop installs Crewhouse (the `.deb`, or `crewhouse start` which runs `crewhouse setup`). Their helpers' shell must start, and `crewhouse doctor` must say so, without them reading AppArmor notes.

## Driving it

1. `node scripts/package.mjs <dist>` (memory gate), then `bash scripts/verify/ubuntu-sandbox.sh <out> <dist>/crewhouse_<version>_amd64.deb` (needs /dev/kvm, Docker and a qemu image; about 10 minutes).
2. Capture: `ubuntu-sandbox-deb.txt` and `ubuntu-sandbox-setup.txt`, the VM console of each mode, from the stock `ubuntu` login's own commands. Exit 0 means the probe failed before with the kernel's refusal and passed after, doctor repeated it, and crewd's own shell ran.
3. Without a VM: `node --test test/sandbox.test.ts`.
