// CREWHOUSE_ENGINE=pi end to end: the real Crew, one real pinned Pi per bot through the kit, a scripted model on loopback. No account, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { temp } from './tmp.ts';

// Set before anything asks: this is a stand-in person, so a plain `node --test` never comes near the real ~/.pi.
const person = temp('pi-person');
process.env.HOME = person;
const { lastSaid, setup, task, until } = await import('./lab.ts');
const { holding, release, startModelStub } = await import('./openclaw-stub.ts');
const { remember } = await import('../src/bots.ts');

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
  assert.match(JSON.stringify(call.body.messages), /no tools at all/, 'and the prompt that names tools says so');

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

/** The Pis this process runs, by the folder each works in: Pi renames itself, so its command line says nothing. */
const pis = (parent = process.pid) => Object.fromEntries(readdirSync('/proc').filter((p) => /^\d+$/.test(p)).flatMap((pid) => {
  try {
    if (Number(readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ')[1]) !== parent || readFileSync(`/proc/${pid}/comm`, 'utf8').trim() !== 'pi-rpc') return [];
    return [[readlinkSync(`/proc/${pid}/cwd`), { pid: Number(pid), home: /(?:^|\0)HOME=([^\0]*)/.exec(readFileSync(`/proc/${pid}/environ`, 'utf8'))?.[1] }]];
  } catch { return []; } // gone between the listing and the read
}));

test('helpers run on Pi side by side: each its own process, memory and session; an idle one has no process; one crash stops only itself', { skip, timeout: 180_000 }, async () => {
  process.env.CREWHOUSE_PI_IDLE_MS = '300';
  after(() => { delete process.env.CREWHOUSE_PI_IDLE_MS; });
  const model = await startModelStub();
  after(() => model.close());
  const s = setup(3, { engine: 'pi', engineProvider: { baseUrl: model.url, apiKey: 'lab-key' } });
  s.crew.onboard('Umer');
  const [a, b, quiet] = ['scout', 'scribe', 'reel'].map((t) => s.crew.recruit(t, undefined, 'person').id);
  const home = (bot: string) => join(s.cfg.stateDir, 'pi', bot), work = (bot: string) => join(home(bot), 'work');
  const callsOf = (bot: string) => model.calls.filter((c) => JSON.stringify(c.body.messages).includes(`Your id in Crewhouse is ${bot}.`)).map((c) => JSON.stringify(c.body.messages));
  const sessionsOf = (bot: string) => readdirSync(join(work(bot), 'sessions')).map((f) => readFileSync(join(work(bot), 'sessions', f), 'utf8')).join('');
  const ask = async (bot: string, text: string): Promise<number> => (await s.crew.post(bot, text) as { task: number }).task;
  const ended = (t: number) => until(`job ${t} on Pi`, () => !['queued', 'working'].includes(task(s.db, t).state), 60_000);

  // What belongs to one helper: its notes, a file in its folder, and an extension its list does not name.
  remember(s.cfg, { bot: a }, 'Umer calls this helper Mango');
  remember(s.cfg, { bot: b }, 'Umer calls this helper Papaya');
  mkdirSync(work(a), { recursive: true });
  writeFileSync(join(work(a), 'AGENTS.md'), 'A file only in the first folder: Lychee');
  mkdirSync(join(home(a), 'extensions'));
  writeFileSync(join(home(a), 'extensions', 'canary.ts'), 'throw new Error("CANARY extension loaded");');

  const [one, two] = await Promise.all([ask(a, 'ask permission as one'), ask(b, 'ask permission as two')]);
  await until('both helpers mid-turn', () => holding('one') && holding('two'), 60_000);
  const both = pis();
  assert.deepEqual(Object.keys(both).sort(), [work(a), work(b)].sort(), 'one Pi for each asked helper, and none for anyone else');
  assert.notEqual(both[work(a)].pid, both[work(b)].pid);
  assert.equal(both[work(a)].home, home(a));
  assert.equal(both[work(b)].home, home(b));
  assert.equal(existsSync(home(quiet)), false, 'a helper nobody asked has no Pi and no Pi folder');
  assert.equal(existsSync(home('chief')), false, 'nor has Chief');

  release('two', 'Papaya answered'); // the second answers first: neither waits for the other
  await ended(two);
  assert.equal(task(s.db, one).state, 'working');
  release('one', 'Mango answered');
  await ended(one);
  assert.deepEqual([task(s.db, one).state, task(s.db, two).state], ['done', 'done']);
  assert.deepEqual([lastSaid(s.db, a), lastSaid(s.db, b)], ['Mango answered', 'Papaya answered'], 'each answer is in its own chat');

  await until('both Pis stopped once idle', () => Object.keys(pis()).length === 0);
  // Asked the moment the process is gone: the kit has yet to report that stop, and the new job must not take it for its own.
  const [first, second] = await Promise.all([ask(a, 'What did I ask you?'), ask(b, 'What did I ask you?')]);
  await Promise.all([ended(first), ended(second)]);
  assert.deepEqual([task(s.db, first).state, task(s.db, second).state], ['done', 'done']);
  assert.match(callsOf(a).at(-1)!, /Mango answered/, 'a stopped Pi picks its own session back up');
  assert.match(callsOf(b).at(-1)!, /Papaya answered/);
  for (const call of callsOf(a)) { assert.match(call, /Mango/); assert.match(call, /Lychee/); assert.doesNotMatch(call, /Papaya/); }
  for (const call of callsOf(b)) { assert.match(call, /Papaya/); assert.doesNotMatch(call, /Mango|Lychee/); }
  assert.doesNotMatch(sessionsOf(a), /Papaya/);
  assert.doesNotMatch(sessionsOf(b), /Mango|Lychee/);

  // One Pi killed mid-turn: its job fails in plain words, the other carries on, and the next message picks the session back up.
  const [lost, kept] = await Promise.all([ask(a, 'ask permission as lost'), ask(b, 'ask permission as kept')]);
  await until('both helpers mid-turn again', () => holding('lost') && holding('kept'), 60_000);
  const survivor = pis()[work(b)].pid;
  process.kill(pis()[work(a)].pid, 'SIGKILL');
  await ended(lost);
  assert.equal(task(s.db, lost).state, 'failed');
  assert.doesNotMatch(lastSaid(s.db, a) ?? '', /pi-rpc|SIGKILL|exit/i);
  assert.equal(task(s.db, kept).state, 'working');
  assert.equal(pis()[work(b)].pid, survivor, 'the other Pi was not touched');
  release('kept', 'Papaya carried on');
  await ended(kept);
  assert.equal(task(s.db, kept).state, 'done');
  assert.equal(lastSaid(s.db, b), 'Papaya carried on');
  const again = await ask(a, 'Back again');
  await ended(again);
  assert.equal(task(s.db, again).state, 'done');
  assert.match(callsOf(a).at(-1)!, /Mango answered/);
  assert.equal(readdirSync(join(work(a), 'sessions')).length, 1, 'one helper, one session, across a stop and a crash');

  await s.crew.stop();
  await until('no Pi outlives crewd', () => Object.keys(pis()).length === 0);
  s.done();
});

test('crewd killed with two helpers mid-turn: no Pi is left behind, and both jobs finish after the restart', { skip, timeout: 120_000 }, async () => {
  const model = await startModelStub();
  after(() => model.close());
  const root = temp('pi-restart'), port = await new Promise<number>((r) => { const l = createServer().listen(0, '127.0.0.1', () => { const { port } = l.address() as AddressInfo; l.close(() => r(port)); }); });
  const env = { ...process.env, CREWHOUSE_ENGINE: 'pi', CREWHOUSE_ENGINE_BASE_URL: model.url, CREWHOUSE_ENGINE_API_KEY: 'lab-key', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') };
  let daemon: ChildProcess;
  const start = () => { daemon = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], { env, stdio: ['ignore', 'ignore', 'inherit'] }); };
  after(() => daemon.kill());
  const api = async (path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8')}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined })).json();
  const up = () => until('crewd up', () => api('/api/state').then((s) => s.person, () => false), 30_000);
  start();
  await up();
  await api('/api/onboard', { address: 'Umer' });
  const [a, b] = [(await api('/api/recruit', { template: 'scout' })).id, (await api('/api/recruit', { template: 'scribe' })).id];
  await Promise.all([api(`/api/bots/${a}/messages`, { text: 'ask permission as crash-one' }), api(`/api/bots/${b}/messages`, { text: 'ask permission as crash-two' })]);
  await until('both helpers mid-turn', () => holding('crash-one') && holding('crash-two'), 60_000);
  const pids = Object.values(pis(daemon!.pid)).map((p) => p.pid);
  assert.equal(pids.length, 2);

  daemon!.kill('SIGKILL');
  await new Promise((r) => daemon.once('exit', r));
  await until('no Pi outlives a killed crewd', () => !pids.some((pid) => existsSync(`/proc/${pid}`)));
  start();
  await up();
  for (const bot of [a, b]) await until(`${bot} finishes after the restart`, async () => (await api(`/api/bots/${bot}`)).tasks.find((t: any) => t.state === 'done'), 60_000);
  for (const bot of [a, b]) assert.equal(readdirSync(join(root, 'state', 'pi', bot, 'work', 'sessions')).length, 1, 'the same session carried on');
});
