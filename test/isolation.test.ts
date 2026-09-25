// Crewhouse's engine is its own copy of Pi. With a decoy of the owner's Pi in HOME (a signed-in auth.json, settings, an
// extension that would leave a mark if loaded, skills, a `pi` on PATH) and the environment a shell inside the owner's pi
// hands down, a full run (tasks with tools, a sign-in, a restart) never reads or writes any of it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { traceFs } from '@byokit/accounts/testing';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-isolation-'));
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
put(join(install, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '0.0.1', piConfig: { name: 'pi', configDir: '.pi' } }));
const bin = join(root, 'bin');
put(join(bin, 'pi'), `#!/bin/sh\necho ran > ${JSON.stringify(join(marks, 'pi'))}\n`);
chmodSync(join(bin, 'pi'), 0o755);
mkdirSync(marks);

const hashes = (dir: string): Record<string, string> => Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).map((e) => { const p = join(e.parentPath, e.name); return [p, createHash('sha256').update(readFileSync(p)).digest('hex') + statSync(p).mtimeMs]; }));
const before = { ...hashes(pi), ...hashes(install), ...hashes(agents) };

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
  CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(port), CREWHOUSE_STATE_DIR: state, CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools'),
  TRACE_ROOTS: [pi, install, agents].join(':'), TRACE_LOG: trace,
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
  await api('POST', '/api/accounts/1/grok/login', { via: 'code' });
  await until(async () => (await api('GET', '/api/accounts')).find((a: any) => a.member === 1 && a.account === 'grok').signedIn);
  const { task } = await api('POST', '/api/bots/reel/messages', { text: 'ask permission while [tool read {"path":"files/a.txt"}]' });
  await until(async () => (await api('GET', '/api/bots/reel')).trail.find((e: any) => e.kind === 'run.tool' && e.data.task === task));
  daemon.kill('SIGKILL');
  await new Promise((r) => daemon.once('exit', r));
  start();
  await finished(task);

  const touched = readFileSync(trace, 'utf8').trim();
  assert.equal(touched, '', `crewd touched the owner's Pi:\n${touched}`);
  assert.deepEqual({ ...hashes(pi), ...hashes(install), ...hashes(agents) }, before, 'byte for byte, and not even rewritten');
  assert.deepEqual(readdirSync(marks), [], 'the owner\'s extension never loaded and their pi never ran');
  for (const f of [...files(state), ...files(join(root, 'crew'))]) assert.ok(!readFileSync(f).includes(CANARY), `a key or sign-in from the owner's setup reached ${f}`);
  assert.ok(existsSync(join(state, 'engine')), 'the engine keeps its own folder');
  assert.ok(existsSync(join(state, 'people', '1', 'engine', 'auth.json')), 'and each person\'s sign-ins in Crewhouse\'s own folders');
});
