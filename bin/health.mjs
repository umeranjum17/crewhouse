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

/** The database, opened read-only and checked: a finding when it is not a working SQLite file, otherwise null. Nothing is changed. */
export function databaseProblem(stateDir) {
  const db = join(stateDir, 'crew.db');
  if (!existsSync(db)) return null;
  try { const d = new DatabaseSync(db, { readOnly: true }); try { const r = d.prepare('PRAGMA quick_check').get(); if (r?.quick_check !== 'ok') throw new Error(r?.quick_check ?? 'the check found problems'); } finally { d.close(); } return null; }
  catch (e) { return { what: 'Database', cause: `${db} is damaged (${e.message.replace(/\.$/, '')}); it has not been changed`, next: `${process.env.CREWHOUSE_CMD ?? './crewhouse'} triage moves it aside after you say yes, and keeps it` }; }
}

/** A finding when anything but this install's own Crewhouse answers on its port, otherwise null. */
export async function portProblem(cfg) {
  if (!cfg.port || !await listening(cfg.port)) return null;
  const key = read(cfg.stateDir, 'person.key'), base = read(cfg.stateDir, 'endpoint');
  const ours = key && base && await fetch(`${base}/api/state`, { headers: { 'x-crewhouse': '1', authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(2500) }).then((r) => r.ok, () => false);
  if (ours) return null;
  const w = why(`Error: listen EADDRINUSE: address already in use 127.0.0.1:${cfg.port}`);
  return { what: `Port ${cfg.port}`, cause: w.cause, next: w.next };
}

/** The engine keeps the AI sign-ins in its own folder; one that was set up once and is gone has taken them with it. A lab or test run (isolated, or a scripted engine) has no real install to be missing parts of. */
export function engineFolderProblem(cfg) {
  const real = process.env.CREWHOUSE_RUN_MODE === 'product' && !process.env.NODE_TEST_CONTEXT && cfg.engine === 'openclaw';
  if (!real || !read(cfg.stateDir, 'person.key') || existsSync(join(cfg.stateDir, 'openclaw'))) return null;
  return { what: 'AI engine folder', cause: `${join(cfg.stateDir, 'openclaw')} is gone, and the AI sign-ins that were in it`, next: `${process.env.CREWHOUSE_CMD ?? './crewhouse'} start builds a new one; then sign in again under Settings, AI accounts` };
}

/** `cfg` is crewd's config; each finding is `{ what, cause, next }` in plain words. */
export async function health(cfg) {
  const product = process.env.CREWHOUSE_RUN_MODE === 'product' && !process.env.NODE_TEST_CONTEXT && cfg.engine === 'openclaw';
  const found = [portProblem(cfg), databaseProblem(cfg.stateDir), engineFolderProblem(cfg)];
  // CREWHOUSE_ONLINE_URL: where to look ('' skips it); lab and test runs have no network and do not look.
  const url = process.env.CREWHOUSE_ONLINE_URL ?? (product ? 'https://github.com' : '');
  const offline = url ? await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) }).then(() => null, (e) => ({ what: 'Internet', cause: `this computer cannot reach ${new URL(url).host} (${e.cause?.code ?? e.name})`, next: 'check its network connection, then run the check again' })) : null;
  return [...await Promise.all(found), offline].filter(Boolean);
}
