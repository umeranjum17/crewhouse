# The crewhouse command (install line)

Part of the crewhouse verification map. Source: `docs/verification/cli-install.md`.

## How to get to it (user POV)

A person with no checkout types `curl -fsSL …/install.sh | sh` or `npm install -g crewhouse`, then `crewhouse start`, `status`, `link`, `doctor`, `update` and `stop` in any folder.

## Driving it

1. `bash scripts/verify/cli-install.sh <out> npm` (packs this checkout, installs it into a throwaway prefix, first start installs the engine) and, for the download, `bash scripts/verify/cli-install.sh <out> download <dist>/crewhouse-<version>-linux-x64.tar.gz` after `node scripts/package.mjs <dist>` (memory gate).
2. Capture: `cli-install-npm.txt` and `cli-install-download.txt`, every command with its words and exit code. Exit 0 means each said what it should.
3. `update`: npm against a local registry holding a newer version; the download with `CREWHOUSE_TARBALL=<tarball> crewhouse update` (the swap and restart).
