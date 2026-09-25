// Shared test setup: a Crew on a temp data dir, running the real engine on the stub model. No network, no quota.
import { after } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-lab-'));
process.env.CREWHOUSE_STATE_DIR ??= join(root, 'state'); // the engine's own folder is set once, at import
process.env.CREWHOUSE_HOLD_MS ??= '300';
process.env.CREWHOUSE_STUCK_MS ??= '5000';
process.env.CREWHOUSE_SIGNIN_MS ??= '1500';
const { Store } = await import('../src/db.ts');
const { Crew } = await import('../src/crew.ts');
const { loadConfig } = await import('../src/config.ts');
const stub = await import('../src/stub.ts');

export type Lab = ReturnType<typeof setup>;
let n = 0;
export function setup(maxConcurrent = 3) {
  const dir = join(root, `lab-${++n}`);
  const cfg = { ...loadConfig(), stateDir: join(dir, 'state'), crewDir: join(dir, 'crew'), toolsDir: join(dir, 'tools'), maxConcurrent, engine: 'stub' as const };
  const db = new Store(cfg.stateDir);
  const crew = new Crew(cfg, db);
  crew.init();
  let closed = false;
  const done = () => { if (!closed) { closed = true; crew.stop(); db.close(); } };
  after(done); // a failed assertion must not leave the clock running
  return { root: dir, cfg, db, crew, done };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const task = (db: any, id: number) => db.get('SELECT * FROM tasks WHERE id = ?', id);
const prompts = (db: any, t: number) => db.all("SELECT * FROM events WHERE kind = 'run.prompted' AND json_extract(data, '$.task') = ?", t).length;
/** Wait for the condition, never a fixed time: CI runs the test files side by side on slow disks and two cores. */
export async function until(what: string, fn: () => unknown, ms = 10_000) {
  for (const end = Date.now() + ms; !(await fn()); await sleep(10)) if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
}
/** The engine has the task's prompt (the nth one, after a resume or a switch). */
export const prompted = (db: any, t: number, n = 1) => until(`task #${t} prompted`, () => prompts(db, t) >= n);
/** The task is past queued and working: done, failed, paused or waiting on the person. */
export const settled = (db: any, t: number) => until(`task #${t} settled`, () => !['queued', 'working'].includes(task(db, t).state));
/** The stub model is holding the bot's turn ("ask permission"). */
export const holding = (crew: any, bot: string) => until(`${bot} holding`, () => { const s = crew.sessionOf(bot); return s && stub.holding(s.sessionId); });
/** Finish a held turn with this reply, as the model would. */
export async function release(crew: any, bot: string, reply?: string) {
  await holding(crew, bot);
  stub.release(crew.sessionOf(bot).sessionId, reply);
}
export const lastSaid = (db: any, bot: string) => db.get("SELECT text FROM messages WHERE bot = ? AND author = 'bot' ORDER BY id DESC", bot)?.text;
