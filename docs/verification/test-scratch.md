# Test CLI scratch ownership and nested sockets

Backend-only: no screen, browser capture, model call or credentials. The product here is
`npm test` / `./crewhouse test`, both using `scripts/test.mjs`. Drive each command below as
`done-done run -- '<command> > "$DONE_DONE_EVIDENCE_ROOT/<leg>.log" 2>&1'`: done-done joins
the words after `--` into one shell line, so the command and its redirect stay one argument.

- Run `node --test test/test-runner.test.ts` with HOME/XDG isolated and TMPDIR on owned
  physical disk. It launches the actual CLI against a private fixture project with a deep
  multibyte TMPDIR, binds both Chromium's transient socket pattern and the deeper firstwords
  bridge pattern, budgets the kernel's maximum PID width and NUL byte, preserves a synthetic
  stale root, and witnesses exclusive allocation and refusal to clean a replaced root.
- Drive `test/firstwords.test.ts` through the real test CLI as well (`npm test -- --group=engine`
  includes it; `./crewhouse test` runs everything). The existing scripted-provider journey
  must complete all four real engine turns; a source-only path calculation is not proof.
- On Linux, a task-private user/mount namespace can bind an owned disk fixture over `/tmp`.
  A subordinate UID can create a synthetic foreign-owned directory there, without chmod or
  chown. With DAC override/read-search capabilities dropped, witness that the CLI leaves
  unrelated and foreign stale roots intact and `testRoot` refuses a non-sticky foreign
  parent. Never perform this experiment against the host's shared `/tmp` or foreign roots.
- Retain actual socket bind paths and byte lengths including NUL, `/proc/sys/kernel/pid_max`,
  root UID/mode/device/inode and child exits. The pinned bridge currently binds `bridge.sock`
  directly (zero staged suffix); Chromium's `org.chromium.Chromium.XXXXXX/SingletonSocket`
  includes its transient directory. Recheck these names when changing the pin or fixtures.
- Wait for every owned child to exit before removing only the roots allocated by this run.
  There is no stale-PID sweep: a name or a dead PID is never deletion authority.

The runner canonicalizes TMPDIR and, if necessary, chooses a short physical ancestor.
It accepts an owned non-group/world-writable parent or a sticky temporary parent owned
by the current UID or root, then allocates a new mode-0700 root atomically. It never
falls across to a hard-coded `/tmp`. The short `c-<pid>-XXXXXX` root and `h` HOME also
keep the existing helper prompt budgets intact; templates and size assertions are unchanged.
