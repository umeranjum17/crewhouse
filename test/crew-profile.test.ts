// Slice 1 of the crew brain: one shared "About me and my work" record per install,
// in every helper's job context through the single prompt() path. Stub engine, no quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { setup, settled } from './lab.ts';
import * as disk from '../src/bots.ts';
import { startServer } from '../src/server.ts';
import * as A from '../web/src/adapter.ts';

const VOICE = 'I am a solo ops consultant. I write short, plain sentences for busy agency founders. ' +
  'I sell a weekly ops review. Past work: inbox-zero crews for two design studios.';

// Minimal marketplace page + skill files for one imported helper (contract from import-grok.test.ts).
const blob = (o: unknown) => '\\"template\\":{' + JSON.stringify(o).replace(/"/g, '\\"').slice(1) + '},\\"featured\\":false';
const page = (o: unknown) => `<html><body><ul><li><p class="text-primary text-sm leading-6 whitespace-pre-wrap">I am Testy the prospector.</p></li></ul><script>${blob(o)}</script></body></html>`;
const recipe = () => ({ id: 'tb', name: 'Testy Prospecting', creatorName: 'Grok Team', handle: 'grokteam', description: 'Finds prospects.', summary: 'Prospecting.', categories: ['Sales'], installCount: 0, color: 'magenta', shape: 'pebble', addHref: '/bot/share1', imageUrl: '', instructions: '', memories: [],
  skills: [{ id: 'skill-0', name: 'Getting started', description: 'Use to start.', content: 'Ask what they sell and who buys it.' }], routines: [], integrations: [] });
const SKILL_MD = `---\nname: test-skill\ndescription: Make tiny web toys. Use when the person asks for a small interactive page.\nlicense: Complete terms in LICENSE.txt\n---\n\nBuild it.\n`;
const APACHE = 'Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/LICENSE-2.0\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION';
const stubImportFetch = () => { (globalThis as any).fetch = async (url: string) => {
  const file = String(url).split('/').at(-1) ?? '';
  const hit: Record<string, string> = { 'SKILL.md': SKILL_MD, 'LICENSE.txt': APACHE };
  const body = file in hit ? hit[file] : page(recipe());
  return { ok: true, status: 200, text: async () => body, arrayBuffer: async () => Buffer.from(body) };
}; };

test('the profile stores once per install and refuses over-cap text', async () => {
  const { cfg, done } = setup();
  assert.equal(disk.readProfile(cfg), '', 'empty until the person sets it');
  disk.writeProfile(cfg, VOICE);
  assert.equal(disk.readProfile(cfg).trim(), VOICE);
  assert.throws(() => disk.writeProfile(cfg, 'x'.repeat(disk.PROFILE_CAP + 1)), /longer than 4000 characters/);
  done();
});

test('chief, a built-in and an imported helper carry the record in the job context', async () => {
  const { crew, cfg, db, done } = setup();
  crew.onboard('Umer');
  crew.recruit('scribe', 'Scribe', 'person');
  const realFetch = (globalThis as any).fetch;
  stubImportFetch();
  try { await (crew as any).importGrok('tb'); } finally { (globalThis as any).fetch = realFetch; }
  assert.ok((crew as any).bot('testy-prospecting'), 'the imported helper joined the crew');
  disk.writeProfile(cfg, VOICE);
  for (const bot of ['chief', 'scribe', 'testy-prospecting']) {
    const { task } = (crew as any).addTask(bot, 'Write one line, then stop.', 'person', undefined, undefined, 'Write one line.', [], {});
    await settled(db, task);
    const session = db.get('SELECT session FROM tasks WHERE id = ?', task)?.session;
    const message = String((crew.runtime as any).specOf(session)?.message ?? '');
    assert.match(message, /About me and my work/, `${bot} sees the record section`);
    assert.match(message, /solo ops consultant/, `${bot} sees the voice`);
    assert.match(message, /agency founders/, `${bot} sees the audience`);
  }
  done();
});

