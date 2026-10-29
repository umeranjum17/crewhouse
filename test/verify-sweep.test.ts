import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { until } from './lab.ts';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pidsOf = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map(Number);

// A driver that started crewd's group, a detached engine (a group of its own, like the OpenClaw gateway), and an Xvfb stand-in
// and a film outside crewd_start. SIGTERM must leave no lab and no live member of the run. With `stubborn`, the engine ignores
// TERM and `kill -KILL` is made a no-op, so the lab must stay and the driver must end non-zero, saying so on stderr.
const drive = async (stubborn: boolean) => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-sweep-'));
  const pids = join(dir, 'pids');
  const script = `set -euo pipefail
. scripts/verify/crewd-group.sh
${stubborn ? 'kill() { case "$1" in -KILL|-9) return 0;; esac; builtin kill "$@"; }' : ''}
LAB=$(mktemp -d "${dir}/lab.XXXXXX")
trap 'crewhouse_remove_lab "$LAB"' EXIT
printf '%s\\n' "$LAB" > "${dir}/lab"
mkdir -p "$LAB"/{home,tmp}
crewd_start "$PWD" "$LAB/crewd.log" env HOME="$LAB/home" TMPDIR="$LAB" bash -c '
  setsid bash -c "${stubborn ? 'trap \\"\\" TERM;' : ''} echo \\$\\$ >> ${pids}; exec sleep 60" &
  sleep 61 & echo $! >> ${pids}; wait'
XAUTHORITY="$LAB/film" sleep 62 & echo $! >> "${pids}"
for _ in $(seq 100); do [ "$(wc -l < "${pids}")" -ge 3 ] && break; sleep 0.05; done
printf '%s\\n' "$CREWD" > "${dir}/group"
touch "${dir}/ready"
XAUTHORITY="$LAB/hold" sleep 100 & wait $!`;
  const child = spawn('bash', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  child.stdout.on('data', (d) => { said += d; });
  child.stderr.on('data', (d) => { said += d; });
  const closed = once(child, 'exit');
  try {
    await until('driver has started its processes', () => existsSync(join(dir, 'ready')), 20_000);
    const members = pidsOf(pids), lab = readFileSync(join(dir, 'lab'), 'utf8').trim(), group = Number(readFileSync(join(dir, 'group'), 'utf8'));
    assert.equal(members.length, 3, said);
    child.kill('SIGTERM');
    const [code] = await closed;
    return { code, said, lab, members, group, alive: members.filter(alive), left: existsSync(lab) };
  } finally {
    child.kill('SIGKILL');
    try { for (const p of existsSync(pids) ? pidsOf(pids) : []) if (alive(p)) process.kill(p, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
};

test('a driver stopped by SIGTERM leaves no lab and no surviving process', { timeout: 30_000 }, async () => {
  const r = await drive(false);
  assert.equal(r.code, 143, r.said);
  assert.deepEqual(r.alive, [], `survivors: ${r.said}`);
  assert.throws(() => process.kill(-r.group, 0), { code: 'ESRCH' }, `process group ${r.group} survived`);
  assert.equal(r.left, false, `${r.lab} left behind: ${r.said}`);
});

test('a process that cannot be stopped keeps the lab and fails the driver loudly', { timeout: 40_000 }, async () => {
  const r = await drive(true);
  assert.notEqual(r.code, 0, r.said);
  assert.match(r.said, /FAILED: .* left behind/, r.said);
  assert.match(r.said, /outlived SIGKILL/, r.said);
});
