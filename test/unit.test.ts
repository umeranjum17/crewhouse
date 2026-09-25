// Unit checks for the deterministic half: store, queue, the gate, tool grants, memory, accounts. The real engine runs
// every task on the stub model: no network, no account, no quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, sleep, task, until, prompted, settled, holding, release, lastSaid } from './lab.ts';

const { quietNow, short, classify } = await import('../src/crew.ts');
const { OWNER, signInError } = await import('../src/accounts.ts');
const { effectOf, browserAsk, coversOf, toolWords } = await import('../src/policy.ts');
const kit = await import('../src/tools.ts');
const disk = await import('../src/bots.ts');
const { loadConfig } = await import('../src/config.ts');
const { createProvider } = await import('@earendil-works/pi-ai');

const fakeBin = (dir: string, ...names: string[]) => {
  mkdirSync(dir, { recursive: true });
  for (const b of names) { writeFileSync(join(dir, b), '#!/bin/sh\necho "fake $0 $*"\n'); chmodSync(join(dir, b), 0o755); }
};
const openAsk = (db: any) => db.get("SELECT * FROM asks WHERE state = 'open'");
/** A user message the stub model turns into one tool call. */
const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;

test('store: a failed transaction leaves nothing behind; events fan out after commit', async () => {
  const { db, done } = setup();
  const seen: string[] = [];
  db.onEvent((e) => seen.push(e.kind));
  assert.throws(() => db.tx(() => { db.event('x.one', null); throw new Error('boom'); }));
  assert.equal(db.all("SELECT * FROM events WHERE kind = 'x.one'").length, 0);
  const e = db.event('x.two', null, { a: 1 });
  await sleep(0);
  assert.ok(seen.includes('x.two'));
  assert.deepEqual(db.events(e.seq - 1).map((x) => x.data), [{ a: 1 }]);
  done();
});

test('queue: one task at a time per bot, and a global cap across bots', async () => {
  const { db, crew, done } = setup(1);
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  crew.recruit('scout', 'Scout', 'person');
  const a = crew.assign('reel', 'ask permission first', 'chief').task; // the stub model holds this turn
  const b = crew.assign('reel', 'second job', 'chief').task;
  const c = crew.assign('scout', 'look something up', 'chief').task;
  await holding(crew, 'reel');
  assert.equal(task(db, a).state, 'working');
  assert.equal(task(db, b).state, 'queued', 'same bot waits its turn');
  assert.equal(task(db, c).state, 'queued', 'global cap of 1 holds the other bot');
  await release(crew, 'reel', 'done with the first');
  await settled(db, c); // the cap runs b first, then c
  assert.equal(task(db, a).state, 'done');
  assert.equal(task(db, a).result, 'done with the first');
  assert.equal(task(db, b).state, 'done', 'next task for the bot ran');
  assert.equal(task(db, c).state, 'done', 'then the other bot');
  assert.equal(crew.sessionOf('reel'), undefined, 'a finished task closes its session');
  done();
});

