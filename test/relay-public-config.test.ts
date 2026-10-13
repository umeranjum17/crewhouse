// The install-time public origin: CREWHOUSE_RELAY_PUBLIC is read at boot, phones are advertised that origin, a Settings
// relay change keeps it, and a Settings override wins over it until cleared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { temp } from './tmp.ts';
const { loadConfig } = await import('../src/config.ts');
const { Store } = await import('../src/db.ts');
const { Link } = await import('../src/link.ts');

const root = temp('relay-public-config');

test('CREWHOUSE_RELAY_PUBLIC is the install value: Settings relay changes keep it, a Settings override wins until cleared', (t) => {
  process.env.CREWHOUSE_RELAY_PUBLIC = 'https://provider.example/some/path';
  t.after(() => { delete process.env.CREWHOUSE_RELAY_PUBLIC; });
  const cfg = { ...loadConfig(), stateDir: join(root, 'state') };
  assert.equal(cfg.relayPublic, 'https://provider.example');
  const db = new Store(cfg.stateDir);
  t.after(() => db.close());
  const link = new Link(cfg, db, async () => ({ ok: true }));
  link.setRelay('https://relay.example');
  assert.equal(link.relayPublic, 'https://provider.example', 'a Settings relay change keeps the install value');
  link.setRelay('https://relay.example', undefined, 'https://other.example');
  assert.equal(link.relayPublic, 'https://other.example', 'a Settings override wins');
  link.setRelay('https://relay.example', undefined, null);
  assert.equal(link.relayPublic, 'https://provider.example', 'clearing the override falls back to the install value');
});

test('an invalid CREWHOUSE_RELAY_PUBLIC fails loudly at boot', (t) => {
  process.env.CREWHOUSE_RELAY_PUBLIC = 'ftp://provider.example';
  t.after(() => { delete process.env.CREWHOUSE_RELAY_PUBLIC; });
  assert.throws(() => loadConfig(), /a relay address starts with https:\/\/ or wss:\/\//);
});
