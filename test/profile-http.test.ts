// Real HTTP profile writes on synthetic stub crews; no accounts or external services.
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
const { setup } = await import('./lab.ts');
const { startServer } = await import('../src/server.ts');
const { Store } = await import('../src/db.ts');
const { Crew } = await import('../src/crew.ts');
const disk = await import('../src/bots.ts');

for (const [label, fields] of Object.entries({
  'quiet-only': { quiet: 'invalid' },
  quiet: { name: 'ShouldNotPersist', quiet: 'invalid' },
  share: { name: 'ShouldNotPersist', quiet: '21:00-06:00', share: 'invalid' },
  address: { name: 'ShouldNotPersist', quiet: '21:00-06:00', share: 'full', address: '   ' },
  name: { name: '   ', quiet: '21:00-06:00', share: 'full', address: 'Changed' },
  valid: { name: '  Alex  ', quiet: '21:00-06:00', share: 'full', address: '  Friend  ' },
})) test(`profile HTTP: ${label} mixed-field update survives reload consistently`, async (t) => {
  const { cfg, db, crew, done } = setup();
  cfg.port = 0;
  cfg.host = '127.0.0.1';
  cfg.linkPort = 0;
  const server = await startServer(cfg, db, crew);
  t.after(async () => { if (server.listening) await new Promise<void>((r, reject) => server.close((e) => e ? reject(e) : r())); done(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (method: string, path: string, body?: object) => {
    const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`, 'x-crewhouse': '1', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await api('POST', '/api/onboard', { address: 'Original' })).status, 200);
  const before = (await api('GET', '/api/state')).body.person;
  const row = db.get('SELECT * FROM people WHERE id = 1');
  const events = db.events();
  const seen: unknown[] = [];
  const off = db.onEvent((e) => { if (e.kind.startsWith('person.')) seen.push({ ...crew.person() }); });
  t.after(off);
  const result = await api('PUT', '/api/people/1', fields);
  assert.equal(result.status, label === 'valid' ? 200 : 400);
  const after = (await api('GET', '/api/state')).body.person;
  const savedRow = db.get('SELECT * FROM people WHERE id = 1');
  const savedEvents = db.events();
  const added = db.events(events.at(-1)!.seq);
  const savedPerson = { ...crew.person() };
  await new Promise<void>((r, reject) => server.close((e) => e ? reject(e) : r()));
  done();
  const persisted = new Store(cfg.stateDir);
  const reloaded = new Crew(cfg, persisted);
  reloaded.init();
  const reloadServer = await startServer(cfg, persisted, reloaded);
  try {
    const res = await fetch(`http://127.0.0.1:${(reloadServer.address() as AddressInfo).port}/api/state`, { headers: { authorization: `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`, 'x-crewhouse': '1' } });
    assert.equal(res.status, 200);
    const reopened = (await res.json()).person;
    console.log(JSON.stringify({ label, status: result.status, before, after, reopened, eventsAdded: added.length }));
    assert.deepEqual(reopened, after, 'HTTP state rereads the persisted profile');
  } finally {
    await new Promise<void>((r, reject) => reloadServer.close((e) => e ? reject(e) : r()));
    reloaded.stop(); persisted.close();
  }
  if (label === 'valid') {
    assert.deepEqual({ name: after.name, quiet: after.quiet, share: after.share, address: after.address },
      { name: 'Alex', quiet: '21:00-06:00', share: 'full', address: 'Friend' });
    assert.deepEqual(added.map((e) => e.kind), ['person.onboarded', 'person.updated']);
    assert.equal(seen.length, 2);
    for (const person of seen) assert.deepEqual(person, savedPerson, 'event listeners see every field committed');
  } else {
    assert.deepEqual(after, before, 'HTTP state is unchanged');
    assert.deepEqual(savedRow, row, 'every persisted field is unchanged');
    assert.deepEqual(savedEvents, events, 'no durable event was appended');
    assert.deepEqual(seen, [], 'no profile event was published');
  }
});

test('a helper profile previews a GitHub skill and adds only its linked files after yes', async (t) => {
  const { cfg, db, crew, done } = setup();
  cfg.port = 0; cfg.host = '127.0.0.1'; cfg.linkPort = 0;
  const server = await startServer(cfg, db, crew), base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const link = 'https://github.com/example/skills/tree/main/skills/trace-demo';
  const prefix = 'https://raw.githubusercontent.com/example/skills/main/skills/trace-demo/';
  const files: Record<string, string> = {
    'SKILL.md': '---\nname: trace-demo\ndescription: Explain a small app from its source.\n---\n\nRead [the guide](guide.md). The referenced script is `scripts/unsafe.sh`.\n',
    'guide.md': 'Follow the data from input to output.',
    'scripts/unsafe.sh': 'touch executed.marker',
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(prefix)) {
      const content = files[url.slice(prefix.length)];
      return new Response(content ?? '', { status: content ? 200 : 404 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const helper = crew.recruit('scout', 'Research Rae', 'person'), folder = join(disk.botDir(cfg, helper.id), 'skills', 'trace-demo');
  const api = async (method: string, path: string, body?: object) => {
    const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  t.after(async () => { globalThis.fetch = realFetch; if (server.listening) await new Promise<void>((r, reject) => server.close((e) => e ? reject(e) : r())); done(); });
  const preview = await api('POST', `/api/bots/${helper.id}/skills/preview`, { link });
  assert.equal(preview.status, 200);
  assert.deepEqual({ name: preview.body.name, description: preview.body.description }, { name: 'trace-demo', description: 'Explain a small app from its source.' });
  assert.equal(existsSync(join(folder, 'SKILL.md')), false, 'preview alone adds nothing');
  const added = await api('POST', `/api/bots/${helper.id}/skills/add`, { link, token: preview.body.token });
  assert.equal(added.status, 200);
  assert.equal(added.body.skill.added, true);
  assert.match(readFileSync(join(folder, 'SKILL.md'), 'utf8'), /added: yes/);
  assert.equal(readFileSync(join(folder, 'guide.md'), 'utf8'), files['guide.md']);
  assert.equal(existsSync(join(folder, 'scripts/unsafe.sh')), true, 'a same-folder referenced file is copied, not run');
  assert.equal(existsSync(join(folder, 'executed.marker')), false, 'adding a skill never runs its scripts');
  const again = await api('POST', `/api/bots/${helper.id}/skills/add`, { link, token: preview.body.token });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'This helper already has this skill, so nothing changed.', 'a plain line, and the skill it has is kept');
  assert.match(readFileSync(join(folder, 'SKILL.md'), 'utf8'), /added: yes/);
  const changed = files['SKILL.md']; files['SKILL.md'] += '\nChanged after review.\n';
  const stale = await api('POST', `/api/bots/${helper.id}/skills/add`, { link, token: preview.body.token });
  assert.equal(stale.status, 409, 'changed content must be reviewed again');
  files['SKILL.md'] = changed;
  assert.equal((await api('DELETE', `/api/bots/${helper.id}/skills/trace-demo`)).status, 200, 'person-added skill can be put away');
  assert.equal(disk.listSkills(cfg, helper.id).some((s) => s.name === 'trace-demo'), false);
});
