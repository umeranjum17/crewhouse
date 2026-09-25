// Crewhouse's engine is its own copy of Pi. With a decoy of the owner's Pi in HOME (a signed-in auth.json, settings, an
// extension that would leave a mark if loaded, skills, a `pi` on PATH) and the environment a shell inside the owner's pi
// hands down, a full run (tasks with tools, a sign-in, a restart) never reads or writes any of it.
// The same for the owner's own tools: their AXIs and npx on PATH, and the caches and settings those tools keep under
// XDG_CACHE_HOME and XDG_CONFIG_HOME (which beat HOME) are never run, read or written; the bot's browser AXI runs from
// Crewhouse's own pinned copy with an environment crewd builds from nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync,  readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { createServer, type AddressInfo } from 'node:net';
import { traceFs } from '@byokit/accounts/testing';

const root = temp('crewhouse-isolation');
const home = join(root, 'home');
const pi = join(home, '.pi');
const agents = join(home, '.agents'); // the owner's shared agent skills, which Pi would also scan
const install = join(root, 'global-pi'); // where the owner's own pi is installed
const marks = join(root, 'marks');
const CANARY = 'canary-7f3a9c';
const put = (p: string, text: string) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); };
put(join(pi, 'agent', 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'oauth', access: `${CANARY}-access`, refresh: `${CANARY}-refresh`, expires: Date.now() + 86_400_000 } }));
put(join(pi, 'agent', 'settings.json'), JSON.stringify({ defaultProvider: 'openai', defaultModel: 'gpt-5.5', packages: ['npm:evil'] }));
put(join(pi, 'agent', 'extensions', 'evil.ts'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(marks, 'extension'))}, 'loaded'); export default () => {};`);
put(join(pi, 'agent', 'skills', 'owner-skill', 'SKILL.md'), '---\nname: owner-skill\ndescription: the owner\'s own skill\n---\n');
put(join(agents, 'skills', 'shared-skill', 'SKILL.md'), '---\nname: shared-skill\ndescription: another skill of the owner\'s\n---\n');
put(join(pi, 'agent', 'models.json'), JSON.stringify({ providers: {} }));
// The owner's own tools' state: where playwright's daemon, gws-axi and chrome-devtools-axi keep theirs, and agent hooks.
const xdgCache = join(home, '.cache'), xdgConfig = join(home, '.config');
put(join(xdgCache, 'ms-playwright', 'daemon', 'owner.session'), '{}');
put(join(xdgConfig, 'gws-axi', 'credentials.json'), JSON.stringify({ installed: { client_id: `${CANARY}.apps.googleusercontent.com`, client_secret: CANARY } }));
put(join(home, '.chrome-devtools-axi', 'snapshot-generation'), '7');
put(join(home, '.claude', 'settings.json'), '{}');
put(join(home, '.npmrc'), `//registry.npmjs.org/:_authToken=${CANARY}`);
put(join(install, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '0.0.1', piConfig: { name: 'pi', configDir: '.pi' } }));
const bin = join(root, 'bin');
for (const b of ['pi', 'playwright-axi', 'chrome-devtools-axi', 'npx', 'npm']) {
  put(join(bin, b), `#!/bin/sh\necho ran > ${JSON.stringify(join(marks, b))}\n`);
  chmodSync(join(bin, b), 0o755);
}
// Crewhouse's own pinned browser AXI, as `./crewhouse tools install` leaves it: a link in the kit's bin to the script
// in the tool's own node_modules. This stand-in records how crewd runs it and answers like playwright-axi.
const tools = join(root, 'tools');
const axi = join(tools, 'browser', 'node_modules', 'playwright-axi', 'bin', 'playwright-axi.js');
const calls = join(root, 'axi-calls.jsonl');
put(axi, `require('node:fs').appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ argv: process.argv, env: process.env }) + '\\n');
const [cmd, url] = process.argv.slice(2);
console.log(cmd === 'goto' ? 'page: {url: ' + url + ', title: "Example"}\\nsnapshot:\\n  - heading "Example" [ref=e1]' : 'result: ok');`);
mkdirSync(join(tools, 'bin'), { recursive: true });
symlinkSync(axi, join(tools, 'bin', 'playwright-axi'));
mkdirSync(marks);

const hashes = (dir: string): Record<string, string> => Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).map((e) => { const p = join(e.parentPath, e.name); return [p, createHash('sha256').update(readFileSync(p)).digest('hex') + statSync(p).mtimeMs]; }));
const owned = [pi, install, agents, xdgCache, xdgConfig, join(home, '.chrome-devtools-axi'), join(home, '.claude')];
const everything = () => ({ ...hashes(home), ...hashes(install) }); // the owner's whole home, not just the folders traced
const before = everything();

