// Slice 1 of the crew brain: one shared "About me and my work" record per install,
// in every helper's job context through the single prompt() path. Stub engine, no quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { setup, settled } from './lab.ts';
import * as disk from '../src/bots.ts';
import { startServer } from '../src/server.ts';

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
