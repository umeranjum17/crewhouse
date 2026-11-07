// done-done journey `mention-bus`: the real crewd on the stub engine, one helper's crew_mention riding the supervised local NATS
// JetStream server into another helper's job, and that helper's answer coming back. No screen: the proof is the app's own API,
// crewd's log, and the broker process it supervises.
//
//   node scripts/verify/mention-bus.mjs --out "$DONE_DONE_EVIDENCE_ROOT"
//
// Boots one isolated crewd (throwaway HOME/XDG/TMPDIR, dead D-Bus path, loopback, OS-assigned port — never the owner's install),
// fetches the pinned NATS server by its published sha256 into that lab, and drives: onboard → hire Scout and Scribe → ask Scout
// for the board through Scribe → read both threads. Everything it starts shares crewd's process group and is torn down by `end`.
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { connect } from '@nats-io/transport-node';
import { ensureNats } from '../../src/nats.ts';
import { writeSteps } from './steps.mjs';

const out = ((i) => i < 0 ? null : process.argv[i + 1])(process.argv.indexOf('--out'));
if (!out) { console.error('usage: mention-bus.mjs --out <evidence-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });

const repo = join(import.meta.dirname, '..', '..'), lab = mkdtempSync(join(tmpdir(), 'crewhouse-mention-bus-'));
let group = 0;
const gone = () => { try { process.kill(-group, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const drain = async (signal) => {
  try { process.kill(-group, signal); } catch (e) { if (e.code !== 'ESRCH') console.error(`mention-bus: ${signal} to crewd's group ${group}: ${e.message}`); }
  for (const deadline = Date.now() + 5_000; !gone(); await pause(50)) if (Date.now() > deadline) return false;
  return true;
};
const end = (code, line) => (async () => {
  if (code) console.error(`mention-bus: ${line}`);
  if (group && !(await drain('SIGTERM'))) {
    console.error(`mention-bus: crewd's process group ${group} outlived SIGTERM; sending SIGKILL`);
    if (!(await drain('SIGKILL'))) { console.error(`mention-bus: group ${group} outlived SIGKILL; keeping ${lab}`); process.exit(1); }
  }
  if (code) { try { copyFileSync(join(lab, 'crewd.log'), join(out, 'crewd.log')); } catch {} }
  try { rmSync(lab, { recursive: true, force: true }); } catch (e) { console.error(`mention-bus: cleanup of ${lab} failed: ${e.message}`); }
  process.exit(code ?? 0);
})();

for (const d of ['home', 'state', 'crew', 'tools', 'run']) mkdirSync(join(lab, d), { recursive: true });
const port = await new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const base = `http://127.0.0.1:${port}`;
// The pinned server, fetched and hash-checked by crewd's own code, so the daemon below finds the stamped binary and stays offline.
const bin = await ensureNats(join(lab, 'tools', 'nats'));
writeFileSync(join(out, 'nats-binary.txt'), `${bin}\n${execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim()}\nsha256 stamp: ${readFileSync(`${bin}.sha256`, 'utf8')}\n`);

const logPath = join(lab, 'crewd.log'), logFd = openSync(logPath, 'w');
const child = spawn('setpriv', ['--pdeathsig', 'KILL', '--', process.execPath, join(repo, 'src', 'main.ts')], {
  cwd: repo, detached: true, stdio: ['ignore', logFd, logFd],
  env: {
    PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: join(lab, 'home'), TMPDIR: lab,
    XDG_STATE_HOME: join(lab, 'home', '.local', 'state'), XDG_DATA_HOME: join(lab, 'home', '.local', 'share'),
    XDG_CONFIG_HOME: join(lab, 'home', '.config'), XDG_CACHE_HOME: join(lab, 'home', '.cache'),
    XDG_RUNTIME_DIR: join(lab, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(lab, 'no-bus')}`,
    CREWHOUSE_ENGINE: 'stub', CREWHOUSE_STUB_GOLDEN: '1', CREWHOUSE_PORT: String(port),
    CREWHOUSE_STATE_DIR: join(lab, 'state'), CREWHOUSE_CREW_DIR: join(lab, 'crew'), CREWHOUSE_TOOLS_DIR: join(lab, 'tools'),
  },
});
for (let i = 0; i < 100; i++) { try { process.kill(-child.pid, 0); group = child.pid; break; } catch { await pause(50); } }
if (!group) await end(1, `crewd's process group never appeared (pid ${child.pid})`);

const transcript = [];
let capability = '';
const scrub = (s) => capability ? s.split(capability).join('REDACTED-CAPABILITY') : s;
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', ...(capability ? { Authorization: `Bearer ${capability}` } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000),
  });
  const text = scrub(await r.text());
  transcript.push({ method, path, status: r.status, body: JSON.parse(text) });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
};
const until = async (what, fn, ms) => {
  const stop = Date.now() + ms; let last = 'no attempt yet';
  for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { last = e.message; } if (Date.now() > stop) throw new Error(`timed out: ${what} (last: ${last})`); await pause(200); }
};
const texts = (view, author) => (view.messages ?? []).filter((m) => author ? m.author === author : true).map((m) => `${m.author}: ${m.text}`);

try {
  await until('crewd ready', async () => {
    const keyFile = join(lab, 'state', 'person.key');
    if (!existsSync(keyFile)) return false;
    capability = readFileSync(keyFile, 'utf8').trim();
    const s = await call('GET', '/api/state');
    return s?.person ? true : false;
  }, 60_000);
  await call('POST', '/api/onboard', { address: 'Sir' });
  const scout = await call('POST', '/api/recruit', { template: 'scout', name: 'Scout' });
  const scribe = await call('POST', '/api/recruit', { template: 'scribe', name: 'Scribe' });

  // The person asks Scout for the board and Scout asks Scribe for it: one crew_mention call, gated by crewd.
  const ask = `Ask Scribe to check the board. [tool crew_mention ${JSON.stringify({ to: scribe.id, text: 'check the board' })}]`;
  const scoutTask = (await call('POST', `/api/bots/${scout.id}/messages`, { text: ask, move: 'mention-bus' })).task;
  const scribeJob = await until("Scribe's job from the mention", async () => {
    const v = await call('GET', `/api/bots/${scribe.id}`);
    return (v.tasks ?? []).find((t) => t.origin === scout.id) ?? false;
  }, 30_000);
  const answered = await until("Scribe's answer back in Scout's chat", async () => {
    const v = await call('GET', `/api/bots/${scout.id}`);
    return texts(v, scribe.id).length > 0 ? v : false;
  }, 30_000);
  const scribeView = await call('GET', `/api/bots/${scribe.id}`);
  const finished = (scribeView.tasks ?? []).find((t) => t.id === scribeJob.id);
  if (finished?.state !== 'done') throw new Error(`Scribe's job ended ${finished?.state}: ${finished?.result}`);
  const asked = texts(answered, 'system').find((t) => t.includes(`Asked Scribe`)), handed = texts(scribeView, scout.id)[0], reply = texts(answered, scribe.id)[0];
  if (!asked) throw new Error("Scout's thread does not show the ask");
  if (!handed) throw new Error("Scribe's thread does not show the hand-off");
  if (scribeJob.parent !== scoutTask) throw new Error(`the mention job (${scribeJob.id}) is not under Scout's task (${scoutTask})`);

  // The broker crewd supervises: one child, loopback only, a token, and refused without it.
  const dir = join(lab, 'state', 'nats'), pid = Number(readFileSync(join(dir, 'pid'), 'utf8')), token = readFileSync(join(dir, 'token'), 'utf8');
  const ps = execFileSync('ps', ['-o', 'pid=,ppid=,args=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  const brokers = execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8', maxBuffer: 8 << 20 }).split('\n').filter((l) => l.includes(join(lab, 'state', 'nats', 'nats.conf'))).length;
  const conf = readFileSync(join(dir, 'nats.conf'), 'utf8').split(token).join('REDACTED-TOKEN').split('\n').filter((l) => /host:|port:|token|store_dir|sync_interval/.test(l)).join('\n');
  const refused = [];
  for (const [what, tok] of [['no token', undefined], ['wrong token', 'wrong-token']]) {
    await connect({ servers: `127.0.0.1:${readFileSync(join(dir, 'port'), 'utf8')}`, ...(tok ? { token: tok } : {}), maxReconnectAttempts: 0, timeout: 1500 })
      .then((nc) => nc.close()).then(() => refused.push(`${what}: ANSWERED (not refused)`)).catch((e) => refused.push(`${what}: refused (${String(e.message).slice(0, 90)})`));
  }
  if (brokers !== 1) throw new Error(`${brokers} NATS servers run for this lab, not one`);
  if (!refused.every((r) => r.includes('refused'))) throw new Error(`the bus answered without its token: ${refused.join('; ')}`);

  writeFileSync(join(out, 'api-transcript.jsonl'), transcript.map((t) => JSON.stringify(t)).join('\n') + '\n');
  writeFileSync(join(out, 'broker.txt'), `one supervised child (${brokers} matching process):\n${ps}\n\n${conf}\n\n${refused.join('\n')}\n`);
  writeFileSync(join(out, 'threads.txt'), `Scout's thread:\n${texts(answered).join('\n')}\n\nScribe's thread:\n${texts(scribeView).join('\n')}\n`);
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ scout: scout.id, scribe: scribe.id, scoutTask, scribeJob: scribeJob.id, asked, handed, reply, refused }, null, 2) + '\n');
  copyFileSync(logPath, join(out, 'crewd.log'));
  writeSteps(out, 'mention-bus', { asked: asked ?? '', reply: reply ?? '', refused: refused.join('; ') });
  await end(0);
} catch (e) { await end(1, e.message); }
