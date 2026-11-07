// CREWHOUSE_ENGINE=pi end to end: the real Crew, one real pinned Pi per bot through the kit, a scripted model on loopback. No account, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createHttp, request as ask } from 'node:http';
import { createServer as createSecure, globalAgent } from 'node:https';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { temp } from './tmp.ts';

// Set before anything asks: this is a stand-in person, so a plain `node --test` never comes near the real ~/.pi.
const person = temp('pi-person');
process.env.HOME = person;
const { lastSaid, setup, task, until } = await import('./lab.ts');
const { holding, release, startModelStub } = await import('./openclaw-stub.ts');
const { patchConfig, remember } = await import('../src/bots.ts');
const { MODEL_URL, openDoor } = await import('../bin/pi-door.mjs');
const { bus, piBuiltIn, piRoom, piWall } = await import('../bin/sandbox.mjs');

const built = existsSync(join(import.meta.dirname, '..', 'runtime', 'byokit', 'packages', 'pi', 'dist', 'index.js'));
const skip = !built && !process.env.CI ? 'run node scripts/prepare-pi.mjs first' : false; // CI prepares it, so CI never skips

const treeHash = (dir: string) => {
  const hash = createHash('sha256');
  for (const f of readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) { hash.update(f); const p = join(dir, f); if (existsSync(p) && !readdirSafe(p)) hash.update(readFileSync(p)); }
  return hash.digest('hex');
};
const readdirSafe = (p: string) => { try { return readdirSync(p); } catch { return null; } };
/** The tools a model request offered, by name: what the bot could call on that turn, as the model saw it. */
const names = (call: { body: any }) => (call.body.tools ?? []).map((t: any) => t.function?.name).sort();
/** The notes a model request showed the bot, from the system prompt, or nothing when it showed none. */
const savedNotes = (call: { body: any }) => /Your saved notes[^\n]*\n([^]*)$/.exec(call.body.messages.find((m: any) => m.role === 'system')?.content ?? '')?.[1];

