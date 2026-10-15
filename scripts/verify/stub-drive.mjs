// done-done journey `stub-drive`: the real crewd on the stub engine, driven through
// the app's own HTTP API, with transcripts as text evidence.
//
//   node scripts/verify/stub-drive.mjs --out "$DONE_DONE_EVIDENCE_ROOT"
//
// Boots one isolated crewd (throwaway HOME/XDG/TMPDIR, dead D-Bus path, loopback,
// OS-assigned port — never the owner's install, never port 7711), runs the canonical
// journey (state → onboard → Chief message → bot reply), writes api-transcript.jsonl,
// summary.json and crewd.log to --out, then tears the instance down. The person's
// capability is never written to evidence or stdout: transcripts scrub it.
// Exit 0 on a full pass, 1 on any failure, 2 on usage error.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const out = ((i) => i < 0 ? null : process.argv[i + 1])(process.argv.indexOf('--out'));
if (!out) { console.error('usage: stub-drive.mjs --out <evidence-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });

const repo = join(import.meta.dirname, '..', '..');
const lab = mkdtempSync(join(tmpdir(), 'crewhouse-stub-drive-'));
const wipe = (dir) => { try { rmSync(dir, { recursive: true, force: true }); } catch (e) { console.error(`stub-drive: cleanup of ${dir} failed: ${e.message}`); } };
const fail = (why) => { console.error(`stub-drive: ${why}`); wipe(lab); process.exit(1); };
process.on('uncaughtException', (e) => fail(e.message));

for (const d of ['home', 'state', 'crew', 'tools', 'run']) mkdirSync(join(lab, d), { recursive: true });
const port = await new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const base = `http://127.0.0.1:${port}`;
const logPath = join(out, 'crewd.log');
const logFd = (await import('node:fs')).openSync(logPath, 'w');

const child = spawn(process.execPath, [join(repo, 'src', 'main.ts')], {
  cwd: repo, stdio: ['ignore', logFd, logFd],
  env: {
    PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8',
    HOME: join(lab, 'home'), TMPDIR: lab,
    XDG_STATE_HOME: join(lab, 'home', '.local', 'state'), XDG_DATA_HOME: join(lab, 'home', '.local', 'share'),
    XDG_CONFIG_HOME: join(lab, 'home', '.config'), XDG_CACHE_HOME: join(lab, 'home', '.cache'),
    XDG_RUNTIME_DIR: join(lab, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(lab, 'no-bus')}`,
    CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(port),
    CREWHOUSE_STATE_DIR: join(lab, 'state'), CREWHOUSE_CREW_DIR: join(lab, 'crew'), CREWHOUSE_TOOLS_DIR: join(lab, 'tools'),
  },
});
let dead = false; child.once('exit', () => { dead = true; });
const stop = async () => { if (!dead) { child.kill('SIGTERM'); for (let i = 0; i < 100 && !dead; i++) await new Promise((r) => setTimeout(r, 100)); } };

const transcript = [];
let capability = '';
const scrub = (s) => capability ? s.split(capability).join('REDACTED-CAPABILITY') : s;
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', ...(capability ? { Authorization: `Bearer ${capability}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  transcript.push({ method, path, status: r.status, body: JSON.parse(scrub(text)) });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${scrub(text).slice(0, 200)}`);
  return JSON.parse(text);
};
const until = async (what, fn, ms) => {
  const end = Date.now() + ms;
  let last = 'no attempt yet';
  for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { last = e.message; } if (Date.now() > end) throw new Error(`timed out: ${what} (last: ${last})`); await new Promise((r) => setTimeout(r, 250)); }
};

try {
  const keyFile = join(lab, 'state', 'person.key');
  await until('crewd ready', async () => {
    if (!existsSync(keyFile)) return false;
    capability = readFileSync(keyFile, 'utf8').trim();
    const s = await call('GET', '/api/state');
    return s && s.person ? true : false;
  }, 60_000);
  const before = transcript.at(-1).body;
  if (before.person.name !== 'Owner') throw new Error(`unexpected person: ${JSON.stringify(before.person).slice(0, 120)}`);
  if (!before.bots?.some((b) => b.id === 'chief')) throw new Error('chief missing from bots list');
  await call('POST', '/api/onboard', { address: 'Sir' });
  const after = (await call('GET', '/api/state')).person;
  if (after.address !== 'Sir') throw new Error(`onboard did not stick: ${JSON.stringify(after).slice(0, 120)}`);
  await call('POST', '/api/bots/chief/messages', { text: 'I need a demo video' });
  const reply = await until('chief reply', async () => {
    const s = await call('GET', '/api/bots/chief');
    const msgs = s.messages ?? s.thread ?? [];
    const last = Array.isArray(msgs) ? msgs.filter((m) => m.author === 'bot').at(-1) : null;
    return last && /I need a demo video/.test(last.text) ? last.text : false;
  }, 30_000);
  writeFileSync(join(out, 'api-transcript.jsonl'), transcript.map((t) => JSON.stringify(t)).join('\n') + '\n');
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ person: 'Owner', address: 'Sir', chief: true, reply }, null, 2) + '\n');
} catch (e) { await stop(); fail(e.message); }
await stop();
wipe(lab);
const leftovers = transcript.length < 4 ? ' (short transcript)' : '';
console.log(`stub-drive: pass${leftovers} — ${transcript.length} calls in ${out}`);
