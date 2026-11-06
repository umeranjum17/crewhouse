#!/usr/bin/env node
// done-done journey `hands`: one door for a bot's hands (bin/hands.mjs), on a real crewd started on the stub engine, driven
// through the HTTP API the app uses (no account, no network, nothing spent). Scribe's bot.json names a far computer, "lab",
// whose stand-in is a folder in crewd's state: its shell call and browser action go there, in order and with their exact
// arguments, and Scribe reads the stand-in's answer. Scout names none and runs here as before: its shell in its own sandbox,
// its browser through the pinned AXI. Then Scribe's far computer is one that cannot be reached, and one whose name is not
// a name: each call is a failure Scribe reads, and nothing runs here instead. The browser AXI is a stand-in that writes down
// every call it gets, so the record shows what ran here. The host's records decide every check: the stand-in's calls.jsonl,
// the AXI's own log, the bot's folder and crewd's events table (run.call: the tool, whether it worked, and the first line
// the bot read).
//   node scripts/verify/hands.mjs <out-dir>
// Writes far.txt, here.txt, failure.txt and the step record.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const out = process.argv[2], repo = join(import.meta.dirname, '..', '..');
if (!out) { console.error('usage: hands.mjs <out-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const AXI = `const fs = process.getBuiltinModule('fs');
fs.appendFileSync(process.cwd() + '/axi-calls.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
console.log('page: {url: https://example.test/, title: "Example"}');`;
const JOB = (file) => `Save a note and look at the page [tool bash {"command":"echo hands > ${file}"}] [tool browser {"args":["goto","https://example.test/"]}]`;
const lab = mkdtempSync('/var/tmp/crewhouse-hands-'), root = join(lab, 'crewd');
const log = (file, line) => appendFileSync(join(out, file), `${line}\n`);
const check = (file, ok, what) => { log(file, `${ok ? 'PASS' : 'FAIL'}: ${what}`); if (!ok) throw new Error(`${file}: ${what}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 30_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(50)) { const v = await fn(); if (v) return v; } throw new Error(`timed out: ${what}`); };
const freePort = () => new Promise((r) => { const l = createServer().listen(0, '127.0.0.1', () => { const { port } = l.address(); l.close(() => r(port)); }); });
const lines = (file) => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const show = (rows) => rows.map((r) => `  ${JSON.stringify(r)}`).join('\n') || '  (none)';

// The pinned browser AXI as an install leaves it, in this crewd's own tools folder.
const tools = join(root, 'tools'), axi = join(tools, 'browser', 'node_modules', 'playwright-axi', 'bin', 'playwright-axi.js');
mkdirSync(join(axi, '..'), { recursive: true }); mkdirSync(join(tools, 'bin'), { recursive: true });
writeFileSync(axi, AXI); symlinkSync(axi, join(tools, 'bin', 'playwright-axi'));
for (const dir of ['home', 'run']) mkdirSync(join(root, dir), { recursive: true });
const port = await freePort(), daemon = spawn(process.execPath, [join(repo, 'src', 'main.ts')], { detached: true, stdio: ['ignore', 'ignore', 'ignore'], env: {
  PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: join(root, 'home'), TMPDIR: root, XDG_STATE_HOME: join(root, 'home/.local/state'), XDG_DATA_HOME: join(root, 'home/.local/share'), XDG_CONFIG_HOME: join(root, 'home/.config'), XDG_CACHE_HOME: join(root, 'home/.cache'),
  XDG_RUNTIME_DIR: join(root, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, 'no-bus')}`, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: tools } });
const api = async (path, body) => (await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8').trim()}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined })).json();
/** One job through the app's own API: how it ended, and crewd's own record of each call the bot made and the first line it read. */
const ask = async (bot, text) => {
  const { task } = await api(`/api/bots/${bot}/messages`, { text });
  const state = await until(`${bot}'s job ${task}`, async () => { const t = (await api(`/api/bots/${bot}`)).tasks.find((x) => x.id === task); return t && !['queued', 'working'].includes(t.state) && t.state; });
  const db = new DatabaseSync(join(root, 'state', 'crew.db'), { readOnly: true });
  try { return { task, state, calls: db.prepare("SELECT data FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') = ?").all(task).map((e) => JSON.parse(e.data)).map((c) => ({ tool: c.tool, ok: c.ok, read: c.head })) }; } finally { db.close(); }
};
const farOf = (bot, far) => { const file = join(root, 'crew', 'bots', bot, 'bot.json'); writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), far }, null, 2)); };