test('task titles are cut at a word, never mid-word', async () => {
  assert.equal(short('  Make a demo  ', 80), 'Make a demo');
  assert.equal(short('Open wikipedia.org in your browser, search for Herdr, then read the top 5 results slowly', 80),
    'Open wikipedia.org in your browser, search for Herdr, then read the top 5…');
  const { db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  const t = crew.assign('reel', 'Make a 10 second video with three title cards: One, Two, Three, about three seconds each', 'chief').task;
  assert.equal(task(db, t).title, 'Make a 10 second video with three title cards: One, Two, Three, about three…');
  await settled(db, t);
  done();
});

test('policy: own space and the sandboxed shell run silently; the person\'s files, sending and spending ask; secrets never', () => {
  const home = homedir();
  const s = { bot: 'Maya', space: '/data/bots/maya', secret: [join(home, '.pi'), '/state'], page: 'https://mail.google.com/x', signedIn: ['google.com'],
    run: { people_search: { name: 'people search', free: ['catalog', 'balance'], spend: ['call'] } } };
  assert.deepEqual(effectOf('write', { path: 'files/list.txt' }, s), { kind: 'safe' });
  assert.deepEqual(effectOf('read', { path: '/data/bots/maya/notes.md' }, s), { kind: 'safe' });
  assert.deepEqual(effectOf('bash', { command: 'fc-list 2>&1 | head -20' }, s), { kind: 'safe' }, 'the font lookup from the owner\'s screenshot runs silently');
  assert.deepEqual(effectOf('web_search', { query: 'x' }, s), { kind: 'safe' });
  const doc = effectOf('write', { path: join(home, 'Documents', 'probe.txt') }, s) as any;
  assert.equal(doc.kind, 'files');
  assert.equal(doc.words, 'Maya wants to change a file in your Documents folder: “probe.txt”.');
  assert.equal(coversOf(doc.key), 'your Documents folder');
  assert.equal((effectOf('ls', { path: join(home, 'Pictures') }, s) as any).words, 'Maya wants to look through your Pictures folder.');
  assert.equal(effectOf('read', { path: join(home, '.pi', 'agent', 'auth.json') }, s).kind, 'refuse', 'sign-ins are never opened, not even with leave');
  assert.equal(effectOf('read', { path: '/state/people/1/engine/auth.json' }, s).kind, 'refuse');
  const pay = effectOf('people_search', { args: ['call', 'treg.people.phone.find', '--header', 'X-Treg-Route-Max-Cost: 0.05'] }, s) as any;
  assert.deepEqual([pay.kind, pay.words, pay.key], ['spend', 'Maya wants to make a paid lookup with people search, up to $0.05.', undefined], 'spending has no standing key');
  assert.deepEqual(effectOf('people_search', { args: ['catalog', 'search', 'phone'] }, s), { kind: 'safe' });
  assert.equal(effectOf('people_search', { args: ['logout'] }, s).kind, 'refuse');
  assert.equal(effectOf('browser_click', { ref: 'e1' }, s).kind, 'send');
  assert.equal(effectOf('browser_snapshot', {}, s).kind, 'safe');
  assert.equal(effectOf('teleport', {}, s).kind, 'refuse', 'unknown tools fail closed');
  assert.equal(toolWords('bash', { command: 'ffmpeg -y -i a.png out.mp4' }), 'Worked on a video');
  assert.equal(toolWords('bash', { command: 'fc-list | head' }), 'Worked in its own space', 'the trail never shows a command');
  assert.equal(toolWords('write', { path: '/data/bots/maya/files/list.txt' }), 'Saved list.txt');
});

test('browser asks first on signed-in sites and payment pages, only for actions', () => {
  assert.equal(browserAsk('browser_navigate', 'https://shop.example/checkout', []), null, 'looking is fine');
  assert.deepEqual(browserAsk('browser_click', 'https://shop.example/checkout', []), { spend: true, host: 'shop.example' });
  assert.deepEqual(browserAsk('browser_type', 'https://mail.google.com/x', ['google.com']), { spend: false, host: 'mail.google.com' });
  assert.equal(browserAsk('browser_click', 'https://news.ycombinator.com/', ['google.com']), null);
  assert.equal(browserAsk('browser_snapshot', 'https://pay.google.com/', []), null);
});

test('the gate: an ask holds the call; allowed, it runs; unanswered, the turn parks and the answer resumes the same session', async () => {
  const { root, db, crew, done } = setup();
  crew.onboard("ma'am");
  crew.recruit('reel', 'Reel', 'person');
  const outside = join(root, 'outside', 'x.txt');
  const t = crew.assign('reel', `save it ${call('write', { path: outside, content: 'hello' })}`, 'chief').task;
  await until('an ask', () => openAsk(db));
  const ask = openAsk(db);
  assert.equal(ask.title, 'Reel wants to change a file in a folder outside your home: “x.txt”.');
  assert.equal(task(db, t).state, 'needs_you');
  const view = crew.snapshot().asks[0];
  assert.deepEqual(view.detail, { effect: 'files', spends: false, covers: 'a folder outside your home' }, 'the app sees words, never the path');
  await crew.answer(ask.id, { answer: 'allow' });
  await settled(db, t);
  assert.equal(task(db, t).state, 'done');
  assert.equal(readFileSync(outside, 'utf8'), 'hello');

  // Nobody answers within the hold: the turn parks, the task waits on the person, and the answer is the next prompt.
  const p = crew.assign('reel', `again ${call('write', { path: outside, content: 'second' })}`, 'chief').task;
  await until('parked', () => db.get("SELECT 1 FROM events WHERE kind = 'ask.parked'"));
  await until('turn over', () => !crew.sessionOf('reel')?.isStreaming);
  assert.equal(task(db, p).state, 'needs_you', 'parked, not done');
  await assert.rejects(crew.answer(9999, { answer: 'allow' }), /already settled/);
  const parked = openAsk(db);
  await assert.rejects(crew.answer(parked.id, { answer: 'maybe' }), /allow or deny/);
  await crew.answer(parked.id, { answer: 'deny' });
  await settled(db, p);
  assert.equal(task(db, p).state, 'done', 'the answer resumed the same session and it finished');
  assert.equal(readFileSync(outside, 'utf8'), 'hello', 'not allowed, not written');
  assert.match(crew.botPage('reel').trail.map((e: any) => e.kind).join(), /ask\.parked/);
  done();
});

test('approval scopes: once, for this task, always for the bot; spending asks every time', async () => {
  const { root, cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  const dir = join(root, 'Outside');
  const t = crew.assign('reel', 'ask permission while I test the gate', 'chief').task;
  await holding(crew, 'reel');
  const gate = (tool: string, input: object) => (crew as any).gate('reel', tool, input);
  const ask = async (tool: string, input: object) => {
    const held = gate(tool, input);
    await sleep(20);
    return { held, open: openAsk(db) };
  };

  let a = await ask('write', { path: join(dir, 'one.txt') });
  await assert.rejects(crew.answer(a.open!.id, { answer: 'allow', scope: 'forever' }), /once, for this task, or always/);
  await crew.answer(a.open!.id, { answer: 'allow', scope: 'task' });
  assert.equal(await a.held, undefined);
  a = await ask('write', { path: join(dir, 'two.txt') });
  assert.equal(a.open, undefined, 'the same folder in the same task goes through without asking');
  assert.equal(await a.held, undefined);
  assert.ok(db.get("SELECT 1 FROM events WHERE kind = 'run.allowed'"));

  a = await ask('read', { path: join(root, 'Elsewhere', 'b.txt') });
  await crew.answer(a.open!.id, { answer: 'allow', scope: 'always' });
  assert.deepEqual(crew.botPage('reel').allow, ['a folder outside your home'], 'the page shows what it covers in words');
  const trail = crew.botPage('reel').trail.map((e: any) => e.kind);
  assert.ok(trail.includes('bot.allowed') && trail.includes('ask.answered'));
  await release(crew, 'reel', 'ok');
  await settled(db, t);

  // A new task keeps "always" but not "for this task".
  const t2 = crew.assign('reel', 'ask permission again', 'chief').task;
  await holding(crew, 'reel');
  a = await ask('read', { path: join(root, 'Elsewhere', 'c.txt') });
  assert.equal(a.open, undefined);
  await a.held;
  a = await ask('write', { path: join(dir, 'three.txt') });
  assert.ok(a.open, 'task grants end with their task');
  await crew.answer(a.open!.id, { answer: 'deny' });
  assert.equal((await a.held).block, true);

  // Spending always asks: no standing answer covers it, and the card offers nothing wider than once.
  disk.setGrants(cfg, 'reel', ['files', 'people-search']);
  a = await ask('people_search', { args: ['call', 'apollo.people', '-H', 'X-Treg-Route-Max-Cost: 0.05'] });
  assert.equal(a.open.title, 'Reel wants to make a paid lookup with treg people search, up to $0.05.');
  assert.equal(crew.snapshot().asks[0].detail.spends, true);
  await assert.rejects(crew.answer(a.open!.id, { answer: 'allow', scope: 'always' }), /once, for this task, or always/);
  await crew.answer(a.open!.id, { answer: 'allow' });
  assert.equal(await a.held, undefined);
  a = await ask('people_search', { args: ['call', 'apollo.people', '-H', 'X-Treg-Route-Max-Cost: 0.05'] });
  assert.ok(a.open, 'and asks again next time');
  await crew.answer(a.open!.id, { answer: 'deny' });
  await a.held;
  // Taking "always" back on the Tools tab.
  disk.setSettings(cfg, 'reel', { allow: [] });
  assert.deepEqual(crew.botPage('reel').allow, []);
  await release(crew, 'reel');
  await settled(db, t2);
  done();
});


test('tool grants: a session gets only granted, installed tools; command-line tools run as typed calls', async () => {
  const { root, cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('tracer', 'Tracer', 'person');
  fakeBin(join(root, 'bin'), 'treg');
  const path = process.env.PATH;
  process.env.PATH = `${join(root, 'bin')}:${path}`; // treg here, gh not
  try {
    assert.throws(() => disk.setGrants(cfg, 'tracer', ['files', 'teleport']), /unknown tools: teleport/);
    disk.setGrants(cfg, 'tracer', ['files', 'web', 'people-search', 'github']);
    const gh: any = disk.botTools(cfg, 'tracer').find((t) => t.id === 'github');
    assert.deepEqual([gh.granted, 'howto' in gh, 'missing' in gh, 'install' in gh], [true, false, false, false], 'tools are described in words: no commands, paths or binary names');
    const t = crew.assign('tracer', `price it ${call('people_search', { args: ['catalog', 'search', 'phone'] })}`, 'chief').task;
    await settled(db, t);
    assert.match(task(db, t).result, /people_search said fake .*treg catalog search phone/, 'free calls run at once, with a fixed argv');
    const h = crew.assign('tracer', 'ask permission so I can look at the tools', 'chief').task;
    await holding(crew, 'tracer');
    const names = crew.sessionOf('tracer')!.getActiveToolNames();
    for (const n of ['read', 'write', 'edit', 'web_search', 'web_fetch', 'people_search', 'crew_deliver', 'crew_remember', 'crew_report']) assert.ok(names.includes(n), n);
    assert.equal(names.includes('github'), gh.ready, 'offered only where it is installed');
    assert.ok(!names.includes('crew_assign'), 'only Chief runs the crew');
    await release(crew, 'tracer');
    await settled(db, h);
    const card = disk.templateKit(cfg, disk.loadTemplate(cfg, 'scout'));
    assert.match(card.find((k) => k.id === 'browser')!.asks.join(), /payment page/);
    assert.ok(existsSync(join(disk.botDir(cfg, 'tracer'), 'skills', 'find-leads', 'SKILL.md')), 'library skills copied in');
    // No key or token ships with the template.
    for (const f of ['AGENTS.md', 'bot.json', 'skills/find-leads/SKILL.md']) assert.doesNotMatch(readFileSync(join(disk.botDir(cfg, 'tracer'), f), 'utf8'), /(sk|tk|tr)_[A-Za-z0-9]{16,}|X-Treg-Token:/);
  } finally {
    process.env.PATH = path;
    done();
  }
});

test('grant resolution: MCP browser from the pinned bin dir, missing tools listed, not offered', () => {
  const { root, cfg, crew, done } = setup();
  crew.recruit('scout', 'Scout', 'person');
  fakeBin(join(root, 'bin'), 'rg', 'jq');
  fakeBin(kit.toolBin(cfg), 'playwright-mcp', 'markitdown'); // as a pinned install leaves them
  const path = process.env.PATH;
  process.env.PATH = join(root, 'bin');
  try {
    const dir = disk.botDir(cfg, 'scout');
    const g = kit.resolveGrants(cfg, disk.botConfig(cfg, 'scout').tools, { 'bot.dir': dir, 'bot.id': 'scout' });
    assert.deepEqual(g.tools.sort(), ['browser', 'crew', 'documents', 'files', 'search-files', 'web']);
    assert.deepEqual(g.missing, ['computer', 'video-download'], 'granted but not installed: listed, not offered');
    assert.equal(g.mcp.browser.command, join(kit.toolBin(cfg), 'playwright-mcp'), 'pinned copy, absolute');
    assert.ok(g.mcp.browser.args.includes(`${dir}/browser`), "the bot's own profile");
    assert.equal(g.mcp.browser.env.PLAYWRIGHT_BROWSERS_PATH, join(cfg.toolsDir, 'browser', 'ms-playwright'));
  } finally {
    process.env.PATH = path;
    done();
  }
});

test('installs: pinned npm and checksummed download land in the tool folder; bad checksum keeps nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'crewhouse-kit-'));
  const payload = '#!/bin/sh\necho downloaded\n';
  const sha = createHash('sha256').update(payload).digest('hex');
  const srv = createServer((_q, r) => r.end(payload)).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const url = `http://127.0.0.1:${(srv.address() as any).port}/fake-dl`;
  const pkg = join(root, 'pkg');
  fakeBin(join(pkg, 'bin'), 'fake-npm');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'fake-npm', version: '1.0.0', bin: { 'fake-npm': 'bin/fake-npm' } }));
  const manifest = (id: string, install: object, bins: string[]) => {
    mkdirSync(join(root, 'repo', 'tools', id), { recursive: true });
    writeFileSync(join(root, 'repo', 'tools', id, 'tool.json'), JSON.stringify({ id, name: id, provides: '', kind: 'cli', bins, license: 'MIT', source: 'pinned', install, asks: [], allow: [] }));
  };
  manifest('npmtool', { npm: `file:${pkg}`, then: [['fake-npm']] }, ['fake-npm']);
  manifest('dltool', { download: { url, sha256: sha } }, ['fake-dl']);
  manifest('badtool', { download: { url, sha256: '0'.repeat(64) } }, ['fake-bad']);
  const cfg = { ...loadConfig(), repoDir: join(root, 'repo'), toolsDir: join(root, 'tools') };
  try {
    await kit.installTool(cfg, 'npmtool');
    await kit.installTool(cfg, 'dltool');
    await assert.rejects(kit.installTool(cfg, 'badtool'), /checksum mismatch/);
    assert.match(readlinkSync(join(kit.toolBin(cfg), 'fake-npm')), /npmtool\/node_modules\/\.bin\/fake-npm$/);
    assert.equal(readFileSync(join(kit.toolBin(cfg), 'fake-dl'), 'utf8'), payload);
    assert.ok(!existsSync(join(kit.toolBin(cfg), 'fake-bad')));
    const st = () => new Map(kit.toolStatus(cfg).map((t) => [t.id, t]));
    assert.equal(st().get('dltool')!.ready, true);
    assert.equal(st().get('badtool')!.ready, false);
    const logs: string[] = [];
    await kit.installTool(cfg, 'dltool', (l) => logs.push(l));
    assert.match(logs.join(), /already installed/);
    manifest('dltool', { download: { url: url + '?v=2', sha256: sha } }, ['fake-dl']); // Crewhouse moved the pin
    assert.equal(st().get('dltool')!.outdated, true);
    await assert.rejects(kit.installTool(cfg, 'nope'), /unknown tool/);
  } finally {
    srv.close();
  }
});

