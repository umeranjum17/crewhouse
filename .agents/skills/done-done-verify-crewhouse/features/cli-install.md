# The crewhouse command (install line)

Part of the crewhouse verification map. Source: `docs/verification/cli-install.md`.

## How to get to it (user POV)

A person with no checkout types `curl -fsSL …/install.sh | sh` or `npm install -g crewhouse`, then `crewhouse start`, `status`, `link`, `doctor`, `update` and `stop` in any folder.

## Driving it

1. `bash scripts/verify/cli-install.sh <out> npm` (packs this checkout, installs it into a throwaway prefix, first start installs the engine) and, for the download, `bash scripts/verify/cli-install.sh <out> download <dist>/crewhouse-<version>-linux-x64.tar.gz` after `node scripts/package.mjs <dist>` (memory gate).
2. Capture: `cli-install-npm.txt` and `cli-install-download.txt`, every command with its words and exit code. Exit 0 means each said what it should.
3. `update`: npm against a local registry holding a newer version; the download with `CREWHOUSE_TARBALL=<tarball> crewhouse update` (the swap and restart).
4. The line itself: `bash scripts/verify/install-line.sh <out> <dist>/crewhouse-<version>-linux-x64.tar.gz` (Docker, `ubuntu:24.04`, a plain login at umask 0002, a real pseudo-terminal). Capture `install-line.txt`: each login's words and the seconds from the line to the app answering. Exit 0 means a terminal ended in the running app, the state folder is 700, a 775 one was closed with a line saying so, and no terminal only installed.
5. Failures: `bash scripts/verify/failure-words.sh <out> <dist>/crewhouse-<version>-linux-x64.tar.gz` (Docker, `ubuntu:24.04`, a plain login). Capture `failure-words.txt`: every failure with its cause, one next line, exit code and milliseconds. Exit 0 means each stopped in time with no stack trace or private link, and the line printed for `~/.local` reached a running app.
