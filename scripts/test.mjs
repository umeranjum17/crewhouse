import { mkdtempSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const prefix = 'crewhouse-test-';
const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith(prefix)));
const root = mkdtempSync(join(tmpdir(), prefix));
mkdirSync(join(root, 'home'));
mkdirSync(join(root, 'tmp'));
const cleanup = () => rmSync(root, { recursive: true, force: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanup(); process.kill(process.pid, signal); });
const files = readdirSync('test').filter((name) => name.endsWith('.test.ts')).map((name) => join('test', name));
const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit', env: { ...process.env, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp') },
});
cleanup();
const leaked = readdirSync(tmpdir()).filter((name) => name.startsWith(prefix) && !before.has(name));
if (leaked.length) { console.error(`Test scratch leaked from ${tmpdir()}:\n${leaked.map((name) => `  ${join(tmpdir(), name)}`).join('\n')}`); process.exitCode = 1; }
if (result.error) throw result.error;
process.exitCode ||= result.status ?? 1;