test('bots on disk: persona rename, capped notes, folder confinement, slugs', () => {
  const { cfg, crew, done } = setup();
  crew.recruit('reel', 'Frames', 'person');
  const dir = disk.botDir(cfg, 'frames');
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /^# Frames/);
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /You are Frames/);
  assert.ok(!existsSync(join(dir, 'CLAUDE.md')) && !existsSync(join(dir, '.claude')), 'no CLI wiring in a bot folder');
  assert.match(disk.systemPrompt(cfg, 'frames', false), /Your id in Crewhouse is frames\./);
  assert.throws(() => crew.recruit('reel', 'Frames', 'person'), /already a bot/);
  assert.throws(() => crew.recruit('chief', 'Deputy', 'person'), /only one Chief/);
  disk.remember(cfg, 'frames', 'Likes slow transitions');
  assert.throws(() => disk.remember(cfg, 'frames', 'x'.repeat(disk.NOTES_CAP)), /notes are full/);
  assert.equal(disk.readNotes(cfg, 'frames'), '- Likes slow transitions\n');
  assert.throws(() => disk.insideBot(cfg, 'frames', '../chief/notes.md'), /outside/);
  assert.equal(disk.slug('Ma Reel 2!'), 'ma-reel-2');
  assert.match(disk.addressLine('Umer'), /chosen name, "Umer", never as "sir"/);
  assert.equal(disk.addressLine("Ma'am"), 'Address the person as "ma\'am".');
  done();
});