const port = await new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const base = `http://127.0.0.1:${port}`;
const state = join(root, 'state');
const trace = join(root, 'trace.log');
writeFileSync(trace, '');
const env = {
  ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
  // What a shell started from inside the owner's pi inherits.
  PI_CODING_AGENT_DIR: join(pi, 'agent'), PI_PACKAGE_DIR: install, PI_SESSION_FILE: join(pi, 'agent', 'sessions', 'x.jsonl'), PI_PROVIDER: 'openai', PI_MODEL: 'gpt-5.5',
  PI_CODING_AGENT: 'true', AI_AGENT: 'pi', OPENAI_API_KEY: `${CANARY}-key`, XAI_API_KEY: `${CANARY}-xai`,
  XDG_CACHE_HOME: xdgCache, XDG_CONFIG_HOME: xdgConfig, npm_config_prefix: join(root, 'global-npm'),
  CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(port), CREWHOUSE_STATE_DIR: state, CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: tools,
  TRACE_ROOTS: owned.join(':'), TRACE_LOG: trace,
};
let daemon: ChildProcess;
const start = () => { daemon = spawn(process.execPath, ['--import', traceFs, join(import.meta.dirname, '..', 'src', 'main.ts')], { env, stdio: ['ignore', 'ignore', 'inherit'] }); };
after(() => daemon?.kill());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) =>
  (await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined })).json();
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 10_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = await fn().catch(() => undefined); if (v) return v; }
  throw new Error('timed out');
}
const finished = (task: number) => until(async () => (await api('GET', '/api/bots/reel')).tasks.find((t: any) => t.id === task && t.state === 'done'));
const files = (dir: string): string[] => existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)) : [];

test("the owner's own Pi is never read or written, and never run", async () => {
  start();
  await until(async () => (await fetch(`${base}/api/state`)).ok);
  await api('POST', '/api/bots/chief/messages', { text: 'Sir' });
  await api('POST', '/api/recruit', { template: 'reel', name: 'Reel' });
  // A task with the engine's own file tools and a skill folder, a task with its shell, a sign-in, then a restart mid-task.
  await finished((await api('POST', '/api/bots/reel/messages', { text: 'save [tool write {"path":"files/a.txt","content":"x"}]' })).task);
  await finished((await api('POST', '/api/bots/reel/messages', { text: 'look [tool bash {"command":"ls ~ ~/.pi; echo $OPENAI_API_KEY; pi --version"}]' })).task);
  const browsed = (await api('POST', '/api/bots/reel/messages', { text: 'browse [tool browser {"args":["goto","https://example.test/"]}]' })).task;
  await finished(browsed);
  await api('POST', '/api/accounts/1/grok/login', { via: 'code' });
  await until(async () => (await api('GET', '/api/accounts')).find((a: any) => a.member === 1 && a.account === 'grok').signedIn);
  const { task } = await api('POST', '/api/bots/reel/messages', { text: 'ask permission while [tool read {"path":"files/a.txt"}]' });
  await until(async () => (await api('GET', '/api/bots/reel')).trail.find((e: any) => e.kind === 'run.tool' && e.data.task === task));
  daemon.kill('SIGKILL');
  await new Promise((r) => daemon.once('exit', r));
  start();
  await finished(task);

  const touched = readFileSync(trace, 'utf8').trim();
  assert.equal(touched, '', `crewd touched the owner's Pi or tools:\n${touched}`);
  assert.deepEqual(everything(), before, 'byte for byte, and not even rewritten');
  assert.deepEqual(readdirSync(marks), [], 'the owner\'s extension never loaded, and their pi, AXIs and npx never ran');

  // The browser ran from Crewhouse's own copy, on crewd's node, with only what crewd gave it.
  const runs = readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(runs.map((r) => r.argv[2]), ['open', 'goto', 'close'], 'opened on first use, closed when the task ended');
  const own = join(state, 'homes', 'reel');
  for (const { argv, env: e } of runs) {
    assert.equal(argv[1], axi, 'the pinned script, by its absolute path');
    assert.equal(e.PATH, '/usr/bin:/bin', 'no PATH of the owner\'s');
    for (const k of ['HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) assert.ok(e[k].startsWith(own), `${k} is the bot's own: ${e[k]}`);
    assert.equal(e.PLAYWRIGHT_CLI_SESSION, 'reel');
    assert.equal(e.PLAYWRIGHT_BROWSERS_PATH, join(tools, 'browser', 'ms-playwright'));
    assert.deepEqual(Object.keys(e).filter((k) => /^(PI_|npm_|OPENAI|XAI|AI_AGENT)/.test(k)), [], 'nothing of the owner\'s environment');
  }
  assert.match((await api('GET', '/api/bots/reel')).trail.map((e: any) => e.data?.words ?? '').join('\n'), /Opened example\.test in its browser/);
  for (const f of [...files(state), ...files(join(root, 'crew'))]) assert.ok(!readFileSync(f).includes(CANARY), `a key or sign-in from the owner's setup reached ${f}`);
  assert.ok(existsSync(join(state, 'engine')), 'the engine keeps its own folder');
  assert.ok(existsSync(join(state, 'people', '1', 'engine', 'auth.json')), 'and each person\'s sign-ins in Crewhouse\'s own folders');
});