let failed = 0;
try {
  for (const name of ['far.txt', 'here.txt', 'failure.txt']) rmSync(join(out, name), { force: true });
  await until('crewd up', () => api('/api/state').then((s) => s.person, () => false));
  await api('/api/onboard', { address: 'Umer' });
  const { id: scribe } = await api('/api/recruit', { template: 'scribe' }), { id: scout } = await api('/api/recruit', { template: 'scout' });
  const far = join(root, 'state', 'far', 'lab'), space = join(root, 'crew', 'bots', scribe), here = join(root, 'crew', 'bots', scout);

  mkdirSync(far, { recursive: true });
  farOf(scribe, 'lab');
  log('far.txt', `State: a real crewd on the stub engine. ${scribe}'s bot.json says "far": "lab", and the pretend far computer "lab" is ${far}.\nAsked ${scribe}: ${JOB('far.txt')}`);
  const job = await ask(scribe, JOB('far.txt'));
  await until('the far browser closed with the job', () => lines(join(far, 'calls.jsonl')).length === 4);
  const got = lines(join(far, 'calls.jsonl'));
  log('far.txt', `The job ended: ${job.state}\nWhat reached the far computer, in order:\n${show(got)}\ncrewd's record of each call and the first line ${scribe} read:\n${show(job.calls)}\nWhat ran here: ${existsSync(join(space, 'far.txt')) ? 'far.txt was written in its folder' : 'no far.txt in its folder'}; the browser AXI here was called:\n${show(lines(join(space, 'axi-calls.jsonl')))}`);
  check('far.txt', JSON.stringify(got) === JSON.stringify([{ tool: 'bash', input: { command: 'echo hands > far.txt' } }, { tool: 'browser', input: ['open', '--persistent', '--profile', join(space, 'browser')] }, { tool: 'browser', input: ['goto', 'https://example.test/'] }, { tool: 'browser', input: ['close'] }]), 'the shell call, then the browser opening, the page and the close at the job\'s end reached the far stand-in in that order, with their exact arguments');
  check('far.txt', JSON.stringify(job.calls) === JSON.stringify(['bash', 'browser'].map((tool) => ({ tool, ok: true, read: `far stand-in "lab": your ${tool} call was written down; no computer ran it.` }))), `${scribe} read the stand-in's own answer to each, which says no computer ran it`);
  check('far.txt', !existsSync(join(space, 'far.txt')) && !lines(join(space, 'axi-calls.jsonl')).length, 'nothing ran on this computer: no file in its folder, no call to the browser here');

  log('here.txt', `State: the same crewd. ${scout}'s bot.json names no far computer.\nAsked ${scout}: ${JOB('here.txt')}`);
  const local = await ask(scout, JOB('here.txt'));
  await until('the local browser closed with the job', () => lines(join(here, 'axi-calls.jsonl')).length === 3);
  log('here.txt', `The job ended: ${local.state}\nIts folder's here.txt: ${existsSync(join(here, 'here.txt')) ? JSON.stringify(readFileSync(join(here, 'here.txt'), 'utf8')) : '(none)'}\nThe browser AXI here was called:\n${show(lines(join(here, 'axi-calls.jsonl')))}\ncrewd's record of each call and the first line ${scout} read:\n${show(local.calls)}\nNew calls at the far computer: ${lines(join(far, 'calls.jsonl')).length - 4}`);
  check('here.txt', readFileSync(join(here, 'here.txt'), 'utf8') === 'hands\n', 'its shell ran here, in its own sandbox, and wrote into its folder');
  check('here.txt', JSON.stringify(lines(join(here, 'axi-calls.jsonl'))) === JSON.stringify([['open', '--persistent', '--profile', join(here, 'browser')], ['goto', 'https://example.test/'], ['close']]), 'its browser ran here through the pinned AXI: open on first use, the page, close at the end');
  check('here.txt', JSON.stringify(local.calls) === JSON.stringify([{ tool: 'bash', ok: true, read: '' }, { tool: 'browser', ok: true, read: 'page: {url: https://example.test/, title: "Example"}' }]), `${scout} read its own shell and browser, as before`);
  check('here.txt', lines(join(far, 'calls.jsonl')).length === 4, 'nothing of it reached the far computer');

  for (const [name, why] of [['gone', 'the far computer "gone" could not be reached, so nothing ran.'], ['../../x', "this bot's far computer has a name Crewhouse can't use, so nothing ran."]]) {
    farOf(scribe, name);
    log('failure.txt', `State: ${scribe}'s bot.json says "far": ${JSON.stringify(name)}${name === 'gone' ? ', and no pretend far computer by that name exists' : ', which is not a name'}.\nAsked ${scribe}: ${JOB('far.txt')}`);
    const end = await ask(scribe, JOB('far.txt'));
    log('failure.txt', `The job ended: ${end.state}\ncrewd's record of each call and the first line ${scribe} read:\n${show(end.calls)}`);
    check('failure.txt', JSON.stringify(end.calls) === JSON.stringify(['bash', 'browser'].map((tool) => ({ tool, ok: false, read: `error: ${why}` }))), `both calls failed, and ${scribe} read why in plain words`);
  }
  log('failure.txt', `What ran here after both: ${existsSync(join(space, 'far.txt')) ? 'far.txt was written in its folder' : 'no far.txt in its folder'}; the browser AXI here was called:\n${show(lines(join(space, 'axi-calls.jsonl')))}`);
  check('failure.txt', !existsSync(join(space, 'far.txt')) && !lines(join(space, 'axi-calls.jsonl')).length && !existsSync(join(root, 'state', 'x')), 'nothing fell back to this computer, and the name never became a path');
  execFileSync(process.execPath, [join(repo, 'scripts', 'verify', 'steps.mjs'), out, 'hands'], { stdio: 'inherit' });
  console.log(`hands: far, here and failure checks passed; captures in ${out}`);
} catch (e) { failed = 1; console.error(`hands: ${e.message}`); }
try { process.kill(-daemon.pid, 'SIGTERM'); } catch { /* gone */ }
await until('crewd down', () => daemon.exitCode !== null || daemon.signalCode !== null, 15_000).catch(() => { try { process.kill(-daemon.pid, 'SIGKILL'); } catch { /* gone */ } });
rmSync(lab, { recursive: true, force: true });
process.exit(failed);
