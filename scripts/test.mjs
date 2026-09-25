import { mkdtempSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const prefix = 'crewhouse-test-';
for (const name of readdirSync(tmpdir()).filter((name) => name.startsWith(prefix))) {
  const pid = Number(name.slice(prefix.length).split('-')[0]);
  if (!Number.isInteger(pid) || pid <= 0) continue;
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') rmSync(join(tmpdir(), name), { recursive: true, force: true }); }
}
const root = mkdtempSync(join(tmpdir(), `${prefix}${process.pid}-`));
mkdirSync(join(root, 'home'));
mkdirSync(join(root, 'tmp'));
const scratch = join(root, 'tmp');
const before = new Set(readdirSync(scratch));
const cleanup = () => rmSync(root, { recursive: true, force: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanup(); process.kill(process.pid, signal); });
const files = readdirSync('test').filter((name) => name.endsWith('.test.ts')).map((name) => join('test', name));
const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit', env: { ...process.env, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp') },
});
const leaked = readdirSync(scratch).filter((name) => name.startsWith(prefix) && !before.has(name));
cleanup();
if (leaked.length) { console.error(`Test scratch leaked from ${scratch}:\n${leaked.map((name) => `  ${join(scratch, name)}`).join('\n')}`); process.exitCode = 1; }
if (result.error) throw result.error;
process.exitCode ||= result.status ?? 1;
