// CREWHOUSE_ENGINE=pi end to end: the real Crew, the real pinned Pi through the kit, a scripted model on loopback. No account, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temp } from './tmp.ts';

// Set before anything asks: this is a stand-in person, so a plain `node --test` never comes near the real ~/.pi.
const person = temp('pi-person');
process.env.HOME = person;
const { lastSaid, setup, task, until } = await import('./lab.ts');
const { startModelStub } = await import('./openclaw-stub.ts');

const built = existsSync(join(import.meta.dirname, '..', 'runtime', 'byokit', 'packages', 'pi', 'dist', 'index.js'));
const skip = !built && !process.env.CI ? 'run node scripts/prepare-pi.mjs first' : false; // CI prepares it, so CI never skips

const treeHash = (dir: string) => {
  const hash = createHash('sha256');
  for (const f of readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) { hash.update(f); const p = join(dir, f); if (existsSync(p) && !readdirSafe(p)) hash.update(readFileSync(p)); }
  return hash.digest('hex');
};
const readdirSafe = (p: string) => { try { return readdirSync(p); } catch { return null; } };

test('a bot answers on Pi, can run nothing, and the person\'s own Pi hashes the same', { skip, timeout: 120_000 }, async () => {
  const own = join(person, '.pi', 'agent');
  mkdirSync(join(own, 'extensions'), { recursive: true });
  writeFileSync(join(own, 'auth.json'), '{"canary":{"type":"api_key","key":"CANARY-KEY"}}');
  writeFileSync(join(own, 'settings.json'), '{"defaultModel":"canary-model"}');
  writeFileSync(join(own, 'models.json'), '{"providers":{"canary":{"baseUrl":"http://127.0.0.1:9/v1","api":"openai-completions","apiKey":"CANARY-KEY","models":[{"id":"canary-model"}]}}}');
  writeFileSync(join(own, 'extensions', 'canary.ts'), 'throw new Error("CANARY extension loaded");');
  const before = treeHash(join(person, '.pi'));

  const model = await startModelStub();
  after(() => model.close());
  const s = setup(3, { engine: 'pi', engineProvider: { baseUrl: model.url, apiKey: 'lab-key-never-on-disk' } });
  s.crew.onboard('Umer');
  const ended = (t: number) => until(`job ${t} on Pi`, () => !['queued', 'working'].includes(task(s.db, t).state), 90_000);
  const first = s.crew.requestChief('Good morning').task;
  await ended(first);
  assert.equal(task(s.db, first).state, 'done');
  assert.match(lastSaid(s.db, 'chief'), /stub chief: done with "The person says: Good morning"/, "Chief's own prompt reached Pi, and his answer reached the chat");
  const call = model.calls.at(-1)!;
  assert.match(JSON.stringify(call.body.messages), /Your id in Crewhouse is chief\./);
  assert.equal(call.authorization, 'Bearer lab-key-never-on-disk');
  assert.deepEqual(call.body.tools ?? [], [], 'Pi offers the model no tool');

  // A model that calls a tool anyway changes nothing: Pi was left none to run. The next job is the bot's next session.
  const canary = join(s.root, 'written-by-pi.txt'), said = model.calls.length;
  await ended(s.crew.requestChief(`[tool write {"path": ${JSON.stringify(canary)}, "content": "x"}]`).task);
  assert.ok(model.calls.length > said, 'the model was asked');
  assert.equal(existsSync(canary), false, 'the write never ran');

  const home = join(s.cfg.stateDir, 'pi', 'chief');
  assert.equal(readdirSync(join(home, 'work', 'sessions')).length, 2);
  assert.equal(readdirSync(home, { recursive: true, encoding: 'utf8' }).some((f) => { const p = join(home, f); return !readdirSafe(p) && readFileSync(p, 'utf8').includes('lab-key-never-on-disk'); }), false, 'the key stays off the disk');
  s.done();
  assert.equal(treeHash(join(person, '.pi')), before, "the person's own Pi folder is byte for byte the same");
});