test('a bot answers on Pi with only the default extension, can write nothing, and the person\'s own Pi hashes the same', { skip, timeout: 120_000 }, async () => {
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
  assert.deepEqual(names(call), ['notes', 'todo'], "Pi offers the model the default set and none of Pi's own tools");
  assert.match(JSON.stringify(call.body.messages), /only these tools: todo, notes/, 'and the prompt that names other tools says so');

  // A model that calls one of Pi's own tools anyway changes nothing: Pi was left none to run. The next job is the bot's next session.
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

test('a person signs in on Pi with a pasted key and a bot answers on it: a wrong key is refused in plain words, the right one is sealed off Pi\'s disk, a waiting job starts, signing out stops the door', { skip, timeout: 120_000 }, async () => {
  const own = join(person, '.pi'), before = existsSync(own) ? treeHash(own) : '';
  const model = await startModelStub(), good = 'sk-lab-good-key-9f3a';
  // The provider refuses every key but one, as a real one does, and passes the rest on to the scripted model.
  const provider = createHttp((req, res) => {
    if (req.headers.authorization !== `Bearer ${good}`) { res.writeHead(401, { 'content-type': 'application/json' }); req.resume(); return void res.end('{"error":{"message":"Invalid API key"}}'); }
    const up = ask(new URL(req.url!, model.url), { method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    req.pipe(up);
  });
  await new Promise<void>((r) => provider.listen(0, '127.0.0.1', r));
  process.env.CREWHOUSE_PI_ROUTE_BASE = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
  after(() => { delete process.env.CREWHOUSE_PI_ROUTE_BASE; provider.close(); model.close(); });
  const s = setup(3, { engine: 'pi' });
  s.crew.onboard('Umer');
  const waiting = s.crew.requestChief('Good morning').task;
  await until('the job waits for a sign-in', () => task(s.db, waiting).state === 'paused');
  assert.equal(model.calls.length, 0, 'nothing is asked of any model before the person signs in');

  const card = await s.crew.accounts.login('minimax', 'key');
  assert.equal(card?.state, 'waiting'); assert.equal(card?.via, 'key');
  await s.crew.accounts.paste('minimax', 'sk-lab-wrong');
  assert.equal(s.crew.accounts.view('minimax')?.state, 'waiting', 'a refused key leaves the card open');
  assert.match(String(s.crew.accounts.view('minimax')?.error), /That key didn't work/);
  assert.equal(await s.crew.accounts.signedIn('minimax'), false);
  await s.crew.accounts.paste('minimax', ` ${good}\n`);
  assert.equal(s.crew.accounts.view('minimax')?.state, 'done');
  assert.equal(await s.crew.accounts.signedIn('minimax'), true);
  assert.deepEqual((await s.crew.runtime.models('minimax')).filter((m) => m.dflt).map((m) => m.id), ['MiniMax-M3.1-Flash'], 'the account comes with its default model');

  await until('the waiting job answers on the new account', () => !['queued', 'working', 'paused'].includes(task(s.db, waiting).state), 90_000);
  assert.equal(task(s.db, waiting).state, 'done');
  assert.match(lastSaid(s.db, 'chief'), /stub chief: done with "The person says: Good morning"/);
  const call = model.calls.at(-1)!;
  assert.equal(call.authorization, `Bearer ${good}`, 'the door added the saved key');
  assert.equal(call.path, '/v1/chat/completions'); assert.equal(call.body.model, 'MiniMax-M3.1-Flash');

  const files = readdirSync(s.cfg.stateDir, { recursive: true, encoding: 'utf8' }).map((f) => join(s.cfg.stateDir, f)).filter((p) => lstatSync(p).isFile());
  assert.equal(files.some((p) => readFileSync(p).includes(good)), false, 'the key is on no disk in the clear: not Pi\'s home, not the bot\'s folder, not the sealed store');
  assert.ok(files.some((p) => p.includes(join('pi', 'signins', 'pi-key-minimax'))), 'it is sealed in crewd\'s own store');

  await s.crew.accounts.logout('minimax');
  assert.equal(await s.crew.runtime.signedIn('minimax'), false);
  const door = join(s.cfg.stateDir, 'pi', 'minimax.sock'), said = model.calls.length;
  const status = await new Promise<number>((resolve, reject) => { const asked = ask({ socketPath: door, path: '/v1/chat/completions', method: 'POST' }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }); asked.on('error', reject); asked.end('{}'); });
  assert.equal(status, 401, 'a bot still running on a signed-out account reaches nothing');
  assert.equal(model.calls.length, said);
  s.done();
  if (before) assert.equal(treeHash(own), before, "the person's own Pi folder is byte for byte the same");
});

/** The Pis this process runs, by the folder each works in: Pi renames itself, so its command line says nothing, and it sits behind bubblewrap, so it is a descendant and not a child. */
const pis = (root = process.pid) => {
  const stats = readdirSync('/proc').filter((p) => /^\d+$/.test(p)).flatMap((pid) => {
    try { return [{ pid: Number(pid), parent: Number(readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ')[1]), comm: readFileSync(`/proc/${pid}/comm`, 'utf8').trim() }]; }
    catch { return []; } // gone between the listing and the read
  });
  const under = (p: { parent: number }): boolean => { const up = stats.find((s) => s.pid === p.parent); return p.parent === root || (!!up && under(up)); };
  return Object.fromEntries(stats.filter((p) => p.comm === 'pi-rpc' && under(p)).flatMap(({ pid }) => {
    try { return [[readlinkSync(`/proc/${pid}/cwd`), { pid, home: /(?:^|\0)HOME=([^\0]*)/.exec(readFileSync(`/proc/${pid}/environ`, 'utf8'))?.[1] }]]; }
    catch { return []; }
  }));
};

test('a bot on Pi is held in its own folder: a write anywhere else is refused by the wall in plain words, a write inside lands, and nothing outside changes', { skip, timeout: 120_000 }, async () => {
  process.env.CREWHOUSE_PI_TOOLS = 'write'; // the proof's own tool: the product leaves Pi none
  after(() => { delete process.env.CREWHOUSE_PI_TOOLS; });
  const model = await startModelStub();
  after(() => model.close());
  // Off /tmp, as a person's files are: inside the wall /tmp is the bot's own throwaway, so a target there would never meet the read-only disk.
  const lab = mkdtempSync('/var/tmp/crewhouse-pi-wall-'), mine = join(lab, 'person');
  after(() => rmSync(lab, { recursive: true, force: true }));
  const s = setup(3, { engine: 'pi', engineProvider: { baseUrl: model.url, apiKey: 'lab-key' }, stateDir: join(lab, 'state'), crewDir: join(lab, 'crew'), toolsDir: join(lab, 'tools') });
  s.crew.onboard('Umer');
  const scout = s.crew.recruit('scout', undefined, 'person').id;
  const home = join(s.cfg.stateDir, 'pi', scout), work = join(home, 'work'), neighbour = join(s.cfg.stateDir, 'pi', 'neighbour', 'work');
  mkdirSync(neighbour, { recursive: true });
  mkdirSync(join(mine, 'Documents'), { recursive: true });
  const ask = async (text: string) => {
    const job = (await s.crew.post(scout, text) as { task: number }).task;
    await until(`job ${job}`, () => !['queued', 'working'].includes(task(s.db, job).state), 60_000);
    return { state: task(s.db, job).state, said: String(lastSaid(s.db, scout)) };
  };
  const write = (path: string) => ask(`[tool write ${JSON.stringify({ path, content: 'written by the bot' })}]`);

  const inside = await write(join(work, 'notes', 'mine.txt'));
  assert.equal(inside.state, 'done');
  assert.equal(readFileSync(join(work, 'notes', 'mine.txt'), 'utf8'), 'written by the bot', 'a write in its folder lands on the real disk');

  const held = Object.values(pis())[0], own = (ns: string, pid: number | string) => readlinkSync(`/proc/${pid}/ns/${ns}`);
  assert.notEqual(own('mnt', held.pid), own('mnt', 'self'), 'Pi sees its own disk');
  assert.notEqual(own('pid', held.pid), own('pid', 'self'), 'and its own process list');

  const models = readFileSync(join(home, 'models.json'), 'utf8');
  for (const target of [join(mine, 'Documents', 'escape.txt'), join(mine, 'made-by-the-bot', 'escape.txt'), join(neighbour, 'escape.txt'), join(s.cfg.stateDir, 'person.key'), join(s.cfg.repoDir, 'escape.txt'), join(home, 'models.json')]) {
    const out = await write(target);
    assert.equal(out.state, 'done', 'the job carries on');
    assert.match(out.said, /That's outside my folder, so I can't open it\./, target);
    assert.doesNotMatch(out.said, /EROFS|read-only/);
  }
  for (const gone of [join(mine, 'Documents', 'escape.txt'), join(mine, 'made-by-the-bot'), join(neighbour, 'escape.txt'), join(s.cfg.stateDir, 'person.key'), join(s.cfg.repoDir, 'escape.txt')]) assert.equal(existsSync(gone), false, gone);
  assert.equal(readFileSync(join(home, 'models.json'), 'utf8'), models, 'its own model setup is not its to change');
  for (const throwaway of [join(home, 'scratch.txt'), join('/tmp', `crewhouse-pi-wall-${process.pid}.txt`)]) {
    assert.match((await write(throwaway)).said, /Successfully wrote/, 'Pi\'s home and /tmp are its own throwaways: it may write there');
    assert.equal(existsSync(throwaway), false, 'and none of that reaches the disk');
  }
  assert.equal((await write(join(work, 'after.txt'))).state, 'done', 'and it keeps working afterwards');
  assert.ok(existsSync(join(work, 'after.txt')));
  s.done();
});

test('a machine with no wall boots refusing: Pi never starts, the app says why and names the fix, and a job ends on that line', { skip, timeout: 120_000 }, async () => {
  const model = await startModelStub();
  after(() => model.close());
  const fix = (name: string) => { const dir = temp(`pi-nowall-${name}`); symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(dir, 'git')); return dir; };
  const missing = fix('missing'), refusing = fix('refusing'), old = fix('old'), noManager = fix('no-manager'), noLimit = fix('no-limit');
  for (const dir of [noManager, noLimit]) { symlinkSync(execFileSync('sh', ['-c', 'command -v bwrap'], { encoding: 'utf8' }).trim(), join(dir, 'bwrap')); writeFileSync(join(dir, 'true'), '#!/bin/sh\n', { mode: 0o755 }); }
  writeFileSync(join(noLimit, 'systemd-run'), "#!/bin/sh\nprintf 'max\\nmax\\n0\\n'\n", { mode: 0o755 }); // a scope that starts and holds nothing back
  writeFileSync(join(refusing, 'bwrap'), "#!/bin/sh\necho 'bwrap: setting up uid map: Permission denied' >&2\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(old, 'bwrap'), "#!/bin/sh\necho 'bwrap: Unknown option --disable-userns' >&2\nexit 1\n", { mode: 0o755 }); // Ubuntu 22.04's: fine for the helpers' shell, no wall for Pi
  const cases = [{ path: missing, line: /^Bots can't start, because Crewhouse can't hold them inside their folders: bubblewrap is not installed\. To fix it: sudo apt install bubblewrap/ }, { path: refusing, line: /^Bots can't start, because Crewhouse can't hold them inside their folders: bubblewrap cannot start here \(it said: bwrap: setting up uid map: Permission denied\)\. To fix it: / }, { path: old, line: /^Bots can't start, because Crewhouse can't hold them inside their folders: this bubblewrap is too old \(it said: bwrap: Unknown option --disable-userns\)\. To fix it: update bubblewrap to 0\.8 or later$/ }, { path: noManager, line: /^Bots can't start, because Crewhouse can't give each one its own memory limit: systemd-run is not on this computer\. To fix it: / }, { path: noLimit, line: /^Bots can't start, because Crewhouse can't give each one its own memory limit: this computer starts programs without applying the limit\. To fix it: / }];
  for (const { path, line } of cases) {
    const root = temp(`pi-nowall-${cases.findIndex((c) => c.path === path)}`), port = await new Promise<number>((r) => { const l = createServer().listen(0, '127.0.0.1', () => { const { port } = l.address() as AddressInfo; l.close(() => r(port)); }); });
    const daemon = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], { env: { ...process.env, PATH: path, CREWHOUSE_ENGINE: 'pi', CREWHOUSE_ENGINE_BASE_URL: model.url, CREWHOUSE_ENGINE_API_KEY: 'lab-key', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') }, stdio: ['ignore', 'ignore', 'ignore'] });
    after(() => daemon.kill());
    const api = async (at: string, body?: unknown) => (await fetch(`http://127.0.0.1:${port}${at}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8')}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined })).json();
    let engine: any, failed: any;
    await until('the engine to report', async () => engine = await api('/api/state').then((st) => st.engine?.phase === 'failed' && st.engine, () => false), 30_000);
    assert.match(engine.words, line);
    await api('/api/onboard', { address: 'Umer' });
    const { id } = await api('/api/recruit', { template: 'scout' }), asked = model.calls.length;
    await api(`/api/bots/${id}/messages`, { text: 'Good morning' });
    await until('the job to end', async () => failed = (await api(`/api/bots/${id}`)).tasks.find((t: any) => t.state === 'failed'), 30_000);
    assert.match(failed.result, line, 'the job ends on the same line');
    assert.equal(model.calls.length, asked, 'no model was asked');
    assert.deepEqual(pis(daemon.pid), {}, 'and no Pi ran');
    assert.equal(existsSync(join(root, 'state', 'pi', id, 'work')), false, 'nor was a folder made for one');
    daemon.kill();
    await new Promise((r) => daemon.once('exit', r));
  }
});

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

/** What code running inside a bot's Pi finds from its room: a Pi extension, the way the plan's escapes ran, as a bot on Pi has no shell. It holds its port for as long as Pi lives. */
const PROBE = `
import { connect, createServer } from 'node:net'; import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const tcp = (at, host = '127.0.0.1') => new Promise((r) => { const c = connect({ port: Number(at), host, timeout: 3000 }); c.on('connect', () => { c.destroy(); r('connected'); }); c.on('error', (e) => r(e.code)); c.on('timeout', () => { c.destroy(); r('timed out'); }); });
const door = (path, method = 'POST') => fetch('http://127.0.0.1:3128' + path, { method, body: method === 'POST' ? '{}' : undefined }).then((r) => r.status, (e) => e.cause?.code ?? e.message);
export default () => { setTimeout(async () => {
  const { HOLD, HOST_PORT, MODEL_PORT } = process.env, held = await new Promise((r) => { createServer().on('error', (e) => r(e.code)).listen(Number(HOLD), '127.0.0.1', () => r('bound')); });
  writeFileSync('found.json', JSON.stringify({ held, hostPort: await tcp(HOST_PORT), modelDirect: await tcp(MODEL_PORT), outside: await tcp(443, '1.1.1.1'), doorList: await door('/v1/models', 'GET'), doorOther: await door('/v1/embeddings'), doorAbove: await door('/admin'),
    seen: ['/run/user', '/sys/fs/cgroup', '/proc/self'].filter((p) => existsSync(p)), keyInEnv: Object.values(process.env).some((v) => v.includes('lab-key')), keyOnDisk: readFileSync(process.env.HOME + '/models.json', 'utf8').includes('lab-key') }));
}, 100); };
`;

test('a bot on Pi has its own ports and its model is all it can reach: two bots and this computer hold one port at once, and only a model call gets through the door, with a key the bot never held', { skip, timeout: 120_000 }, async () => {
  const model = await startModelStub();
  after(() => model.close());
  const listen = () => new Promise<{ port: number; close(): void }>((r) => { const l = createServer().listen(0, '127.0.0.1', () => r({ port: (l.address() as AddressInfo).port, close: () => l.close() })); });
  const [mine, spare] = await Promise.all([listen(), listen()]);
  after(() => { mine.close(); spare.close(); });
  const repo = join(import.meta.dirname, '..'), state = temp('pi-room'), sock = join(state, 'door.sock'), probe = join(state, 'probe.mjs');
  writeFileSync(probe, PROBE);
  const door = await openDoor(sock, { baseUrl: model.url, apiKey: 'lab-key' });
  after(() => door.close());
  const { createPiKit } = await import(join(repo, 'runtime', 'byokit', 'packages', 'pi', 'dist', 'index.js')), kit = createPiKit({ stateDir: state });
  after(() => kit.close());
  const start = async (id: string) => {
    const home = join(state, 'pi', id), folder = join(home, 'work'), extensions = [...piBuiltIn(repo), probe];
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(home, 'SYSTEM.md'), `Your id in Crewhouse is ${id}.`);
    writeFileSync(join(home, 'settings.json'), '{"defaultTools":[]}');
    writeFileSync(join(home, 'models.json'), JSON.stringify({ providers: { crewhouse: { baseUrl: MODEL_URL, api: 'openai-completions', apiKey: 'added-at-the-door', models: [{ id: 'test' }] } } }));
    const bot = kit.bot({ id, folder, session: id, extensions, env: { ...bus(), HOLD: String(mine.port), HOST_PORT: String(spare.port), MODEL_PORT: new URL(model.url).port },
      launch: ({ command, args }: { command: string; args: string[] }) => ({ command: 'systemd-run', args: [...piRoom(`crewhouse-lab-${id}-${process.pid}`), 'bwrap', ...piWall({ folder, home, repo, extensions, door: sock }), command, ...args] }) });
    const said = await new Promise<string>((resolve, reject) => { const off = bot.on((e: any) => { if (e.type === 'end') { off(); resolve(e.end.text ?? e.end.message); } }); bot.prompt('Hello').catch(reject); });
    assert.match(said, new RegExp(`stub ${id}: done`), 'a model call goes through the door and comes back');
    await until(`${id}'s probe`, () => existsSync(join(folder, 'found.json')), 30_000);
    return JSON.parse(readFileSync(join(folder, 'found.json'), 'utf8'));
  };
  for (const found of await Promise.all(['one', 'two'].map(start)))
    assert.deepEqual(found, { held: 'bound', hostPort: 'ECONNREFUSED', modelDirect: 'ECONNREFUSED', outside: 'ENETUNREACH', doorList: 403, doorOther: 403, doorAbove: 403, seen: [], keyInEnv: false, keyOnDisk: false });
  assert.deepEqual([...new Set(model.calls.map((c) => `${c.path} ${c.authorization}`))], ['/v1/chat/completions Bearer lab-key'], 'only model calls came through, each with the real key added at the door');
});

test('the door reaches an https model the same way: the key added, the answer streamed back piece by piece', { timeout: 60_000 }, async () => {
  const dir = temp('door-tls'), key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem'), sock = join(dir, 'door.sock'), heard: string[] = [];
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=model', '-addext', 'subjectAltName=IP:127.0.0.1', '-days', '1'], { stdio: 'ignore' });
  const was = globalAgent.options.ca; globalAgent.options.ca = readFileSync(cert);
  const model = createSecure({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => { heard.push(`${req.method} ${req.url} ${req.headers.authorization}`); res.write('first '); req.resume(); req.on('end', () => setImmediate(() => res.end('last'))); });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  const door = await openDoor(sock, { baseUrl: `https://127.0.0.1:${(model.address() as AddressInfo).port}/v1/`, apiKey: 'lab-key' });
  after(() => { globalAgent.options.ca = was; door.close(); model.close(); });
  const said = await new Promise<string>((resolve, reject) => { const asked = ask({ socketPath: sock, path: '/v1/chat/completions', method: 'POST', headers: { authorization: 'Bearer added-at-the-door' } }, (res) => { let all = ''; res.on('data', (b) => all += b); res.on('end', () => resolve(all)); }); asked.on('error', reject); asked.end('{}'); });
  assert.equal(said, 'first last');
  assert.deepEqual(heard, ['POST /v1/chat/completions Bearer lab-key']);
});

test('a bot on Pi that reaches its memory ceiling stops alone: its job says so, two others mid-turn answer, and its next message starts a fresh room', { skip, timeout: 180_000 }, async () => {
  process.env.CREWHOUSE_PI_TOOLS = 'read'; // the proof's own tool: an endless file is a bot asking for more than its room holds
  after(() => { delete process.env.CREWHOUSE_PI_TOOLS; });
  const model = await startModelStub();
  after(() => model.close());
  const s = setup(3, { engine: 'pi', engineProvider: { baseUrl: model.url, apiKey: 'lab-key' } });
  s.crew.onboard('Umer');
  const [hog, a, b] = ['scout', 'scribe', 'reel'].map((t) => s.crew.recruit(t, undefined, 'person').id), work = (bot: string) => join(s.cfg.stateDir, 'pi', bot, 'work');
  const ask = async (bot: string, text: string): Promise<number> => (await s.crew.post(bot, text) as { task: number }).task;
  const ended = (t: number) => until(`job ${t} on Pi`, () => !['queued', 'working'].includes(task(s.db, t).state), 120_000);
  const room = (pid: number) => join('/sys/fs/cgroup', readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim().split(':')[2]);

  const [one, two] = await Promise.all([ask(a, 'ask permission as one'), ask(b, 'ask permission as two')]);
  await until('both mid-turn', () => holding('one') && holding('two'), 60_000);
  const kept = pis();
  assert.notEqual(room(kept[work(a)].pid), room(kept[work(b)].pid), 'each Pi has a room of its own');
  for (const bot of [a, b]) assert.deepEqual(['memory.max', 'memory.swap.max', 'memory.oom.group'].map((f) => readFileSync(join(room(kept[work(bot)].pid), f), 'utf8').trim()), [String(1000 * 1024 * 1024), '0', '1']);

  const lost = await ask(hog, '[tool read {"path": "/dev/zero"}]');
  await ended(lost);
  assert.equal(task(s.db, lost).state, 'failed');
  assert.equal(task(s.db, lost).result, 'This job needed more than the 1000 MB of memory a bot may use, so Crewhouse stopped it. The other bots carried on.');
  assert.equal(pis()[work(hog)], undefined, 'nothing of it is left running');
  for (const bot of [a, b]) {
    assert.equal(pis()[work(bot)].pid, kept[work(bot)].pid, 'the others were not touched');
    assert.match(readFileSync(join(room(kept[work(bot)].pid), 'memory.events'), 'utf8'), /^oom_kill 0$/m);
  }
  release('one', 'First answered');
  release('two', 'Second answered');
  await Promise.all([ended(one), ended(two)]);
  assert.deepEqual([task(s.db, one).state, task(s.db, two).state], ['done', 'done']);
  assert.deepEqual([lastSaid(s.db, a), lastSaid(s.db, b)], ['First answered', 'Second answered']);
  const back = await ask(hog, 'Back again');
  await ended(back);
  assert.equal(task(s.db, back).state, 'done', 'the next message gives it a fresh room');
  await s.crew.stop();
  await until('no Pi outlives crewd', () => Object.keys(pis()).length === 0);
  s.done();
});

test('each bot on Pi loads its own list: neither sees the other\'s tools, an empty list answers in words, a name outside the reviewed set stops the job', { skip, timeout: 180_000 }, async () => {
  process.env.CREWHOUSE_PI_IDLE_MS = '300';
  after(() => { delete process.env.CREWHOUSE_PI_IDLE_MS; });
  const model = await startModelStub();
  after(() => model.close());
  const s = setup(3, { engine: 'pi', engineProvider: { baseUrl: model.url, apiKey: 'lab-key' } });
  s.crew.onboard('Umer');
  const [scout, scribe, reel] = ['scout', 'scribe', 'reel'].map((t) => s.crew.recruit(t, undefined, 'person').id);
  const list = (bot: string, text: string) => writeFileSync(join(s.cfg.crewDir, 'bots', bot, 'extensions.json'), text);
  const ask = async (bot: string, text: string) => {
    const job = (await s.crew.post(bot, text) as { task: number }).task;
    await until(`${bot}'s job ${job}`, () => !['queued', 'working'].includes(task(s.db, job).state), 60_000);
    return { state: task(s.db, job).state, said: String(lastSaid(s.db, bot)), offered: names(model.calls.filter((c) => JSON.stringify(c.body.messages).includes(`Your id in Crewhouse is ${bot}.`)).at(-1)!) };
  };
  list(scribe, '["hello"]');
  list(reel, '[]'); // scout has no file: the default

  const added = await ask(scout, '[tool todo {"action": "add", "text": "ring the dentist"}]');
  assert.deepEqual([added.state, added.offered], ['done', ['notes', 'todo']], 'no list in its folder: the default');
  assert.match(added.said, /Added todo #1: ring the dentist/);
  const hi = await ask(scribe, '[tool hello {"name": "Umer"}]');
  assert.deepEqual([hi.state, hi.offered], ['done', ['hello']], "its own list, and not the default's todo");
  assert.match(hi.said, /Hello, Umer!/);

  assert.match((await ask(scout, '[tool hello {"name": "Umer"}]')).said, /hello not found/i, "scout cannot call scribe's tool");
  assert.match((await ask(scribe, '[tool todo {"action": "list"}]')).said, /todo not found/i, "nor scribe scout's");
  assert.doesNotMatch(readFileSync(join(s.cfg.stateDir, 'pi', scribe, 'SYSTEM.md'), 'utf8'), /tools: todo/);

  const plain = await ask(reel, 'What day is it?');
  assert.deepEqual([plain.state, plain.offered], ['done', []], 'an empty list: no tool at all');
  assert.match(plain.said, new RegExp(`stub ${reel}: done with`), 'and it still answers in words');
  assert.match(readFileSync(join(s.cfg.stateDir, 'pi', reel, 'SYSTEM.md'), 'utf8'), /no tools at all/);

  // A helper's working list lives in its standing session: its Pi stopping loses nothing, and a changed list takes effect on the next job.
  await until('every Pi to stop once idle', () => !Object.keys(pis()).length, 30_000);
  const kept = await ask(scout, '[tool todo {"action": "list"}]');
  assert.match(kept.said, /#1: ring the dentist/);
  list(scout, '["hello", "todo", "todo"]');
  assert.deepEqual((await ask(scout, 'Anything new?')).offered, ['hello', 'todo']);

  // The folder names, it never points: a path or a broken file stops the job with the cause, and nothing it named is loaded.
  const canary = join(s.root, 'loaded.txt'), planted = join(s.root, 'planted.ts');
  writeFileSync(planted, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(canary)}, 'x'); export default function () {}`);
  const asked = model.calls.length;
  for (const bad of [JSON.stringify([planted]), '["__proto__"]', '{"todo": true}', 'not json']) {
    list(reel, bad);
    const ended = await ask(reel, 'Hello again');
    assert.deepEqual([ended.state, ended.said], ['failed', "This job did not start: extensions.json in this bot's folder may only list todo, hello, notes."], bad);
  }
  assert.equal(model.calls.length, asked, 'no model was asked on a bad list');
  assert.equal(existsSync(canary), false, 'and the planted file never ran');
  s.done();
});

test('a bot on Pi is shown its own notes once, as a job starts, and has no read: recalled with no session left, never the other bot\'s, full says so, and the memory switch takes them away', { skip, timeout: 180_000 }, async () => {
  process.env.CREWHOUSE_PI_IDLE_MS = '300';
  after(() => { delete process.env.CREWHOUSE_PI_IDLE_MS; });
  const model = await startModelStub();
  after(() => model.close());
  const s = setup(3, { engine: 'pi', engineProvider: { baseUrl: model.url, apiKey: 'lab-key' } });
  s.crew.onboard('Umer');
  const [scout, scribe] = ['scout', 'scribe'].map((t) => s.crew.recruit(t, undefined, 'person').id);
  const work = (bot: string) => join(s.cfg.stateDir, 'pi', bot, 'work'), file = (bot: string) => join(work(bot), 'notes.md');
  const notes = (...inputs: object[]) => inputs.map((input) => `[tool notes ${JSON.stringify(input)}]`).join(' ');
  const ask = async (bot: string, text: string) => {
    const job = (await s.crew.post(bot, text) as { task: number }).task;
    await until(`${bot}'s job ${job}`, () => !['queued', 'working'].includes(task(s.db, job).state), 60_000);
    assert.equal(task(s.db, job).state, 'done');
    return String(lastSaid(s.db, bot));
  };
  /** What each model request of the job just asked showed as the bot's notes. */
  const asking = async (bot: string, text: string) => { const from = model.calls.length, said = await ask(bot, text), calls = model.calls.slice(from); return { said, calls, shown: calls.map(savedNotes) }; };

  // A first job has nothing to be shown, and what it adds waits for the next job: nothing reads the file again mid-job.
  const first = await asking(scout, notes({ action: 'add', text: 'The locker  code\nis K7' }));
  assert.match(first.said, /Saved\. 24 of 8192 bytes used/);
  assert.deepEqual(first.shown, ['None yet.\n', 'None yet.\n']);
  await ask(scribe, notes({ action: 'add', text: 'The locker code is M4' }));
  assert.equal(readFileSync(file(scout), 'utf8'), '- The locker code is K7\n', 'one plain line per note');

  // The calls a real model made on one job, read and add and read: every read is refused with no note in it, and each round shows what the job began with.
  const replay = await asking(scout, notes({ action: 'read' }, { action: 'add', text: 'two' }, { action: 'read' }, { action: 'read' }, { action: 'forget', text: 'two' }));
  assert.deepEqual(replay.shown, Array(6).fill('- The locker code is K7\n'));
  const told = replay.calls.at(-1)!.body.messages.filter((m: any) => m.role === 'tool').slice(-5).map((m: any) => JSON.stringify(m.content));
  for (const i of [0, 2, 3]) { assert.match(told[i], /Validation failed/); assert.doesNotMatch(told[i], /K7/); }
  assert.equal(readFileSync(file(scout), 'utf8'), '- The locker code is K7\n');

  // Both Pis stop and their sessions go, so the file is the only thing left that could carry a note into the next turn.
  await until('both Pis stopped once idle', () => Object.keys(pis()).length === 0, 30_000);
  for (const bot of [scout, scribe]) rmSync(join(work(bot), 'sessions'), { recursive: true });
  const recalled = await asking(scout, 'What is my locker code?');
  assert.deepEqual(recalled.shown, ['- The locker code is K7\n'], 'one model call, no tool: the job began knowing it');
  const words = recalled.calls[0].body.messages.filter((m: any) => m.role !== 'system');
  assert.doesNotMatch(JSON.stringify(words), /K7/, 'and only the notes carried it');

  // Neither reaches the other's: the tool takes no path, so one aimed at the other folder lands in the bot's own notes.
  await ask(scout, notes({ action: 'add', text: 'aimed at the other', path: file(scribe) }));
  assert.equal(readFileSync(file(scribe), 'utf8'), '- The locker code is M4\n');
  await ask(scout, notes({ action: 'forget', text: 'aimed at the other' }));
  for (const [bot, own, other] of [[scout, /K7/, /M4/], [scribe, /M4/, /K7/]] as const) {
    const { shown, calls } = await asking(bot, 'Anything new?');
    assert.match(shown[0]!, own);
    assert.doesNotMatch(JSON.stringify(calls[0].body.messages), other);
  }

  // Full is said, the note is not saved, and forgetting makes room. The last byte counts: a note that fits exactly is kept.
  const line = '- The locker code is M4\n', room = 8192 - Buffer.byteLength(line) - Buffer.byteLength('- last\n');
  writeFileSync(file(scribe), `${line}- ${'x'.repeat(room - 3)}\n`);
  assert.match(await ask(scribe, notes({ action: 'add', text: 'last' })), /8192 of 8192 bytes used/);
  const full = readFileSync(file(scribe), 'utf8');
  assert.match(await ask(scribe, notes({ action: 'add', text: 'one more' })), /Your notes are full: 8192 of 8192 bytes are used and this note needs 11, so it was not saved\. Forget something first\./);
  assert.equal(readFileSync(file(scribe), 'utf8'), full, 'nothing was half written');
  assert.match(await ask(scribe, notes({ action: 'forget', text: 'nothing has this' })), /nothing was dropped/);
  assert.match(await ask(scribe, notes({ action: 'forget', text: 'XXX' })), /Dropped 1/);
  assert.match(await ask(scribe, notes({ action: 'add', text: 'one more' })), /Saved/);
  assert.equal(readFileSync(file(scribe), 'utf8'), `${line}- last\n- one more\n`);

  // The person's switch outranks the list: no tool and nothing shown, and the notes stay where they are.
  patchConfig(s.cfg, scout, { memory: false });
  const off = await asking(scout, notes({ action: 'add', text: 'kept against the switch' }));
  assert.match(off.said, /notes not found/i);
  assert.deepEqual(names(off.calls.at(-1)!), ['todo']);
  assert.deepEqual(off.shown, [undefined, undefined]);
  assert.doesNotMatch(JSON.stringify(off.calls.at(-1)!.body.messages), /K7/);
  assert.equal(readFileSync(file(scout), 'utf8'), '- The locker code is K7\n');
  s.done();
});

test('a bot on Pi that keeps writing notes is asked for its answer and gives it inside the cap; one that never stops ends on the stopped-turn line with the cap in the events; a plain turn is never asked', { skip, timeout: 180_000 }, async () => {
  let stubborn = false;
  // Always one more call than the turn has made, alternating a note and a todo: left alone, this model never stops.
  const churn = (body: any) => '[tool notes {"action": "add", "text": "still thinking"}][tool todo {"action": "add", "text": "think more"}]'.repeat(body.messages.length), asked = /Stop calling tools now/;
  const model = await startModelStub(undefined, (body, text) => asked.test(text) && !stubborn ? { reply: 'The locker code is K7.' } : asked.test(text) || /keep going/.test(text) ? { text: churn(body) } : {});
  after(() => model.close());
  const s = setup(3, { engine: 'pi', engineProvider: { baseUrl: model.url, apiKey: 'lab-key' } });
  s.crew.onboard('Umer');
  const scout = s.crew.recruit('scout', undefined, 'person').id;
  const ask = async (text: string) => {
    const from = model.calls.length, job = (await s.crew.post(scout, text) as { task: number }).task;
    await until(`job ${job}`, () => !['queued', 'working'].includes(task(s.db, job).state), 90_000);
    // What this job added to the session, as the model's last request carries it: the tool results that ran, and the asks.
    const calls = model.calls.slice(from).map((c) => JSON.stringify(c.body.messages)), count = (call: string, what: string) => call.split(what).length - 1, added = (what: string) => count(calls.at(-1)!, what) - count(calls[0], what);
    return { state: task(s.db, job).state, result: String(task(s.db, job).result), said: String(lastSaid(s.db, scout)), ran: added('"role":"tool"'), asks: added('Stop calling tools now') };
  };

  const answered = await ask('Find the locker code, keep going');
  assert.deepEqual([answered.state, answered.said], ['done', 'The locker code is K7.'], 'the churning bot answers in words');
  assert.equal(answered.asks, 1, 'asked once for its answer');
  assert.ok(answered.ran >= 20 && answered.ran <= 30, `after twenty tool calls, inside the cap of thirty: ${answered.ran}`);
  assert.equal(s.db.all("SELECT 1 FROM events WHERE kind = 'run.limit'").length, 0, 'it never reached the cap');

  stubborn = true;
  const stopped = await ask('Find the gate code, keep going');
  assert.equal(stopped.state, 'failed');
  assert.match(stopped.result, /couldn't finish this one\. Try again\.$/, 'a bot that never answers ends on the line the app shows for a stopped turn');
  assert.doesNotMatch(stopped.result, /maxToolCalls|Stopped:/);
  assert.equal(stopped.asks, 1);
  assert.ok(stopped.ran >= 30 && stopped.ran <= 40, `the turn ended at the cap or just past it: ${stopped.ran} ran, the calls already under way when the kit's stop landed, if their results reached the model before the stop cut the door's call`);
  assert.deepEqual(s.db.all("SELECT bot, data FROM events WHERE kind = 'run.limit'").map((e) => [e.bot, JSON.parse(e.data).calls, JSON.parse(e.data).limit]), [[scout, 30, 30]], 'the events say the cap was reached');

  stubborn = false;
  const plain = await ask('What day is it?');
  assert.deepEqual([plain.state, plain.said, plain.ran, plain.asks], ['done', `stub ${scout}: done with "What day is it?"`, 0, 0], 'a turn that answers is never asked');
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
  const finished = (bot: string, n: number) => until(`${bot} finishes job ${n}`, async () => (await api(`/api/bots/${bot}`)).tasks.filter((t: any) => t.state === 'done').length >= n, 60_000);
  await api(`/api/bots/${a}/messages`, { text: '[tool notes {"action": "add", "text": "The gate code is G9"}]' });
  await finished(a, 1);
  await Promise.all([api(`/api/bots/${a}/messages`, { text: 'ask permission as crash-one' }), api(`/api/bots/${b}/messages`, { text: 'ask permission as crash-two' })]);
  await until('both helpers mid-turn', () => holding('crash-one') && holding('crash-two'), 60_000);
  const pids = Object.values(pis(daemon!.pid)).map((p) => p.pid);
  assert.equal(pids.length, 2);

  daemon!.kill('SIGKILL');
  await new Promise((r) => daemon.once('exit', r));
  await until('no Pi outlives a killed crewd', () => !pids.some((pid) => existsSync(`/proc/${pid}`)));
  start();
  await up();
  await Promise.all([finished(a, 2), finished(b, 1)]);
  for (const bot of [a, b]) assert.equal(readdirSync(join(root, 'state', 'pi', bot, 'work', 'sessions')).length, 1, 'the same session carried on');
  await api(`/api/bots/${a}/messages`, { text: 'What is the gate code?' });
  await finished(a, 3);
  assert.equal(savedNotes(model.calls.at(-1)!), '- The gate code is G9\n', 'a note from before the crash is shown on the next job after it');
});
