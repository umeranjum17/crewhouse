# The `crewhouse` command

Two installs have no checkout and give one command: `npm install -g crewhouse`, and `install.sh` (the cloud download,
which carries its own Node and engine, unpacked under `~/.local/share/crewhouse/release/` with a shim in
`~/.local/bin/`). Both run `bin/crewhouse.mjs`, which hands everything to the same `crewhouse` launcher script a
checkout uses (`./crewhouse`). `start`, `stop`, `status`, `link`, `update` and `doctor` print plain words; `status` exits
3 when Crewhouse is not running. `update` stays inside the way it was installed: npm installs the newest version with
`npm install -g`, the one-line install runs its own `install.sh` again; both stop crewd first and start it again if it
was running.

## Driving it

Clean state: an empty folder, a throwaway HOME, a dead D-Bus address, no repo. The first `start` of an npm install
installs the AI engine (minutes, ~1 GB); a download already carries it.

```bash
bash scripts/verify/cli-install.sh <out> npm
node scripts/build-web.mjs && node scripts/package.mjs <dist>      # the cloud download (heavy; memory gate)
bash scripts/verify/cli-install.sh <out> download <dist>/crewhouse-<version>-linux-x64.tar.gz
```

`CLI_LAB_ROOT=<dir>` keeps the lab off `/tmp`. Each run writes `cli-install-<mode>.txt` (every command, its words and its
exit code) and exits 0 only when each said what it should. The registry's copy of `crewhouse` has not got these commands
until a version carrying them is published, so npm mode packs this checkout (`npm pack`) and installs that.

`update` needs a newer version to exist. For npm, point `npm_config_registry` at a local registry that holds the
current and a newer version; for the download, `CREWHOUSE_TARBALL=<tarball> crewhouse update` reinstalls that build in
place (the swap, the stop and the start are the same).

## What to check

- `crewhouse --version` is plain ("Crewhouse 0.1.4"), never `-dev`.
- `status` before the first start says it is not running (exit 3) and installs nothing; `stop` says the same (exit 0).
- `start` prints the address and a phone pairing code; `status` then gives the pid and the same address.
- `link` prints the link that adds a phone, or says Crewhouse is not listening for phones yet.
- `doctor` lists the machine's tools with the installed command's name (`crewhouse tools install …`), never `./crewhouse`.
- `stop` stops crewd, a second `status` says not running, and a wrong word prints the usage with exit 2.
- Nothing outside the lab changes: no systemd unit, no keyring entry, no file in the real HOME.
