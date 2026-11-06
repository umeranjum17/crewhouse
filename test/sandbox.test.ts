// The helpers' sandbox on a stock Ubuntu: the probe says why it fails and names the one command, `doctor` repeats the
// probe word for word, and the install step the .deb runs as root makes the same probe pass. A fake bwrap fails exactly
// as the real one does on Ubuntu 24.04 (captured in a stock VM) until the rule file is in place.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-sandbox-'));
after(() => rmSync(root, { recursive: true, force: true }));
const fake = join(root, 'fake'), apparmor = join(root, 'apparmor');
const rule = join(apparmor, 'etc/apparmor.d/bwrap-userns-restrict');
mkdirSync(fake); mkdirSync(join(apparmor, 'proc/sys/kernel'), { recursive: true }); mkdirSync(join(apparmor, 'etc/apparmor.d'), { recursive: true });
mkdirSync(join(apparmor, 'usr/share/apparmor/extra-profiles'), { recursive: true });
writeFileSync(join(apparmor, 'usr/share/apparmor/extra-profiles/bwrap-userns-restrict'), 'profile bwrap /usr/bin/bwrap {}\n');
const script = (name: string, body: string) => { writeFileSync(join(fake, name), `#!/bin/sh\n${body}\n`); chmodSync(join(fake, name), 0o755); };
script('bwrap', `[ -f ${rule} ] || { echo 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted' >&2; exit 1; }`);
script('apparmor_parser', `echo "$@" >> ${join(root, 'parser.log')}`);
const restrict = (on: boolean) => writeFileSync(join(apparmor, 'proc/sys/kernel/apparmor_restrict_unprivileged_userns'), on ? '1\n' : '0\n');
const env = { ...process.env, PATH: `${fake}:${process.env.PATH}`, CREWHOUSE_APPARMOR_ROOT: apparmor, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools'), CREWHOUSE_ENGINE_DIR: join(root, 'engine'), HOME: join(root, 'home') };
const run = (...args: string[]) => spawnSync(process.execPath, args, { env, encoding: 'utf8', cwd: join(import.meta.dirname, '..') });

test('the sandbox on a stock Ubuntu: the probe names the cause and the command, doctor agrees, the install step fixes it', () => {
  restrict(true);
  const before = run('bin/sandbox.mjs', 'probe');
  assert.match(before.stdout, /still cannot start: Ubuntu's AppArmor stops bubblewrap.*Failed RTM_NEWADDR/);
  assert.match(before.stdout, /Next: sudo install -m 644 \S+bwrap-userns-restrict \S+bwrap-userns-restrict && sudo apparmor_parser -r /);
  const nextBefore = before.stdout.split('Next: ')[1].trim();
  const doctorBefore = run('src/doctor.ts').stdout;
  assert.match(doctorBefore, /no sandbox here: bots work without a shell — Ubuntu's AppArmor stops bubblewrap/);
  assert.ok(doctorBefore.includes(`fix: ${nextBefore}`), `doctor names the probe's command\n${doctorBefore}`);
  // Not a terminal: setup prints the one command and installs nothing.
  const setup = run('bin/sandbox.mjs', 'setup');
  assert.ok(setup.stdout.includes(nextBefore) && !existsSync(rule), setup.stdout);

  assert.equal(run('bin/sandbox.mjs', 'install').status, 0);
  assert.ok(existsSync(rule));
  assert.match(spawnSync('cat', [join(root, 'parser.log')], { encoding: 'utf8' }).stdout, new RegExp(`-r ${rule}`));
  assert.match(run('bin/sandbox.mjs', 'probe').stdout, /works here/);
  assert.match(run('src/doctor.ts').stdout, /✓ Bots' shell runs in a sandbox/);
  assert.equal(run('bin/sandbox.mjs', 'setup').stdout.trim(), '', 'a machine that works hears nothing');
});

test('a refusal that is not Ubuntu\'s rule is said as it is, and a missing bubblewrap names its install', () => {
  rmSync(rule); restrict(false);
  const other = run('bin/sandbox.mjs', 'probe').stdout;
  assert.match(other, /bubblewrap cannot start here \(it said: bwrap: loopback: Failed RTM_NEWADDR/);
  assert.doesNotMatch(other, /AppArmor/);
  assert.equal(run('bin/sandbox.mjs', 'install').status, 0);
  assert.ok(!existsSync(rule), 'where Ubuntu does not restrict it, the rule is left alone');
  const nobwrap = spawnSync(process.execPath, ['bin/sandbox.mjs', 'probe'], { env: { ...env, PATH: '/nonexistent' }, encoding: 'utf8', cwd: join(import.meta.dirname, '..') });
  assert.match(nobwrap.stdout, /bubblewrap is not installed.*sudo apt install bubblewrap/s);
});
