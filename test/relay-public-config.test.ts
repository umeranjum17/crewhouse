// The install-time public origin: CREWHOUSE_RELAY_PUBLIC is read at boot, phones are advertised that origin, and a
// Settings relay change keeps it. Unset, phones are advertised the relay itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { temp } from './tmp.ts';
const { loadConfig } = await import('../src/config.ts');
const { Store } = await import('../src/db.ts');
const { Link } = await import('../src/link.ts');

const root = temp('relay-public-config');

test('CREWHOUSE_RELAY_PUBLIC is the public origin, kept across Settings relay changes', (t) => {
  process.env.CREWHOUSE_RELAY_PUBLIC = 'https://provider.example/some/path';
  t.after(() => { delete process.env.CREWHOUSE_RELAY_PUBLIC; });
  const cfg = { ...loadConfig(), stateDir: join(root, 'state') };
  assert.equal(cfg.relayPublic, 'https://provider.example');
  const db = new Store(cfg.stateDir);
  t.after(() => db.close());
  const link = new Link(cfg, db, async () => ({ ok: true }));
  link.setRelay('https://relay.example');
  assert.equal(link.relayPublic, 'https://provider.example');
  link.setRelay(null);
  assert.equal(link.relayPublic, 'https://provider.example');
});

test('without CREWHOUSE_RELAY_PUBLIC, phones are advertised the relay itself', (t) => {
  const db = new Store(join(root, 'plain'));
  t.after(() => db.close());
  const cfg = { ...loadConfig(), relayPublic: '', stateDir: join(root, 'plain') };
  const link = new Link(cfg, db, async () => ({ ok: true }));
  link.setRelay('https://relay.example');
  assert.equal(link.relayPublic, 'https://relay.example');
});

test('an invalid CREWHOUSE_RELAY_PUBLIC fails loudly at boot', (t) => {
  process.env.CREWHOUSE_RELAY_PUBLIC = 'ftp://provider.example';
  t.after(() => { delete process.env.CREWHOUSE_RELAY_PUBLIC; });
  assert.throws(() => loadConfig(), /a relay address starts with https:\/\/ or wss:\/\//);
});