test('accounts a bot thinks with: fallback order by name only, a per-task choice, no Claude', async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  assert.deepEqual(crew.thinks('reel').map((b) => b.name), ['ChatGPT']);
  assert.throws(() => disk.setBrains(cfg, 'reel', ['claude']), /not an AI account/, 'Claude is not offered');
  assert.throws(() => disk.setBrains(cfg, 'reel', ['chatgpt:$(rm -rf ~)']), /not an AI account/);
  assert.throws(() => disk.setBrains(cfg, 'reel', []), /at least one/);
  assert.deepEqual(disk.setBrains(cfg, 'reel', ['muse', 'chatgpt:gpt-5.5', 'muse']), ['muse', 'chatgpt:gpt-5.5']);
  assert.deepEqual(crew.thinks('reel'), [{ key: 'muse', name: 'Meta Muse', restingUntil: 0 }, { key: 'chatgpt', name: 'ChatGPT', restingUntil: 0 }], 'never a model id');
  assert.throws(() => crew.assign('reel', 'x', 'chief', 'pi'), /not an AI account/);

  const a = crew.assign('reel', 'rename 400 files', 'chief', 'chatgpt').task;
  await settled(db, a);
  assert.equal(task(db, a).state, 'done');
  const started = () => JSON.parse(db.get("SELECT data FROM events WHERE kind = 'run.started' ORDER BY seq DESC")!.data);
  assert.deepEqual([started().account, started().name], ['chatgpt', 'ChatGPT']);
  assert.match(lastSaid(db, 'reel'), /^stub reel: done/);
  const b = crew.assign('reel', 'judge which take is best', 'chief').task;
  await settled(db, b);
  assert.equal(started().account, 'muse', 'no per-task choice: the bot\'s first');
  done();
});

