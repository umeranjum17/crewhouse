// Real HTTP profile writes on synthetic stub crews; no accounts or external services.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
const { setup } = await import('./lab.ts');
const { startServer } = await import('../src/server.ts');
const { Store } = await import('../src/db.ts');
const { Crew } = await import('../src/crew.ts');

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
    const res = await fetch(base + path, { method, headers: { authorization: method === 'GET' ? '' : `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`, 'x-crewhouse': '1', 'content-type': 'application/json' },
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
    const res = await fetch(`http://127.0.0.1:${(reloadServer.address() as AddressInfo).port}/api/state`);
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
