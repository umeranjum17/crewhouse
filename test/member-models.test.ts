// A chat order to Chief -> the member's stored choice (models.json) -> the member's next run uses it. Only the model is scripted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, lastSaid } from './lab.ts';
import type { StubRuntime } from '../src/stub-runtime.ts';

test('"use ChatGPT for Scout" sets one member, refuses a signed-out account, and a limit waits', async () => {
  const { crew, db, cfg } = setup();
  crew.onboard('Umer');
  crew.recruit('scout', 'Scout', 'person');
  const order = async (input: object) => { const { task } = await crew.post('chief', `Please. [tool crew_use ${JSON.stringify(input)}]`) as { task: number }; await settled(db, task); return task; };
  const runKey = (bot: string) => db.get('SELECT session FROM tasks WHERE bot = ? ORDER BY id DESC', bot)!.session;
  const file = () => JSON.parse(readFileSync(join(cfg.crewDir, 'models.json'), 'utf8'));

  await order({ bot: 'scout', account: 'ChatGPT', model: 'quick' });
  assert.deepEqual(file().scout, ['chatgpt:quick-1'], 'the order is the file');
  assert.equal(file().chief, undefined, 'no other member moved');
  assert.match(lastSaid(db, 'chief'), /Scout now thinks with ChatGPT \(Quick 1\)/);

  writeFileSync(join(cfg.crewDir, 'models.json'), JSON.stringify({ ...file(), scout: ['chatgpt:strong-1'] }));
  const run = async (bot: string, text: string) => { const { task } = await crew.post(bot, text) as { task: number }; await settled(db, task); return { task, spec: (crew.runtime as StubRuntime).specOf(runKey(bot))! }; };
  assert.equal((await run('scout', 'hi')).spec.model, 'strong-1', 'a hand edit of the file is the next run\'s model');

  await order({ bot: 'scout', account: 'Grok' });
  assert.match(lastSaid(db, 'chief'), /not signed in to Grok/i, 'a signed-out account is refused in plain words');
  assert.deepEqual(file().scout, ['chatgpt:strong-1'], 'and nothing changed');
  await order({ bot: 'scout', account: 'ChatGPT', model: 'zzz' });
  assert.match(lastSaid(db, 'chief'), /no model like "zzz"/, 'a model the live list lacks is refused');

  const hit = await run('scout', 'hit the limit');
  assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', hit.task)!.state, 'paused', 'a limit waits');
  assert.deepEqual(file().scout, ['chatgpt:strong-1'], 'no move to another account');
});
