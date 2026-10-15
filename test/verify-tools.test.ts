import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { until } from './lab.ts';

const run = (command: string, args: string[], env = process.env) => {
  const child = spawn(command, args, { env, timeout: 12_000, killSignal: 'SIGKILL' });
  let stdout = '', stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const done = once(child, 'close').then(([code]) => ({ code, stdout, stderr }));
  return { child, done };
};

test('screen captures retry standalone failures under errexit', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-screens-'));
  writeFileSync(join(dir, 'chrome-devtools-axi'), `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PROBE/calls"
case "$1" in
  pages) printf 'id,url,selected\\n1,about:blank,true\\n';;
  emulate) if [ ! -e "$PROBE/retried" ]; then touch "$PROBE/retried"; echo 'transient CDP failure'; exit 42; fi;;
  screenshot) touch "$2";;
esac
`, { mode: 0o755 });
  const { child, done } = run('bash', ['scripts/verify/screens.sh', dir, 'probe', 'http://127.0.0.1:12345/'], {
    ...process.env, PATH: `${dir}:${process.env.PATH}`, PROBE: dir,
  });
  try {
    const result = await done;
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /exit 42, attempt 1/);
    assert.equal(readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter((s) => s === 'emulate').length, 5);
    assert.equal(readdirSync(dir).filter((s) => s.endsWith('.png')).length, 4);
  } finally { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});

