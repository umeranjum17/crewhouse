import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const parent = mkdtempSync(join(tmpdir(), 'crewhouse-test-'));
// A browser a test stopped can still be writing its profile for a moment on a slow disk: retry briefly.
const clean = () => rmSync(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
process.once('exit', clean);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { clean(); process.kill(process.pid, signal); });
export const temp = (name: string) => {
  const dir = join(parent, name);
  return (awaitlessMkdir(dir));
};
function awaitlessMkdir(dir: string) { return (mkdir(dir), dir); }
import { mkdirSync as mkdir } from 'node:fs';
