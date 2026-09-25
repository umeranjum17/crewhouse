import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const parent = mkdtempSync(join(tmpdir(), 'crewhouse-test-'));
const clean = () => rmSync(parent, { recursive: true, force: true });
process.once('exit', clean);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { clean(); process.kill(process.pid, signal); });
export const temp = (name: string) => {
  const dir = join(parent, name);
  return (awaitlessMkdir(dir));
};
function awaitlessMkdir(dir: string) { return (mkdir(dir), dir); }
import { mkdirSync as mkdir } from 'node:fs';