test('limits: a limit rests that account and the task carries on in the same conversation on the next; all resting pauses', async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  disk.setBrains(cfg, 'scout', ['chatgpt', 'muse']);
  assert.deepEqual(classify('You have hit your ChatGPT usage limit (plus plan). Try again in ~30 min.')?.why, 'rate_limit');
  assert.equal(classify('503 overloaded')?.why, 'overloaded');
  assert.equal(classify('401 Unauthorized')?.why, 'signed_out');
  assert.equal(classify('context window exceeded by your prompt'), null);

  const t = crew.assign('scout', 'dig deep, then hit the limit', 'chief').task;
  await settled(db, t);
  assert.equal(task(db, t).state, 'done');
  const until = crew.restingUntil('chatgpt');
  assert.ok(Math.abs(until - (Date.now() + 30 * 60_000)) < 5000, 'rests until the time the account said');
  const said = db.all("SELECT text FROM messages WHERE bot = 'scout' AND author = 'system'").map((m) => m.text);
  assert.ok(said.some((x) => /^ChatGPT is resting until \d+:\d\d [ap]m\. Scout carries on with Meta Muse\.$/.test(x)), said.join('\n'));
  assert.ok(db.get("SELECT 1 FROM events WHERE kind = 'run.resumed'"), 'the same session file, reopened');
  const file = task(db, t).session;
  assert.ok(file && readFileSync(file, 'utf8').includes('dig deep'), 'the conversation carried over');
  assert.equal(crew.snapshot().resting.chatgpt, until);

  // Everyone resting: the task pauses with a wake-up time, and resumes when it passes.
  (crew as any).rests.set('1:muse', Date.now() + 60_000);
  const b = crew.assign('scout', 'look it up again', 'chief').task;
  await settled(db, b);
  assert.equal(task(db, b).state, 'paused');
  assert.ok(Math.abs(task(db, b).wake_at - (Date.now() + 60_000)) < 1000, 'earliest reset: Muse in a minute, not ChatGPT in half an hour');
  assert.match(task(db, b).result, /All AI accounts are resting until \d+:\d\d [ap]m/);
  (crew as any).rests.clear();
  db.run('UPDATE tasks SET wake_at = ? WHERE id = ?', Date.now() - 1, b);
  crew.dispatch();
  await settled(db, b);
  assert.equal(task(db, b).state, 'done');

  // Signed out of every account it could use: it says so plainly, and no one else's account stands in.
  disk.setBrains(cfg, 'scout', ['grok']);
  const c = crew.assign('scout', 'one more', 'chief').task;
  await settled(db, c);
  assert.equal(task(db, c).state, 'failed');
  assert.equal(task(db, c).result, 'You have no Grok signed in yet. Sign in under Settings, AI accounts, then try again.');
  done();
});