test('marketing recruitment and assignments carry the bakery profile and Chief’s campaign skill', async () => {
  const { crew, cfg, db, done } = setup();
  cfg.port = 0; cfg.host = '127.0.0.1'; cfg.linkPort = 0;
  const server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (path: string, body: object, method = 'POST') => {
    const res = await fetch(base + path, { method, headers: { 'x-crewhouse': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 200);
    return res.json();
  };
  try {
    await api('/api/onboard', { address: 'Umer' });
    await api('/api/profile', { text: 'I run Morning Loaf bakery. My audience is local families. My voice is warm and plain.' }, 'PUT');
    const request = await api('/api/bots/chief/messages', { text: 'help me market my bakery' });
    await settled(db, request.task);
    const spec = (crew.runtime as any).specOf(db.get('SELECT session FROM tasks WHERE id = ?', request.task)!.session);
    assert.match(spec.system, /run-a-marketing-campaign/, 'a plain request presents the campaign skill to Chief');
    assert.match(readFileSync(join(disk.botDir(cfg, 'chief'), 'skills/run-a-marketing-campaign/SKILL.md'), 'utf8'), /crew_recruit/);
    // Script the model decisions, but exercise real HTTP, recruitment, queueing and profile injection.
    const call = (name: string, input: object) => `[tool ${name} ${JSON.stringify(input).replace(/\[tool/g, '[t\\u006fol')}]`; // nested helper scripts are JSON, not Chief calls
    const read = await api('/api/bots/chief/messages', { text: call('crew_read', { path: 'skills/run-a-marketing-campaign/SKILL.md' }) });
    await settled(db, read.task);
    assert.equal(db.all('SELECT * FROM asks WHERE task_id = ?', read.task).length, 0, 'Chief reads its own skill without asking');
    const readCall = db.get("SELECT data FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') = ?", read.task)!;
    assert.equal(JSON.parse(readCall.data).ok, true);
    assert.match(JSON.parse(readCall.data).head, /---/);
    for (const [name, input] of [['crew_write', { path: 'files/forbidden.md', content: 'No' }], ['crew_edit', { path: 'soul.md', old: '# Chief', new: '# Other' }], ['bash', { command: 'touch files/forbidden.md' }]] as const) {
      const denied = await api('/api/bots/chief/messages', { text: call(name, input) });
      await settled(db, denied.task);
      const message = crew.botPage('chief').messages.find((m) => m.task_id === denied.task && m.author === 'bot')!;
      assert.match(message.text, /does not have that tool/, `Chief has no ${name} grant`);
    }
    assert.equal(existsSync(join(disk.botDir(cfg, 'chief'), 'files/forbidden.md')), false);
    assert.match(readFileSync(join(disk.botDir(cfg, 'chief'), 'soul.md'), 'utf8'), /# Chief/);
    const recruits = await api('/api/bots/chief/messages', { text: ['scout', 'scribe', 'reel'].map((template) => call('crew_recruit', { template })).join(' ') });
    await settled(db, recruits.task);
    const parts = { scout: 'Research two local bakery campaign ideas with sources.', scribe: 'Write two bakery post drafts only.', reel: 'Make one bakery poster draft only.' };
    const assigns = await api('/api/bots/chief/messages', { text: Object.entries(parts).map(([bot, task]) => call('crew_assign', { bot, task })).join(' ') });
    await settled(db, assigns.task);
    for (const [bot, body] of Object.entries(parts)) {
      const task = db.get('SELECT * FROM tasks WHERE bot = ? AND body = ?', bot, body)!;
      assert.ok(task, `${bot} has its campaign part`);
      await settled(db, task.id);
      assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', task.id)!.state, 'done');
      assert.match((crew.runtime as any).specOf(task.session).message, /Morning Loaf bakery/, `${bot} reads the shared profile`);
    }
    // The marketing journey uses one existing draft, handed to Chief by the app, after every part finishes.
    const body = 'Facebook\nWarm bread for a family weekend.\nCome say hello at Morning Loaf.\n\nInstagram\n#MorningLoaf\nA small bakery welcome for local families.';
    writeFileSync(join(disk.botDir(cfg, 'reel'), 'files/poster.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=', 'base64'));
    for (const answer of ['deny', 'allow']) {
      const path = `files/campaign-${answer}.txt`;
      const bodies = { scout: 'Research the bakery campaign.', scribe: call('crew_write', { path, content: body }) + ' ' + call('crew_deliver', { path, note: 'Both campaign posts' }) + ' ' + call('crew_draft', { path, channel: 'post', to: 'Facebook and Instagram' }), reel: call('crew_deliver', { path: 'files/poster.png', note: 'Morning Loaf poster' }) };
      const campaign = await api('/api/bots/chief/messages', { text: Object.entries(bodies).map(([bot, task]) => call('crew_assign', { bot, task })).join(' ') });
      await settled(db, campaign.task);
      for (const part of db.all('SELECT id FROM tasks WHERE parent = ?', campaign.task)) await settled(db, part.id);
      const state = await (await fetch(base + '/api/state')).json();
      assert.equal(state.asks.length, 1, 'one existing draft card for both posts');
      const card = A.cards(state)[0];
      assert.equal(card.helper, 'chief', 'the person decides only through Chief');
      assert.deepEqual(card.choices.map((c) => c.label), ['Approve', 'Not now']);
      assert.equal(card.preview?.body, body, 'both exact post bodies and channel headings survive');
      assert.equal(card.campaign?.poster?.url, '/files/reel/poster.png');
      assert.equal(A.office(state).crew.find((h) => h.id === 'scribe')?.ask, undefined, 'no helper Needs-you badge for a draft');
      await api(`/api/asks/${card.id}/answer`, { answer });
      const after = await (await fetch(base + '/api/state')).json();
      assert.equal(A.cards(after).length, 0, 'the approval card closes');
      const outcome = A.campaignOutcomes(after).at(-1)!;
      assert.equal(outcome.approved, answer === 'allow');
      assert.equal(outcome.source.path, path, 'an approved copy comes from the exact reviewed file, not the truncated receipt');
      assert.equal(db.all("SELECT * FROM events WHERE kind = 'run.call' AND json_extract(data, '$.tool') IN ('crew_copy', 'browser', 'crew_app') AND json_extract(data, '$.task') IN (SELECT id FROM tasks WHERE root = ?)", campaign.task).length, 0, 'neither answer posts, sends or copies');
    }
    const outside = join(cfg.crewDir, 'outside-chief.txt');
    writeFileSync(outside, 'Private fixture, never read without permission.');
    const parked = await api('/api/bots/chief/messages', { text: call('crew_read', { path: outside }) });
    await settled(db, parked.task);
    const ask = db.get("SELECT * FROM asks WHERE task_id = ? AND state = 'open'", parked.task)!;
    assert.ok(ask, 'a Chief read outside its folder still asks the person');
    assert.equal(JSON.parse(ask.detail).effect, 'files');
    assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', parked.task)!.state, 'needs_you');
    assert.equal(db.all("SELECT * FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') = ?", parked.task).length, 0, 'the unapproved outside read never executed');
  } finally {
    await new Promise<void>((r, reject) => server.close((e) => e ? reject(e) : r()));
    done();
  }
});

test('an empty record adds nothing; a full-length one stays inside a stated prompt budget', async () => {
  const { crew, cfg, db, done } = setup();
  crew.onboard('Umer');
  crew.recruit('scribe', 'Scribe', 'person');
  const promptOf = () => (crew as any).prompt({ id: 1, bot: 'scribe', body: 'Hi.', origin: 'person', routine: null });
  assert.doesNotMatch(promptOf(), /About me and my work/, 'empty record adds nothing');
  disk.writeProfile(cfg, 'v '.repeat(2000).slice(0, disk.PROFILE_CAP));
  const full = promptOf();
  assert.match(full, /About me and my work/, 'a full record is carried whole, never a silent slice');
  assert.ok(full.length < 30_000, `measured prompt ${full.length} chars stays inside the stated 30k budget`);
  done();
});

test('the record reads and writes through crewd’s API', async () => {
  const { cfg, db, crew, done } = setup();
  cfg.port = 0; cfg.host = '127.0.0.1'; cfg.linkPort = 0;
  const server = await startServer(cfg, db, crew);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const api = async (method: string, path: string, body?: object) => {
      const res = await fetch(base + path, { method, headers: { 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    assert.equal((await api('GET', '/api/profile')).body.text, '');
    const save = async (text: string, fact: string) => {
      const reply = await api('POST', '/api/bots/chief/messages', { text: `${fact} [tool crew_profile ${JSON.stringify({ text })}]` });
      await settled(db, reply.body.task);
    };
    const first = await api('POST', '/api/onboard', { address: 'Umer', ask: `I run a bakery. [tool crew_profile ${JSON.stringify({ text: 'I run a bakery.' })}]` });
    await settled(db, first.body.task);
    assert.equal((await api('GET', '/api/profile')).body.text.trim(), 'I run a bakery.', 'onboarding reaches the shared record');
    await save('I run a bakery. My audience is local families.', 'My audience is local families.');
    assert.equal((await api('GET', '/api/profile')).body.text.trim(), 'I run a bakery. My audience is local families.', 'chat facts merge with onboarding');
    await save('x'.repeat(disk.PROFILE_CAP + 1), 'My tone is warm.');
    assert.equal((await api('GET', '/api/profile')).body.text.trim(), 'I run a bakery. My audience is local families.', 'over-cap saves preserve the record');
    assert.equal((await api('PUT', '/api/profile', { text: VOICE })).status, 200);
    const back = await api('GET', '/api/profile');
    assert.equal(back.body.text.trim(), VOICE);
    assert.equal(back.body.cap, disk.PROFILE_CAP);
    assert.equal((await api('PUT', '/api/profile', { text: 'x'.repeat(disk.PROFILE_CAP + 1) })).status, 400);
  } finally {
    await new Promise<void>((r, reject) => server.close((e) => e ? reject(e) : r()));
    done();
  }
});
