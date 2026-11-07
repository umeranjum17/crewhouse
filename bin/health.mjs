// What stops Crewhouse running, found without starting it: a port another program holds, a database that is not one,
// an engine folder that is gone, no internet. `doctor` prints each as a ✗ with its cause and the one line that gets past it.
// Read-only (nothing is written or moved), and it needs nothing but Node, so it runs on a machine that is broken.
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { why } from './why.mjs';

const listening = (port) => new Promise((done) => { const s = createConnection({ port, host: '127.0.0.1' }, () => { s.destroy(); done(true); }); s.setTimeout(1500, () => { s.destroy(); done(false); }).on('error', () => done(false)); });
const read = (...p) => { try { return readFileSync(join(...p), 'utf8').trim(); } catch { return ''; } };

/** `cfg` is crewd's config; each finding is `{ what, cause, next }` in plain words. */
export async function health(cfg) {
  const found = [], { stateDir } = cfg, db = join(stateDir, 'crew.db'), key = read(stateDir, 'person.key'), base = read(stateDir, 'endpoint');
  // The port: fine when it is Crewhouse itself answering with this install's own key, a finding when anything else holds it.
  if (cfg.port && await listening(cfg.port)) {
    const ours = key && base && await fetch(`${base}/api/state`, { headers: { 'x-crewhouse': '1', authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(2500) }).then((r) => r.ok, () => false);
    if (!ours) { const w = why(`Error: listen EADDRINUSE: address already in use 127.0.0.1:${cfg.port}`); found.push({ what: `Port ${cfg.port}`, cause: w.cause, next: w.next }); }
  }
  if (existsSync(db)) {
    try { const d = new DatabaseSync(db, { readOnly: true }); try { const r = d.prepare('PRAGMA quick_check').get(); if (r?.quick_check !== 'ok') throw new Error(r?.quick_check ?? 'the check found problems'); } finally { d.close(); } }
    catch (e) { found.push({ what: 'Database', cause: `${db} is damaged (${e.message.replace(/\.$/, '')}); it has not been changed`, next: `restore a copy of it from a backup; with none, report it at https://github.com/umeranjum17/crewhouse/issues` }); }
  }
  // The engine keeps the AI sign-ins in its own folder; one that was set up once and is gone has taken them with it.
  if (cfg.engine === 'openclaw' && key && !existsSync(join(stateDir, 'openclaw'))) found.push({ what: 'AI engine folder', cause: `${join(stateDir, 'openclaw')} is gone, and the AI sign-ins that were in it`, next: `${process.env.CREWHOUSE_CMD ?? './crewhouse'} start builds a new one; then sign in again under Settings, AI accounts` });
  // CREWHOUSE_ONLINE_URL: where to look ('' skips it); lab and test runs have no network and do not look.
  const url = process.env.CREWHOUSE_ONLINE_URL ?? (process.env.CREWHOUSE_RUN_MODE === 'product' && cfg.engine !== 'stub' && !process.env.NODE_TEST_CONTEXT ? 'https://github.com' : '');
  if (url) await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) }).catch((e) => found.push({ what: 'Internet', cause: `this computer cannot reach ${new URL(url).host} (${e.cause?.code ?? e.name})`, next: 'check its network connection, then run the check again' }));
  return found;
}
