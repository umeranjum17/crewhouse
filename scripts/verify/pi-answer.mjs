#!/usr/bin/env node
// done-done journey `pi-answer`: a bot on Pi that keeps calling its notes and todo tools and never says a word, on a real crewd
// started with CREWHOUSE_ENGINE=pi, the real pinned Pi and a scripted model on loopback (no account, no network, nothing spent).
// The model always asks for one more call than the turn has made, so left alone its turn never ends. Crewhouse asks it for its
// answer once the turn has made 20 of the kit's 30 calls (maxToolCalls) without a word; one model answers, one keeps going and
// is stopped by the kit. Then a plain question, and the same message with the flag off. The host's records decide every check:
// the model's own requests, crewd's chat and its events table.
//   node scripts/verify/pi-answer.mjs <out-dir>
// Needs node scripts/prepare-pi.mjs. Writes answered.txt, stopped.txt, plain.txt, flag-off.txt and the step record.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startModelStub } from '../../test/openclaw-stub.ts';

const out = process.argv[2], repo = join(import.meta.dirname, '..', '..'), KEY = 'lab-model-key', ASK = 'Stop calling tools now', ANSWER = 'The locker code is K7.';
if (!out) { console.error('usage: pi-answer.mjs <out-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
// Always one more call than the turn has made, a note then a todo; `stubborn` decides what it does once asked for its answer.
let stubborn = false;
const churn = (body) => '[tool notes {"action": "add", "text": "still thinking"}][tool todo {"action": "add", "text": "think more"}]'.repeat(body.messages.length);
const lab = mkdtempSync('/var/tmp/crewhouse-pi-answer-'), daemons = new Set();
const model = await startModelStub(undefined, (body, text) => text.includes(ASK) && !stubborn ? { reply: ANSWER } : text.includes(ASK) || /keep going/.test(text) ? { text: churn(body) } : {});
const log = (file, line) => appendFileSync(join(out, file), `${line}\n`);
const check = (file, ok, what) => { log(file, `${ok ? 'PASS' : 'FAIL'}: ${what}`); if (!ok) throw new Error(`${file}: ${what}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 90_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(50)) { const v = await fn(); if (v) return v; } throw new Error(`timed out: ${what}`); };
const freePort = () => new Promise((r) => { const l = createServer().listen(0, '127.0.0.1', () => { const { port } = l.address(); l.close(() => r(port)); }); });

/** A real crewd of its own, in its own process group, with nothing of this shell's environment but what is named. */
async function crewd(name, env) {
  const root = join(lab, name), port = await freePort();
  for (const dir of ['home', 'run']) mkdirSync(join(root, dir), { recursive: true });
  const daemon = spawn(process.execPath, [join(repo, 'src', 'main.ts')], { detached: true, stdio: ['ignore', 'ignore', 'ignore'], env: {
    PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: join(root, 'home'), TMPDIR: root, XDG_STATE_HOME: join(root, 'home/.local/state'), XDG_DATA_HOME: join(root, 'home/.local/share'), XDG_CONFIG_HOME: join(root, 'home/.config'), XDG_CACHE_HOME: join(root, 'home/.cache'),
    XDG_RUNTIME_DIR: join(root, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, 'no-bus')}`, CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools'), ...env } });
  daemons.add(daemon);
  const api = async (path, body) => (await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8').trim()}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined })).json();
  await until(`${name} crewd up`, () => api('/api/state').then((s) => s.person, () => false), 30_000);
  await api('/api/onboard', { address: 'Umer' });
  /** One job: how it ended and what the chat says, then what the job added to the session as the model's last request carries it. */
  const ask = async (bot, text) => {
    const from = model.calls.length, { task } = await api(`/api/bots/${bot}/messages`, { text });
    const end = await until(`${bot}'s job ${task}`, async () => {
      const page = await api(`/api/bots/${bot}`), t = page.tasks.find((x) => x.id === task);
      if (!t || ['queued', 'working'].includes(t.state)) return undefined;
      return { state: t.state, said: (page.messages ?? []).filter((m) => m.author === 'bot' && m.task_id === task && String(m.text ?? '').trim()).at(-1)?.text ?? t.result ?? '' };
    });
    const calls = model.calls.slice(from).map((c) => JSON.stringify(c.body.messages)), count = (call, what) => call ? call.split(what).length - 1 : 0, added = (what) => count(calls.at(-1), what) - count(calls[0], what);
    return { ...end, task, requests: calls.length, ran: added('"role":"tool"'), asks: added(ASK) };
  };
  const limits = () => { const db = new DatabaseSync(join(root, 'state', 'crew.db'), { readOnly: true }); try { return db.prepare("SELECT bot, data FROM events WHERE kind = 'run.limit'").all().map((e) => ({ bot: e.bot, ...JSON.parse(e.data) })); } finally { db.close(); } };
  return { root, api, ask, limits, stop: async () => { try { process.kill(-daemon.pid, 'SIGTERM'); } catch { /* gone */ } await until(`${name} crewd down`, () => daemon.exitCode !== null || daemon.signalCode !== null, 15_000); daemons.delete(daemon); } };
}
const record = (file, end) => log(file, `The chat says: ${end.said}\nThe job ended: ${end.state}\nModel requests in the job: ${end.requests}\nTool calls that ran: ${end.ran}\nTimes the bot was asked for its answer: ${end.asks}`);

let failed = 0;
try {
  for (const name of ['answered.txt', 'stopped.txt', 'plain.txt', 'flag-off.txt']) rmSync(join(out, name), { force: true });
  const s = await crewd('pi', { CREWHOUSE_ENGINE: 'pi', CREWHOUSE_ENGINE_BASE_URL: model.url, CREWHOUSE_ENGINE_API_KEY: KEY }), { id: scout } = await s.api('/api/recruit', { template: 'scout' });

  log('answered.txt', `State: a real crewd with CREWHOUSE_ENGINE=pi; helper ${scout} on its default tools (notes, todo). The model calls a tool on every request and never writes a word, until it reads "${ASK}", and then it answers.\nAsked: Find the locker code, keep going`);
  const answered = await s.ask(scout, 'Find the locker code, keep going');
  record('answered.txt', answered);
  check('answered.txt', answered.state === 'done' && answered.said === ANSWER, 'the churning bot answered in words');
  check('answered.txt', answered.asks === 1 && answered.ran >= 20 && answered.ran <= 30, 'it was asked once, after twenty tool calls, and answered inside the cap of thirty');
  check('answered.txt', s.limits().length === 0, 'the cap was never reached: no run.limit event');

  stubborn = true;
  log('stopped.txt', `State: the same helper. This model keeps calling tools even after it reads "${ASK}".\nAsked: Find the gate code, keep going`);
  const stopped = await s.ask(scout, 'Find the gate code, keep going'), limits = s.limits();
  record('stopped.txt', stopped);
  log('stopped.txt', `crewd's run.limit events: ${JSON.stringify(limits)}`);
  check('stopped.txt', stopped.state === 'failed' && /couldn't finish this one\. Try again\.$/.test(stopped.said) && !/maxToolCalls|Stopped:/.test(stopped.said), 'the job ended on the line the app shows for a stopped turn, with no engine words');
  // The kit judges the cap from Pi's output and sends its stop back, so calls already under way still run: on a model that answers in milliseconds that is a few (32 to 34 seen here).
  check('stopped.txt', stopped.asks === 1 && stopped.ran > 30 && stopped.ran <= 40, `it was asked once, and the turn ended ${stopped.ran - 30} past the cap of thirty, the calls already under way when the kit's stop landed`);
  check('stopped.txt', limits.length === 1 && limits[0].bot === scout && limits[0].task === stopped.task && limits[0].calls === 30 && limits[0].limit === 30, 'the events say this job reached the cap of thirty');

  stubborn = false;
  log('plain.txt', 'State: the same helper, a question the model answers straight away.\nAsked: What day is it?');
  const plain = await s.ask(scout, 'What day is it?');
  record('plain.txt', plain);
  check('plain.txt', plain.state === 'done' && plain.said === `stub ${scout}: done with "What day is it?"` && plain.ran === 0 && plain.asks === 0, 'a turn that answers is untouched: no tool call, never asked');
  await s.stop();

  const off = await crewd('flag-off', { CREWHOUSE_ENGINE: 'stub' }), { id: other } = await off.api('/api/recruit', { template: 'scout' });
  log('flag-off.txt', 'State: the Pi flag off (the stub engine), the same message.\nAsked: Find the locker code, keep going');
  const plainOff = await off.ask(other, 'Find the locker code, keep going');
  log('flag-off.txt', `The chat says: ${plainOff.said}\nThe job ended: ${plainOff.state}`);
  check('flag-off.txt', plainOff.state === 'done' && plainOff.requests === 0 && off.limits().length === 0, 'with the flag off the job finishes as before: no model request, no run.limit event');
  check('flag-off.txt', !existsSync(join(off.root, 'state', 'pi')), 'and nothing of Pi was made');
  await off.stop();
  execFileSync(process.execPath, [join(repo, 'scripts', 'verify', 'steps.mjs'), out, 'pi-answer'], { stdio: 'inherit' });
  console.log(`pi-answer: the churning bot answered after ${answered.ran} tool calls; the stubborn one stopped on the cap; captures in ${out}`);
} catch (e) { failed = 1; console.error(`pi-answer: ${e.message}`); }
for (const daemon of daemons) { try { process.kill(-daemon.pid, 'SIGKILL'); } catch { /* gone */ } }
void model.close();
await until('every crewd gone', () => [...daemons].every((d) => d.exitCode !== null || d.signalCode !== null), 10_000).catch(() => {});
execFileSync('chmod', ['-R', 'u+w', lab]);
rmSync(lab, { recursive: true, force: true });
process.exit(failed);
