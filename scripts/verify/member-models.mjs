// done-done journey `member-models`: a chat order to Chief ("use ChatGPT for Scout") on the real crewd and the stub engine
// changes one member's account and model, lands in the crew folder's models.json, and the member's next run uses it.
//
//   node scripts/verify/member-models.mjs --out "$DONE_DONE_EVIDENCE_ROOT"
//
// Boots one isolated crewd (throwaway HOME/XDG/TMPDIR, dead D-Bus path, loopback,
// OS-assigned port — never the owner's install, never port 7711), runs the canonical
// journey (state → onboard → Chief message → bot reply), writes api-transcript.jsonl,
// summary.json and the run's step record to --out (crewd.log too, on a failure), then tears the instance down. The person's
// capability is never written to evidence or stdout: transcripts scrub it.
// Exit 0 on a full pass, 1 on any failure, 2 on usage error, 128+n on signal n.
//
// crewd and everything it starts share one process group of their own (spawn's
// `detached` is setsid), and every way out goes through `end`: TERM to the whole
// group, KILL after a bounded grace, then wait until no member is left. Only an
// empty group lets the lab go; a group that outlives KILL keeps it and fails the
// run. If this script is SIGKILLed, setpriv's parent-death signal takes crewd too.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { writeSteps } from './steps.mjs';

const out = ((i) => i < 0 ? null : process.argv[i + 1])(process.argv.indexOf('--out'));
if (!out) { console.error('usage: member-models.mjs --out <evidence-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });

const repo = join(import.meta.dirname, '..', '..');
const lab = mkdtempSync(join(tmpdir(), 'crewhouse-member-models-'));
let group = 0; // crewd's own process group, once proven
const gone = () => { try { process.kill(-group, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
const drain = async (signal) => {
  try { process.kill(-group, signal); } catch (e) { if (e.code !== 'ESRCH') console.error(`member-models: ${signal} to crewd's process group ${group}: ${e.message}`); }
  for (const deadline = Date.now() + 5_000; !gone(); await new Promise((r) => setTimeout(r, 50))) if (Date.now() > deadline) return false;
  return true;
};
let ending;
const end = (code, line) => ending ??= (async () => {
  if (code) console.error(`member-models: ${line}`);
  if (group && !(await drain('SIGTERM'))) {
    console.error(`member-models: crewd's process group ${group} outlived SIGTERM; sending SIGKILL`);
    if (!(await drain('SIGKILL'))) { console.error(`member-models: crewd's process group ${group} outlived SIGKILL; keeping ${lab}`); process.exit(1); }
  }
  if (code) try { copyFileSync(logPath, join(out, 'crewd.log')); } catch {}
  try { rmSync(lab, { recursive: true, force: true }); } catch (e) { console.error(`member-models: cleanup of ${lab} failed: ${e.message}`); }
  if (!code) console.log(`member-models: ${line}`);
  process.exit(code);
})();
process.on('uncaughtException', (e) => end(1, e.message));
for (const [signal, n] of [['SIGHUP', 1], ['SIGINT', 2], ['SIGTERM', 15]]) process.on(signal, () => end(128 + n, `stopped by ${signal}`));

for (const d of ['home', 'state', 'crew', 'tools', 'run']) mkdirSync(join(lab, d), { recursive: true });
const port = await new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const base = `http://127.0.0.1:${port}`;
const logPath = join(lab, 'crewd.log'); // copied to --out only on a failure: a startup log is no proof of the claim
const logFd = (await import('node:fs')).openSync(logPath, 'w');

const child = spawn('setpriv', ['--pdeathsig', 'KILL', '--', process.execPath, join(repo, 'src', 'main.ts')], {
  cwd: repo, detached: true, stdio: ['ignore', logFd, logFd],
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
// The group is named by crewd's pid once it appears.
for (let i = 0; i < 100; i++) { try { process.kill(-child.pid, 0); group = child.pid; break; } catch { await new Promise((r) => setTimeout(r, 50)); } }
if (!group) await end(1, `crewd's process group never appeared (pid ${child.pid})`);

const transcript = [];
let capability = '';
const scrub = (s) => capability ? s.split(capability).join('REDACTED-CAPABILITY') : s;
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', ...(capability ? { Authorization: `Bearer ${capability}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
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
  await call('POST', '/api/onboard', { address: 'Sir' });
  await call('POST', '/api/recruit', { template: 'scout', name: 'Scout' });
  const said = (bot) => until(`${bot} reply`, async () => (await call('GET', `/api/bots/${bot}`)).messages?.filter((m) => m.author === 'bot').at(-1)?.text, 30_000);
  const order = async (input) => { const n = (await call('GET', '/api/bots/chief')).messages.length; await call('POST', '/api/bots/chief/messages', { text: `Please. [tool crew_use ${JSON.stringify(input)}]` }); return until('chief answer', async () => { const m = (await call('GET', '/api/bots/chief')).messages; return m.length > n + 1 && m.filter((x) => x.author === 'bot').at(-1)?.text; }, 30_000); };
  const file = () => JSON.parse(readFileSync(join(lab, 'crew', 'models.json'), 'utf8'));
  const ok = await order({ bot: 'scout', account: 'ChatGPT', model: 'quick' });
  if (file().scout?.[0] !== 'chatgpt:quick-1') throw new Error(`models.json: ${JSON.stringify(file())}`);
  await call('POST', '/api/bots/scout/messages', { text: 'hello' });
  const started = await until('scout run on the pick', async () => {
    const db = new (await import('node:sqlite')).DatabaseSync(join(lab, 'state', 'crew.db'), { readOnly: true });
    try { return db.prepare("SELECT data FROM events WHERE kind = 'run.started' AND bot = 'scout' ORDER BY seq DESC LIMIT 1").get()?.data; } finally { db.close(); }
  }, 30_000);
  const refused = await order({ bot: 'scout', account: 'Grok' });
  if (JSON.stringify(file().scout) !== '["chatgpt:quick-1"]') throw new Error('a refused order changed the file');
  writeFileSync(join(out, 'api-transcript.jsonl'), transcript.map((t) => JSON.stringify(t)).join('\n') + '\n');
  writeFileSync(join(out, 'models.json'), JSON.stringify(file(), null, 2) + '\n');
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ ok, started: JSON.parse(started), refused }, null, 2) + '\n');
  writeFileSync(join(out, 'chat-order.txt'), `Person to Chief: use ChatGPT for Scout (quick model)\nChief: ${ok}\nPerson to Chief: use Grok for Scout (Grok is not signed in)\nChief: ${refused}\nScout's next job ran on: ${JSON.parse(started).name}\nStored in models.json: ${JSON.stringify(file())}\n`);
  writeSteps(out, 'member-models', { ok, refused });
} catch (e) { await end(1, e.message); }
const leftovers = transcript.length < 4 ? ' (short transcript)' : '';
await end(0, `pass${leftovers} — ${transcript.length} calls in ${out}`);