test('take over: the bot pauses while the person drives; give back resumes it with their note', async () => {
  const { db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  const t = crew.assign('reel', 'ask permission to open the site', 'chief').task;
  await holding(crew, 'reel');
  assert.equal(await (crew as any).gate('reel', 'bash', { command: 'ls' }), undefined, 'the bot acts freely while it has the controls');

  await crew.takeOver('reel');
  assert.equal(crew.snapshot().bots.find((b: any) => b.id === 'reel')?.controls, 'person');
  await until('stopped', () => !crew.sessionOf('reel')!.isStreaming);
  const deny = await (crew as any).gate('reel', 'bash', { command: 'ls' });
  assert.equal(deny.block, true);
  assert.match(deny.reason, /person has the controls/);
  assert.equal(task(db, t).state, 'working', 'a turn cut short by Take over does not end the task');
  const next = crew.assign('reel', 'second job', 'chief').task;
  crew.dispatch();
  assert.equal(task(db, next).state, 'queued', 'no new work starts while the person drives');

  await crew.giveBack('reel', 'signed you in to example.com');
  await settled(db, next);
  assert.equal(task(db, t).state, 'done', 'the resumed turn finishes the task');
  assert.match(readFileSync(task(db, t).session, 'utf8'), /given them back\. What they did: signed you in to example\.com\./, 'the resume prompt carries the note');
  assert.equal(task(db, next).state, 'done', 'then the queue moves again');
  assert.ok(db.get("SELECT 1 FROM messages WHERE bot = 'reel' AND text = 'You gave the controls back: signed you in to example.com'"));
  await assert.rejects(crew.giveBack('reel'), /already has the controls/);
  done();
});

test('steer: a word from the person reaches the bot mid-task without starting over', async () => {
  const { db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  assert.throws(() => crew.steer('reel', 'faster'), /isn't working on anything/);
  const t = crew.assign('reel', 'ask permission to render', 'chief').task;
  await holding(crew, 'reel');
  crew.steer('reel', 'make it faster');
  await release(crew, 'reel');
  await settled(db, t);
  assert.ok(db.get("SELECT 1 FROM messages WHERE bot = 'reel' AND author = 'person' AND text = 'make it faster'"));
  assert.ok(readFileSync(task(db, t).session, 'utf8').includes('make it faster'), 'it went into the same conversation');
  done();
});

test('home facts: ideas only from ready tools, stuck after quiet, memory switch', async () => {
  const { cfg, crew, db, done } = setup();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  const path = process.env.PATH;
  process.env.PATH = '/nonexistent'; // markitdown absent: its promise is not made
  try {
    const ideas = crew.snapshot().ideas;
    assert.ok(ideas.some((i: any) => i.bot === 'scout' && /sources/.test(i.promise)), 'web is built in');
    assert.ok(!ideas.some((i: any) => /PDF/.test(i.promise)), 'no idea for a tool that is missing here');
  } finally { process.env.PATH = path; }
  disk.setGrants(cfg, 'scout', ['files']);
  assert.equal(crew.snapshot().ideas.length, 0, 'no idea for a tool that is not granted');

  disk.remember(cfg, 'scout', 'Prefers short answers');
  const t = crew.assign('scout', 'ask permission to look', 'chief').task;
  await holding(crew, 'scout');
  assert.equal(crew.snapshot().bots.find((b: any) => b.id === 'scout')?.stuck, false);
  db.run('UPDATE events SET at = at - 10000');
  assert.equal(crew.snapshot().bots.find((b: any) => b.id === 'scout')?.stuck, true, 'quiet past the limit reads as stuck');
  assert.match(JSON.stringify(crew.sessionOf('scout')!.messages), /Prefers short answers/, 'notes are read at the start of the task');
  await release(crew, 'scout');
  await settled(db, t);

  disk.setSettings(cfg, 'scout', { memory: false });
  assert.throws(() => disk.remember(cfg, 'scout', 'likes tea'), /memory is off/);
  const u = crew.assign('scout', 'another look', 'chief').task;
  await settled(db, u);
  assert.doesNotMatch(readFileSync(task(db, u).session, 'utf8'), /Prefers short answers|When you finish/, 'memory off: notes are neither loaded nor asked for');
  assert.throws(() => disk.setSettings(cfg, 'scout', { memory: 'yes' }), /on or off/);
  done();
});


test('household: bots and tasks belong to a member and run on that member\'s own sign-ins, never anyone else\'s', async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  const sam = crew.addMember('Sam').id;
  assert.throws(() => crew.addMember('sam'), /already here/);
  // Each person has their own credential file under Crewhouse's folders, the owner too.
  assert.equal(crew.accounts.authPath(OWNER), join(cfg.stateDir, 'people', '1', 'engine', 'auth.json'));
  assert.equal(crew.accounts.authPath(sam), join(cfg.stateDir, 'people', String(sam), 'engine', 'auth.json'));
  assert.notEqual(await crew.accounts.runtime(sam), await crew.accounts.runtime(OWNER));

  // Sam meets Chief in their own thread; the owner's conversation isn't in it.
  assert.match(crew.botPage('chief', sam).messages.map((m: any) => m.text).join('\n'), /how would you like me to address you/);
  assert.ok(!crew.botPage('chief', sam).messages.some((m: any) => m.text === 'sir'));
  crew.post('chief', 'Sam', undefined, sam);
  assert.equal(crew.member(sam).address, 'Sam');
  assert.equal(crew.member(OWNER).address, 'sir', 'each person keeps their own form of address');

  // Only Sam signs in to Grok: Sam's Grok task runs, the owner's can't borrow it.
  disk.setBrains(cfg, 'reel', ['grok']);
  await crew.accounts.login(sam, 'grok');
  await until('Sam signed in', () => crew.accounts.view(sam, 'grok')?.state === 'done');
  assert.ok(existsSync(crew.accounts.authPath(sam)));
  const a = crew.post('reel', 'a demo for Sam', undefined, sam)!.task;
  await settled(db, a);
  assert.equal(task(db, a).state, 'done');
  assert.equal(JSON.parse(db.get("SELECT data FROM events WHERE kind = 'run.started' ORDER BY seq DESC")!.data).member, sam);
  assert.match(readFileSync(task(db, a).session, 'utf8'), /task #\d+ from Sam\]/);
  assert.match(readFileSync(task(db, a).session, 'utf8'), /chosen name, \\"Sam\\"/);
  const b = crew.post('reel', 'owner demo', undefined, OWNER)!.task;
  await settled(db, b);
  assert.equal(task(db, b).state, 'failed', 'the owner never borrows Sam\'s account');
  assert.ok(crew.botPage('reel', sam).messages.some((m: any) => m.text === 'a demo for Sam'));
  assert.ok(!crew.botPage('reel', OWNER).messages.some((m: any) => m.text === 'a demo for Sam'), 'threads are per person');

  // Chief works for whoever asked him: what he recruits and hands over is theirs, on their accounts.
  const c = crew.post('chief', 'ask permission to find me a researcher', undefined, sam)!.task;
  await holding(crew, 'chief');
  assert.equal(task(db, c).member, sam);
  assert.equal(crew.recruit('scout', 'Scout', 'chief').member, sam);
  const d = crew.assign('scout', 'look it up', 'chief').task;
  await settled(db, d);
  assert.equal(task(db, d).member, sam);
  await release(crew, 'chief', 'Scout is on it.');

  // One person's limit rests only their own account.
  disk.setBrains(cfg, 'reel', ['chatgpt']);
  (crew as any).rests.set(`${sam}:chatgpt`, Date.now() + 60_000);
  assert.equal(crew.restingUntil('chatgpt', OWNER), 0);
  const e = crew.post('reel', 'another for Sam', undefined, sam)!.task;
  const f = crew.post('scout', 'owner lookup', undefined, OWNER)!.task;
  await settled(db, e);
  await settled(db, f);
  assert.equal(task(db, e).state, 'paused');
  assert.match(task(db, e).result, /All Sam's AI accounts are resting/);
  assert.equal(task(db, f).state, 'done');

  // What each person sees: their own tasks and questions, their own accounts.
  assert.deepEqual(crew.snapshot(sam).tasks.map((t: any) => t.id).sort(), [a, d, e].sort());
  assert.ok(crew.snapshot(sam).resting.chatgpt > 0);
  assert.equal(crew.snapshot(OWNER).resting.chatgpt, undefined);
  done();
});

test('household: quiet hours park questions at once; settings validate', async () => {
  const { root, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  assert.equal(quietNow('22:00-07:00', new Date(2026, 0, 1, 23, 30)), true);
  assert.equal(quietNow('22:00-07:00', new Date(2026, 0, 1, 6, 59)), true);
  assert.equal(quietNow('22:00-07:00', new Date(2026, 0, 1, 7, 0)), false);
  assert.equal(quietNow('13:00-14:00', new Date(2026, 0, 1, 13, 15)), true);
  assert.equal(quietNow(null), false);
  assert.throws(() => crew.updateMember(1, { quiet: '10pm-7am' }), /22:00-07:00/);
  assert.throws(() => crew.updateMember(1, { name: '  ' }), /name/);
  assert.equal(crew.updateMember(1, { name: 'Alex', quiet: '00:00-23:59' }).name, 'Alex');

  const started = Date.now();
  const t = crew.post('reel', `copy it ${call('write', { path: join(root, 'elsewhere', 'b.txt'), content: 'x' })}`, undefined, 1)!.task;
  await until('parked', () => db.get("SELECT 1 FROM events WHERE kind = 'ask.parked'"));
  assert.ok(Date.now() - started < 3000, 'no hold while they sleep');
  assert.equal(task(db, t).state, 'needs_you');
  assert.equal(crew.snapshot(1).asks.length, 1, 'the question waits for the morning');
  assert.equal(crew.snapshot(crew.addMember('Sam').id).asks.length, 0, 'and only for them');
  crew.updateMember(1, { quiet: null });
  done();
});

/** Stop crewd and start a new one on the same database: the engine sessions die with it, their files stay. */
async function restart(s: ReturnType<typeof setup>) {
  s.crew.stop();
  const { Crew } = await import('../src/crew.ts');
  const crew = new Crew(s.cfg, s.db);
  crew.init();
  return crew;
}

test('restart: a running task continues in its own session, from its session file', async () => {
  const s = setup();
  s.crew.onboard('sir');
  s.crew.recruit('reel', 'Reel', 'person');
  // Its session file exists once the model has said something: here, the tool call before the held reply.
  const t = s.crew.assign('reel', `ask permission after ${call('write', { path: 'work/a.txt', content: 'x' })}`, 'chief').task;
  await holding(s.crew, 'reel');
  const file = task(s.db, t).session;
  assert.ok(existsSync(file));
  const crew = await restart(s);
  try {
    await settled(s.db, t);
    assert.equal(task(s.db, t).state, 'done');
    assert.equal(task(s.db, t).session, file, 'the same session');
    assert.ok(s.db.get("SELECT 1 FROM events WHERE kind = 'system.recovered'"));
    assert.ok(s.db.get("SELECT 1 FROM events WHERE kind = 'run.resumed'"));
    const log = readFileSync(file, 'utf8');
    assert.ok(log.includes('ask permission after') && log.includes('Continue task #'), 'one conversation: the task, then the resume');
    assert.equal(s.db.all("SELECT 1 FROM messages WHERE bot = 'reel' AND author = 'system' AND text LIKE '%restarted%'").length, 0, 'a restart is a non-event for the person');
  } finally { crew.stop(); s.done(); }
});

test('restart: a parked question stays open, and its answer reaches the resumed session', async () => {
  const s = setup();
  s.crew.onboard('sir');
  s.crew.recruit('reel', 'Reel', 'person');
  const outside = join(s.root, 'elsewhere', 'c.txt');
  const t = s.crew.assign('reel', `copy it ${call('write', { path: outside, content: 'kept' })}`, 'chief').task;
  await until('parked', () => s.db.get("SELECT 1 FROM events WHERE kind = 'ask.parked'"));
  const crew = await restart(s);
  try {
    await until('resumed and waiting', () => task(s.db, t).state === 'needs_you' && s.db.get("SELECT 1 FROM events WHERE kind = 'run.resumed'"));
    const ask = s.db.get("SELECT * FROM asks WHERE state = 'open'")!;
    await crew.answer(ask.id, { answer: 'allow' });
    await settled(s.db, t);
    assert.equal(task(s.db, t).state, 'done');
    assert.match(readFileSync(task(s.db, t).session, 'utf8'), /has answered your request/);
  } finally { crew.stop(); s.done(); }
});


/** A Grok that fails its sign-in the given way, on one member's runtime (the engine's real login path, a scripted provider). */
async function grokThat(crew: any, member: number, login: (i: any) => Promise<any>) {
  const rt = await crew.accounts.runtime(member);
  const base = rt.getProvider('xai');
  rt.registerNativeProvider(createProvider({
    id: 'xai', name: 'Grok', models: base.getModels(),
    auth: { oauth: { name: 'Grok', login, refresh: async (c: any) => c, toAuth: async () => ({}) } },
    api: { stream: base.stream, streamSimple: base.streamSimple },
  } as any));
}
const cred = { type: 'oauth', access: 'a', refresh: 'r', expires: Date.now() + 86_400_000 };

test('sign-in: one button shows a code or a link, finishes by itself, keeps the sign-in in that person\'s own file; sign out', async () => {
  const { db, crew, done } = setup();
  assert.equal(await crew.accounts.signedIn(OWNER, 'grok'), false);
  await crew.accounts.login(OWNER, 'grok', { via: 'code' });
  const view = crew.accounts.view(OWNER, 'grok')!;
  assert.equal(view.state, 'done');
  await until('the account change reached the app', () => db.get("SELECT 1 FROM events WHERE kind = 'account.changed'"));
  assert.equal(await crew.accounts.signedIn(OWNER, 'grok'), true);
  assert.equal(await crew.accounts.signedIn(crew.addMember('Sam').id, 'grok'), false, 'one person\'s sign-in is theirs alone');
  await crew.accounts.logout(OWNER, 'grok');
  assert.equal(await crew.accounts.signedIn(OWNER, 'grok'), false);
  await assert.rejects(crew.accounts.login(OWNER, 'gemini'), /Paste your Gemini key first/);
  await assert.rejects(crew.accounts.login(OWNER, 'claude'), /no such AI account/);

  // While it waits: the code and the page, nothing else.
  let go!: () => void;
  await grokThat(crew, OWNER, async (i) => { i.notify({ type: 'device_code', userCode: 'WB60-FFVO', verificationUri: 'https://accounts.x.ai/device' }); await new Promise<void>((r) => (go = r)); return cred; });
  const p = crew.accounts.login(OWNER, 'grok');
  await until('code', () => crew.accounts.view(OWNER, 'grok')?.code);
  assert.deepEqual(crew.accounts.view(OWNER, 'grok'), { state: 'waiting', code: 'WB60-FFVO', url: 'https://accounts.x.ai/device', error: undefined });
  go();
  await p;
  assert.equal(crew.accounts.view(OWNER, 'grok')!.state, 'done');
  done();
});

test('sign-in failures: expired, declined, offline, stalled and cancelled all end signed out with one next step', async () => {
  const { crew, done } = setup();
  const fails = async (login: (i: any) => Promise<any>) => {
    await grokThat(crew, OWNER, login);
    await crew.accounts.login(OWNER, 'grok');
    const v = crew.accounts.view(OWNER, 'grok')!;
    assert.equal(await crew.accounts.signedIn(OWNER, 'grok'), false, 'never half signed in');
    return v;
  };
  assert.deepEqual(await fails(async () => { throw new Error('expired_token'); }),
    { state: 'failed', url: undefined, code: undefined, error: 'The code expired before it was used. Tap Sign in with Grok for a new one.' });
  assert.equal((await fails(async () => { throw new Error('access_denied'); })).error, 'The sign-in was declined on the Grok page. Tap Sign in with Grok to try again.');
  assert.equal((await fails(async () => { throw new TypeError('fetch failed'); })).error, "Couldn't reach Grok. Check the internet connection, then tap Sign in again.");
  // A flow that stalls past the limit is stopped.
  const stalled = await fails((i) => new Promise((_r, reject) => i.signal.addEventListener('abort', () => reject(new Error('aborted')))));
  assert.equal(stalled.error, 'The sign-in took too long. Tap Sign in with Grok to start again.');
  // Cancel: nothing kept, nothing shown.
  await grokThat(crew, OWNER, (i) => new Promise((_r, reject) => i.signal.addEventListener('abort', () => reject(new Error('aborted')))));
  const p = crew.accounts.login(OWNER, 'grok');
  await sleep(20);
  crew.accounts.cancel(OWNER, 'grok');
  await p;
  assert.equal(crew.accounts.view(OWNER, 'grok'), null);
  assert.equal(await crew.accounts.signedIn(OWNER, 'grok'), false);
  // And a retry after any of these works first time.
  await grokThat(crew, OWNER, async () => cred);
  await crew.accounts.login(OWNER, 'grok');
  assert.equal(crew.accounts.view(OWNER, 'grok')!.state, 'done');
  assert.equal(signInError('Gemini', '400 API key not valid, invalid', true), "Gemini didn't accept that key. Copy it again and paste it here.");
  done();
});

test('sign-in: a browser sign-in that cannot come back falls back to a code by itself', async () => {
  const { crew, done } = setup();
  const tries: string[] = [];
  await grokThat(crew, OWNER, async (i) => {
    const how = await i.prompt({ type: 'select', message: 'How?', options: [{ id: 'browser', label: 'Browser' }, { id: 'device_code', label: 'Code' }] });
    tries.push(how);
    if (how === 'browser') throw new Error('listen EADDRINUSE: address already in use 127.0.0.1:1455');
    i.notify({ type: 'device_code', userCode: 'AB12-CD34', verificationUri: 'https://example.test/device' });
    return cred;
  });
  await crew.accounts.login(OWNER, 'grok');
  assert.deepEqual(tries, ['browser', 'device_code']);
  assert.equal(crew.accounts.view(OWNER, 'grok')!.state, 'done');
  done();
});

test('sign-in: a lapsed sign-in is found in the background and said once, in plain words', async () => {
  const { db, crew, done } = setup();
  crew.onboard('sir');
  await grokThat(crew, OWNER, async () => cred);
  await crew.accounts.login(OWNER, 'grok');
  const rt: any = await crew.accounts.runtime(OWNER);
  rt.getAuth = async () => { throw new Error('invalid_grant: refresh token revoked'); };
  await crew.accounts.keepFresh([OWNER], Date.now() + 3_600_000);
  assert.ok(crew.accounts.unready(OWNER, 'grok'));
  assert.match(db.get("SELECT text FROM messages WHERE bot = 'chief' ORDER BY id DESC")!.text, /Your Grok sign-in has run out\. Sign in again under Settings, AI accounts/);
  done();
});

