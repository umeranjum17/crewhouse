// A chat order to Chief -> the member's stored choice (models.json) -> the member's next run uses it. Only the model is scripted.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, lastSaid } from './lab.ts';
import type { StubRuntime } from '../src/stub-runtime.ts';
import type { AddressInfo } from 'node:net';
import { startServer } from '../src/server.ts';
import * as A from '../web/src/adapter.ts';

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

// The screens' side of the same map: Settings or a member's page picks over HTTP, the app's row reads it back, Chief's
// roster says it, and the member's next run uses it; a chat order shows on the row the same way.
test('a pick on the screen is the file, the row, Chief\'s roster and the next run', async () => {
  const { crew, db, cfg } = setup();
  cfg.port = 0; cfg.linkPort = 0;
  crew.onboard('Umer');
  crew.recruit('scout', 'Scout', 'person');
  const server = await startServer(cfg, db, crew), base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  after(() => server.close());
  const api = async (method: string, path: string, body?: object) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}` }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const row = async (id: string) => { const [state, accounts, list] = await Promise.all(['/api/state', '/api/accounts', '/api/accounts/1/chatgpt/model'].map(async (p) => (await api('GET', p)).body));
    return A.memberAi(state, accounts, id, { chatgpt: list.models }); };
  const file = () => JSON.parse(readFileSync(join(cfg.crewDir, 'models.json'), 'utf8'));

  crew.pickModel('chatgpt', 'strong-1');
  assert.deepEqual(file().scout, ['chatgpt:strong-1']);
  assert.equal((await api('PUT', '/api/accounts/1/chatgpt/model', { model: 'quick-1', bot: 'scout' })).status, 200);
  assert.deepEqual(file().scout, ['chatgpt:quick-1'], 'the screen\'s pick is the file');
  assert.deepEqual(file().chief, ['chatgpt:strong-1'], 'and no other member moved');
  const r = await row('scout');
  assert.equal(r.says, 'ChatGPT · Quick 1', 'the row names the account and the live list\'s model');
  assert.ok(r.choices.every((a) => a.key !== 'grok'), 'only signed-in accounts are offered');
  assert.equal((await row('chief')).says, 'ChatGPT · Strong 1');
  assert.equal((await api('PUT', '/api/accounts/1/chatgpt/model', { model: 'zzz', bot: 'scout' })).status, 400, 'a model off the live list is refused');
  assert.equal((await api('PUT', '/api/accounts/1/chatgpt/model', { model: 'quick-1', bot: 'nobody' })).status, 404, 'so is a member who is not on the crew');

  const { task: ask } = await crew.post('chief', 'Who uses what? [tool crew_roster {}]') as { task: number }; await settled(db, ask);
  assert.match((crew.runtime as StubRuntime).transcript(db.get('SELECT session FROM tasks WHERE id = ?', ask)!.session), /"id":"scout"[^}]*"thinks_with":"chatgpt:quick-1"/, 'Chief reads the same line');
  const { task } = await crew.post('scout', 'hi') as { task: number }; await settled(db, task);
  const key = db.get('SELECT session FROM tasks WHERE id = ?', task)!.session;
  assert.equal((crew.runtime as StubRuntime).specOf(key)!.model, 'quick-1', 'the next run uses it');

  const { task: order } = await crew.post('chief', `Please. [tool crew_use ${JSON.stringify({ bot: 'scout', account: 'ChatGPT', model: 'strong' })}]`) as { task: number }; await settled(db, order);
  assert.equal((await row('scout')).says, 'ChatGPT · Strong 1', 'a chat order shows on the row');
  const { task: hit } = await crew.post('scout', 'hit the limit') as { task: number }; await settled(db, hit);
  assert.match((await row('scout')).waits, /^Waiting for your ChatGPT limit to reset at .+\. It won't move to another account by itself\.$/, 'a limit waits, in one calm line');
  assert.deepEqual(file().scout, ['chatgpt:strong-1'], 'and nothing moved');
  writeFileSync(join(cfg.crewDir, 'models.json'), JSON.stringify({ chief: file().chief }));
  assert.equal((await row('scout')).says, 'Not chosen', 'a member with no line says so, never a default');
});
