// The install line as it really runs: install.sh piped to sh, in a real pseudo-terminal or none, at a default Ubuntu login's
// umask, in a throwaway HOME. The download is a stand-in whose crewhouse command records how it was called;
// scripts/verify/install-line.sh runs the same line on the real download.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temp } from './tmp.ts';

const repo = join(import.meta.dirname, '..'), line = join(repo, 'install.sh');
let machines = 0;
function machine() {
  const root = temp(`install-line-${++machines}`), home = join(root, 'home'), pack = join(root, 'pack/crewhouse'), called = join(root, 'called');
  mkdirSync(home); mkdirSync(join(pack, 'app/bin'), { recursive: true }); mkdirSync(join(pack, 'node/bin'), { recursive: true });
  symlinkSync(process.execPath, join(pack, 'node/bin/node'));
  writeFileSync(join(pack, 'app/package.json'), '{"version":"9.9.9"}');
  writeFileSync(join(pack, 'app/bin/crewhouse.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(called)}, JSON.stringify({ args: process.argv.slice(2), terminal: process.stdin.isTTY === true }));\nconsole.log('Crewhouse is running');\n`);
  const tarball = join(root, 'crewhouse.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', tarball, '-C', join(root, 'pack'), 'crewhouse']).status, 0);
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: root, CREWHOUSE_TARBALL: tarball };
  /** `cat install.sh | sh` at umask 0002, as `curl … | sh` runs it; `script` gives it a real terminal, or it has none. */
  const run = (terminal: boolean, extra: NodeJS.ProcessEnv = {}) => {
    const cmd = `umask 0002; cat ${JSON.stringify(line)} | sh`;
    const r = terminal ? spawnSync('script', ['-qec', cmd, '/dev/null'], { env: { ...env, ...extra }, encoding: 'utf8' }) : spawnSync('sh', ['-c', cmd], { env: { ...env, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const mode = (path: string) => (statSync(join(home, path)).mode & 0o777).toString(8);
  return { root, home, called, run, mode };
}

test('in a terminal the line ends in the app: started by its full path with the terminal as input, the state folder private', { timeout: 60_000 }, () => {
  const m = machine(), { code, out } = m.run(true);
  assert.equal(code, 0, out);
  assert.match(out, /Crewhouse 9\.9\.9 is installed/);
  assert.match(out, /open a new terminal, or use the full path: .*\/\.local\/bin\/crewhouse/);
  assert.match(out, /Crewhouse is running/);
  assert.doesNotMatch(out, /Start it with/);
  assert.deepEqual(JSON.parse(readFileSync(m.called, 'utf8')), { args: ['start'], terminal: true });
  assert.equal(m.mode('.local/state'), '700');
  assert.equal(m.mode('.local/state/crewhouse'), '700');
});

test('with no terminal it only installs, and says how to start', { timeout: 60_000 }, () => {
  const m = machine(), { code, out } = m.run(false);
  assert.equal(code, 0, out);
  assert.match(out, /Start it with: crewhouse start/);
  assert.ok(!existsSync(m.called), 'nothing started by itself');
  assert.equal(m.mode('.local/state'), '700');
});

test('an open state folder is closed with a line saying how to undo it, and a shared-read one is left alone', { timeout: 60_000 }, () => {
  const open = machine(), kept = join(open.home, '.local/state/other-app/history');
  mkdirSync(join(open.home, '.local/state/other-app'), { recursive: true }); writeFileSync(kept, 'theirs');
  chmodSync(join(open.home, '.local/state'), 0o775);
  const { code, out } = open.run(false);
  assert.equal(code, 0, out);
  assert.equal(open.mode('.local/state'), '700');
  assert.match(out, /Only you can write to .*\/\.local\/state now\. It was 775; chmod 775 .*\/\.local\/state puts it back\./);
  assert.equal(readFileSync(kept, 'utf8'), 'theirs');

  const shared = machine();
  mkdirSync(join(shared.home, '.local/state'), { recursive: true }); chmodSync(join(shared.home, '.local/state'), 0o755);
  const again = shared.run(false);
  assert.equal(shared.mode('.local/state'), '755');
  assert.doesNotMatch(again.out, /Only you can write to .*\.local\/state now/);
});

test('crewhouse update stays as it was: no start, no new command, no folder touched', { timeout: 60_000 }, () => {
  const m = machine();
  mkdirSync(join(m.home, '.local/state'), { recursive: true }); chmodSync(join(m.home, '.local/state'), 0o775);
  const { code, out } = m.run(true, { CREWHOUSE_UPDATING: '1' });
  assert.equal(code, 0, out);
  assert.ok(!existsSync(m.called));
  assert.ok(!existsSync(join(m.home, '.local/bin/crewhouse')));
  assert.equal(m.mode('.local/state'), '775');
});

test('a download cut off part-way runs nothing', { timeout: 60_000 }, () => {
  const m = machine(), text = readFileSync(line, 'utf8');
  const r = spawnSync('sh', { input: text.slice(0, text.indexOf('main "$@"') - 200), env: { HOME: m.home, PATH: '/usr/bin:/bin', CREWHOUSE_TARBALL: join(m.root, 'crewhouse.tar.gz') }, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /Downloading/);
  assert.ok(!existsSync(join(m.home, '.local')), 'nothing was made');
});