test('recorder bounds silent peers and settles disconnected requests', { timeout: 45_000 }, async () => {
  for (const mode of ['discovery', 'upgrade', 'start', 'capture-close', 'stop-close', 'stop-silent', 'acknowledged']) {
    const dir = mkdtempSync(join(tmpdir(), 'verify-record-'));
    const server = createServer((req, res) => {
      if (mode === 'discovery') return;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ type: 'page', url: 'http://owned.test/', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/page` }]));
    });
    const sockets = new Set<import('node:net').Socket>();
    server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      if (mode !== 'upgrade') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
    });
    let stopSeen = false;
    wss.on('connection', (ws) => ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.method === 'Page.startScreencast') {
        if (mode === 'start') return;
        ws.send(JSON.stringify({ id: msg.id, result: {} }));
      }
      if (msg.method === 'Page.stopScreencast') {
        stopSeen = true;
        if (mode === 'stop-close') return ws.terminate();
        if (mode === 'stop-silent') return;
        ws.send(JSON.stringify({ id: msg.id, result: {} }));
      }
    }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as import('node:net').AddressInfo).port;
    const { child, done } = run(process.execPath, ['scripts/verify/record.mjs', `http://127.0.0.1:${port}`, 'http://owned.test/', join(dir, 'out.webm')]);
    child.stdout.on('data', (data) => {
      if (!String(data).includes('RECORDING:')) return;
      if (mode === 'capture-close') { for (const ws of wss.clients) ws.terminate(); }
      else child.kill('SIGTERM');
    });
    try {
      const result = await done;
      assert.notEqual(result.code, 0, mode);
      if (mode === 'acknowledged') {
        assert.ok(stopSeen);
        assert.match(result.stderr, /Only 0 frame/);
      } else if (mode === 'discovery') assert.match(result.stderr, /TimeoutError/);
      else if (mode === 'upgrade') assert.match(result.stderr, /timed out|timeout/i);
      else if (mode === 'start' || mode === 'stop-silent') assert.match(result.stderr, /CDP response timed out/);
      else assert.match(result.stderr, /CDP disconnected/);
      assert.deepEqual(readdirSync(dir), [], mode);
    } finally {
      child.kill('SIGKILL');
      for (const ws of wss.clients) ws.terminate();
      for (const socket of sockets) socket.destroy();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// Each driver's teardown is judged on a real crewd. crewd's first git call (a git on PATH
// that then execs the real one) leaves two watchers in crewd's process group, one that
// ignores SIGTERM; a watcher that sees the lab vanish while it still runs writes `survived`.
// A case fails on that, on any member of the group outliving the driver, or on a lab left
// behind. The negative control is the former boundary (TERM to crewd's pid alone, wait for
// it, remove the lab): it must fail the same check.
test('verify drivers empty crewd\'s process group before removing its lab', { timeout: 150_000 }, async () => {
  const own = Number(readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' ')[2]);
  const git = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const alive = (pgid: number) => { try { process.kill(-pgid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; } };
  const exit = (child: ChildProcess) => new Promise<number | string>((resolve) => {
    const timer = setTimeout(() => resolve('no exit within 90s'), 90_000);
    child.once('error', (e) => { clearTimeout(timer); resolve(String(e)); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve(code ?? `killed by ${signal}`); });
  });
  const stub = (out: string) => [process.execPath, 'scripts/verify/stub-drive.mjs', '--out', out];
  const smoke = (out: string) => ['bash', 'scripts/verify/screens-smoke.sh', out];
  const former = () => ['bash', '-c', `LAB=$(mktemp -d -t former.XXXXXX); mkdir -p "$LAB"/home "$LAB"/state "$LAB"/crew "$LAB"/tools "$LAB"/run
env -i PATH="$PATH" HOME="$LAB/home" TMPDIR="$LAB" XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT=0 CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node src/main.ts > /dev/null 2>&1 &
PID=$!
for _ in $(seq 600); do [ ! -e "$FIX/group" ] || break; sleep 0.05; done
kill -TERM "$PID"; wait "$PID"; rm -rf "$LAB"`];
  const session = { CHROME_DEVTOOLS_AXI_SESSION: 'verify-group' };
  const cases: { name: string, argv: (out: string) => string[], code: number | null, says?: RegExp, env?: Record<string, string>,
    inject?: 'hang' | 'throw', term?: 'group' | 'held', before?: (out: string) => void }[] = [
    { name: 'stub-drive pass', argv: stub, code: 0, says: /stub-drive: pass/ },
    { name: 'stub-drive error', argv: stub, code: 1, says: /EISDIR/, before: (out) => mkdirSync(join(out, 'summary.json')) },
    { name: 'stub-drive uncaught exception', argv: stub, code: 1, says: /injected uncaught exception/, inject: 'throw' },
    { name: 'stub-drive SIGTERM', argv: stub, code: 143, says: /stopped by SIGTERM/, inject: 'hang', term: 'group' },
    { name: 'screens-smoke pass', argv: smoke, code: 0, says: /8 captures/, env: session },
    { name: 'screens-smoke error', argv: smoke, code: 1, says: /set to your task-named session/, env: { CHROME_DEVTOOLS_AXI_SESSION: '' } },
    { name: 'screens-smoke SIGTERM', argv: smoke, code: 143, env: session, term: 'held' },
    { name: 'former boundary (negative control)', argv: former, code: null },
  ];
  const drive = async (c: typeof cases[number]) => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-group-'));
    const out = join(dir, 'out'), record = join(dir, 'group');
    mkdirSync(join(dir, 'tmp')); mkdirSync(out);
    writeFileSync(join(dir, 'git'), `#!/usr/bin/env bash
case "\${CREWHOUSE_STATE_DIR:-}" in "${dir}/tmp/"*/state)
  if mkdir "${dir}/started" 2>/dev/null; then
    lab=\${CREWHOUSE_STATE_DIR%/state}
    for resist in no yes; do
      ( [ $resist = no ] || trap '' TERM
        for _ in $(seq 1200); do [ -d "$lab" ] || { echo "$lab" >> "${dir}/survived"; exit; }; sleep 0.05; done ) < /dev/null > /dev/null 2>&1 &
    done
    printf '%s\\n%s\\n' "$(ps -o pgid= -p $$)" "$lab" > "${dir}/group.tmp" && mv "${dir}/group.tmp" "${dir}/group"
  fi;;
esac
exec ${git} "$@"
`, { mode: 0o755 });
    writeFileSync(join(dir, 'chrome-devtools-axi'), `#!/usr/bin/env bash
case "$1" in
  pages) touch "${dir}/held"; for _ in $(seq 1200); do [ -e "${dir}/hold" ] || break; sleep 0.05; done
    printf 'id,url,selected\\n1,about:blank,true\\n';;
  screenshot) touch "$2";;
esac
`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:${process.env.PATH}`, TMPDIR: join(dir, 'tmp'), FIX: dir, ...c.env };
    if (c.inject) {
      // Preloaded into stub-drive: its API calls never answer, and `throw` raises an exception nothing catches.
      writeFileSync(join(dir, 'inject.mjs'), `import { existsSync } from 'node:fs';
globalThis.fetch = () => {
  ${c.inject === 'throw' ? `const t = setInterval(() => { if (existsSync(${JSON.stringify(record)})) { clearInterval(t); throw new Error('injected uncaught exception'); } }, 20);` : ''}
  return new Promise(() => {});
};
`);
      env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(join(dir, 'inject.mjs')).href}`;
    }
    c.before?.(out);
    if (c.term === 'held') writeFileSync(join(dir, 'hold'), '');
    let child: ChildProcess | undefined, group = 0;
    try {
      const [command, ...args] = c.argv(out);
      child = spawn(command, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let said = '';
      child.stdout!.on('data', (d) => { said += d; });
      child.stderr!.on('data', (d) => { said += d; });
      const exited = exit(child);
      if (c.term) {
        await until(`${c.name} running`, () => existsSync(join(dir, c.term!)), 60_000);
        child.kill('SIGTERM');
        rmSync(join(dir, 'hold'), { force: true });
      }
      const code = await exited;
      assert.ok(existsSync(record), `${c.name}: crewd never ran git: ${said}`);
      const [pgid, lab] = readFileSync(record, 'utf8').trim().split('\n');
      group = Number(pgid);
      const found = [
        ...(existsSync(join(dir, 'survived')) ? [`a descendant outlived removal of ${lab}`] : []),
        ...(alive(group) ? [`process group ${group} outlived the driver`] : []),
        ...(existsSync(lab) ? [`${lab} left behind`] : []),
      ];
      if (c.code === null) assert.notDeepEqual(found, [], 'the former cleanup boundary must fail this check');
      else {
        assert.equal(code, c.code, `${c.name}: ${said}`);
        if (c.says) assert.match(said, c.says, c.name);
        assert.match(said, /outlived SIGTERM; sending SIGKILL/, `${c.name} never escalated past the watcher that ignores SIGTERM`);
        assert.deepEqual(found, [], `${c.name}: ${said}`);
      }
    } finally {
      if (!group && existsSync(record)) group = Number(readFileSync(record, 'utf8').trim().split('\n')[0]);
      const owned = [child?.pid ?? 0, group].filter((g) => g && g !== own);
      for (const g of owned) try { process.kill(-g, 'SIGKILL'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
      await until(`${c.name}: its process groups gone`, () => !owned.some(alive), 10_000);
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const failed = (await Promise.allSettled(cases.map(drive))).flatMap((r) => r.status === 'rejected' ? [String(r.reason?.message ?? r.reason)] : []);
  assert.deepEqual(failed, []);
});
