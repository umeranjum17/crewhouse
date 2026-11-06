#!/usr/bin/env node
// done-done journey `pi-room`: a room per bot on the shared computer, on the real pinned Pi and a scripted model on loopback (no account, nothing
// spent; the no-room probe tries one connection out). The same endless read and the same reach for the network run with no room and in one; a real crewd on the Pi flag holds two bots mid-turn
// while a third reaches its ceiling; a real crewd in a real user service takes one killed process under each OOM policy; then a machine with no systemd-run,
// on the flag and off it. What the host sees (cgroups, the manager, the model's own log) decides every check, never a bot's reply.
//   node scripts/verify/pi-room.mjs <out-dir>
// Needs node scripts/prepare-pi.mjs and a login manager. Writes no-room.txt, ceiling.txt, memory.txt, door.txt, ports.txt, service.txt, flag-off.txt and the step record.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { holding, release, startModelStub } from '../../test/openclaw-stub.ts';
import { MODEL_URL, openDoor } from '../../bin/pi-door.mjs';
import { bus, CEILING_MB, piBuiltIn, piRoom, piWall } from '../../bin/sandbox.mjs';

const out = process.argv[2], repo = join(import.meta.dirname, '..', '..'), KEY = 'lab-model-key', HOG = '[tool read {"path": "/dev/zero"}]', MB = 1024 * 1024;
if (!out) { console.error('usage: pi-room.mjs <out-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const lab = mkdtempSync('/var/tmp/crewhouse-pi-room-'), model = await startModelStub(), daemons = new Set(), services = new Set();
const log = (file, line) => appendFileSync(join(out, file), `${line}\n`);
const check = (file, ok, what) => { log(file, `${ok ? 'PASS' : 'FAIL'}: ${what}`); if (!ok) throw new Error(`${file}: ${what}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 60_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(50)) { const v = await fn(); if (v) return v; } throw new Error(`timed out: ${what}`); };
const freePort = () => new Promise((r) => { const l = createServer().listen(0, '127.0.0.1', () => { const { port } = l.address(); l.close(() => r(port)); }); });
const mb = (bytes) => `${Math.round(bytes / MB)} MB`;
const manager = (...args) => execFileSync('systemctl', ['--user', ...args], { encoding: 'utf8', env: { ...process.env, ...bus() } });
const unitState = (unit) => Object.fromEntries(manager('show', '-p', 'ActiveState,Result,NRestarts', unit).trim().split('\n').map((l) => l.split('=')));
const kit = async (state) => (await import(join(repo, 'runtime', 'byokit', 'packages', 'pi', 'dist', 'index.js'))).createPiKit({ stateDir: state });
const answer = (bot, text) => new Promise((resolve, reject) => { const off = bot.on((e) => { if (e.type === 'end') { off(); resolve(e.end.text ?? e.end.message); } }); bot.prompt(text).catch(reject); });

const envOf = (root, port, env) => ({ PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: join(root, 'home'), TMPDIR: root, XDG_STATE_HOME: join(root, 'home/.local/state'), XDG_DATA_HOME: join(root, 'home/.local/share'), XDG_CONFIG_HOME: join(root, 'home/.config'), XDG_CACHE_HOME: join(root, 'home/.cache'),
  XDG_RUNTIME_DIR: join(root, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, 'no-bus')}`, CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools'), ...env });
/** How a crewd's API looks from here, wherever it runs. */
const client = async (name, root, port) => {
  const api = async (path, body) => (await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8').trim()}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined })).json();
  await until(`${name} crewd up`, () => api('/api/state').then((s) => s.person, () => false));
  await api('/api/onboard', { address: 'Umer' });
  const ended = (bot, task) => until(`${bot}'s job ${task}`, async () => {
    const page = await api(`/api/bots/${bot}`), t = page.tasks.find((x) => x.id === task);
    if (!t || ['queued', 'working'].includes(t.state)) return undefined;
    return { state: t.state, said: (page.messages ?? []).filter((m) => m.author === 'bot' && m.task_id === task && String(m.text ?? '').trim()).at(-1)?.text ?? t.result ?? '' };
  }, 120_000);
  const post = async (bot, text) => (await api(`/api/bots/${bot}/messages`, { text })).task;
  return { root, api, post, ended, ask: async (bot, text) => ended(bot, await post(bot, text)) };
};
/** A real crewd of its own, in its own process group, with nothing of this shell's environment but what is named. */
async function crewd(name, env) {
  const root = join(lab, name), port = await freePort();
  for (const dir of ['home', 'run']) mkdirSync(join(root, dir), { recursive: true });
  const daemon = spawn(process.execPath, [join(repo, 'src', 'main.ts')], { detached: true, stdio: ['ignore', 'ignore', 'ignore'], env: envOf(root, port, env) });
  daemons.add(daemon);
  return { ...await client(name, root, port), daemon, stop: async () => { try { process.kill(-daemon.pid, 'SIGTERM'); } catch { /* gone */ } await until(`${name} crewd down`, () => daemon.exitCode !== null || daemon.signalCode !== null, 15_000); daemons.delete(daemon); } };
}
/** The Pi working in `work` under crewd `root`: Pi renames itself and sits behind bubblewrap, so it is a descendant. */
const piOf = (root, work) => {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/)), parent = new Map(rows.map(([pid, ppid]) => [pid, ppid]));
  const under = (pid) => { for (let at = parent.get(pid); at; at = parent.get(at)) if (at === String(root)) return true; return false; };
  return rows.find(([pid, , comm]) => comm === 'pi-rpc' && under(pid) && readlinkSync(`/proc/${pid}/cwd`) === work)?.[0];
};
const roomOf = (pid) => join('/sys/fs/cgroup', readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim().split(':')[2]);
const read = (room, file) => { try { return readFileSync(join(room, file), 'utf8').trim(); } catch { return undefined; } };
const count = (room, file, key) => Number(new RegExp(`^${key} (\\d+)$`, 'm').exec(read(room, file) ?? '')?.[1] ?? 0);
const peakRss = (pid) => { try { return Number(/^VmHWM:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024; } catch { return 0; } };

/** What code running inside a Pi finds, as a Pi extension: a bot on Pi has no shell. */
const PROBE = `
import { connect, createServer } from 'node:net'; import { writeFileSync } from 'node:fs';
const tcp = (at, host = '127.0.0.1') => new Promise((r) => { const c = connect({ port: Number(at), host, timeout: 3000 }); c.on('connect', () => { c.destroy(); r('connected'); }); c.on('error', (e) => r(e.code)); c.on('timeout', () => { c.destroy(); r('timed out'); }); });
const door = (path, method = 'POST') => fetch('http://127.0.0.1:3128' + path, { method, body: method === 'POST' ? '{}' : undefined }).then((r) => r.status, (e) => e.cause?.code ?? e.message);
export default () => { setTimeout(async () => {
  const { HOLD, HOST_PORT, MODEL_PORT } = process.env, held = await new Promise((r) => { createServer().on('error', (e) => r(e.code)).listen(Number(HOLD), '127.0.0.1', () => r('bound')); });
  writeFileSync('found.json', JSON.stringify({ 'a port this computer already holds': held, "another program on this computer": await tcp(HOST_PORT), 'the model, direct': await tcp(MODEL_PORT), 'the internet': await tcp(443, '1.1.1.1'), 'the door, asked for a list of models': await door('/v1/models', 'GET'), 'the door, asked for embeddings': await door('/v1/embeddings'), 'the door, asked for an admin path': await door('/admin') }, null, 1));
}, 100); };
`;

/** The same endless read and the same reach, with nothing around Pi: what a bot has today, and why the room exists. */
async function noRoom(ports) {
  const file = 'no-room.txt', state = join(lab, 'no-room'), home = join(state, 'pi', 'loose'), work = join(home, 'work'), probe = join(lab, 'probe.mjs');
  mkdirSync(work, { recursive: true });
  writeFileSync(probe, PROBE);
  writeFileSync(join(home, 'SYSTEM.md'), 'Your id in Crewhouse is loose.');
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ defaultTools: ['read'] }));
  writeFileSync(join(home, 'models.json'), JSON.stringify({ providers: { crewhouse: { baseUrl: model.url, api: 'openai-completions', apiKey: '$CREWHOUSE_MODEL_KEY', models: [{ id: 'test' }] } } }));
  const pi = await kit(state), bot = pi.bot({ id: 'loose', folder: work, session: 'no-room', extensions: [probe], env: { CREWHOUSE_MODEL_KEY: KEY, ...ports } });
  log(file, 'State: no room. The real pinned Pi through the kit with no launcher, Pi\'s read tool on for this proof, the probe loaded beside it.');
  await answer(bot, 'Hello');
  await until('the probe', () => existsSync(join(work, 'found.json')), 30_000);
  const found = JSON.parse(readFileSync(join(work, 'found.json'), 'utf8'));
  for (const [what, got] of Object.entries(found)) log(file, `Reaching ${what}: ${got}`);
  check(file, found['another program on this computer'] === 'connected' && found['the model, direct'] === 'connected', 'with no room the bot reaches everything on this computer');
  check(file, found['a port this computer already holds'] === 'EADDRINUSE', 'and it collides with a port this computer holds');
  const running = answer(bot, HOG); let peak = 0;
  await until(`the read to pass ${CEILING_MB} MB`, () => (peak = peakRss(bot.pid)) > CEILING_MB * MB * 1.5, 30_000); // it climbs about 2 GB a second and only ends with the computer's memory
  process.kill(bot.pid, 'SIGKILL');
  await running;
  log(file, `\nAsked the bot to read an endless file: its process passed ${mb(peak)} with nothing above it, so the proof stopped it there itself`);
  log('memory.txt', `No room: one bot asked to read an endless file passed ${mb(peak)} with no ceiling above it, climbing about 2 GB a second, until this proof stopped it.\n`);
  check(file, peak > CEILING_MB * MB, `with no room nothing held it at ${CEILING_MB} MB`);
  await pi.close();
}

async function ceiling() {
  const file = 'ceiling.txt', table = 'memory.txt', s = await crewd('ceiling', { CREWHOUSE_ENGINE: 'pi', CREWHOUSE_PI_TOOLS: 'read', CREWHOUSE_ENGINE_BASE_URL: model.url, CREWHOUSE_ENGINE_API_KEY: KEY });
  const [hog, a, b] = await Promise.all(['scout', 'scribe', 'reel'].map(async (template) => (await s.api('/api/recruit', { template })).id));
  const work = (bot) => join(s.root, 'state', 'pi', bot, 'work'), pi = (bot) => piOf(s.daemon.pid, work(bot));
  log(file, `State: a real crewd with CREWHOUSE_ENGINE=pi and three bots: ${hog}, ${a}, ${b}. Only the proof turns Pi's read tool on (CREWHOUSE_PI_TOOLS=read).`);
  check(file, (await s.ask(hog, 'Hello')).state === 'done', `${hog} answers first`);
  const [one, two] = [await s.post(a, 'ask permission as one'), await s.post(b, 'ask permission as two')];
  await until('both others mid-turn', () => holding('one') && holding('two'));
  const rooms = { [hog]: roomOf(pi(hog)), [a]: roomOf(pi(a)), [b]: roomOf(pi(b)) }, kept = { [a]: pi(a), [b]: pi(b) }, unit = rooms[hog].split('/').at(-1);
  const row = (bot) => { const room = rooms[bot]; return `${bot}: now ${mb(Number(read(room, 'memory.current')))}, highest ${mb(Number(read(room, 'memory.peak')))}, ceiling ${mb(Number(read(room, 'memory.max')))}, swap ${read(room, 'memory.swap.max')}, killed as a group ${read(room, 'memory.oom.group')}`; };
  log(table, 'Before: three bots in their own rooms, read from each room\'s cgroup.');
  for (const bot of [hog, a, b]) log(table, row(bot));
  check(file, new Set(Object.values(rooms)).size === 3, 'each bot has a room of its own');
  for (const bot of [hog, a, b]) check(file, read(rooms[bot], 'memory.max') === String(CEILING_MB * MB) && read(rooms[bot], 'memory.swap.max') === '0' && read(rooms[bot], 'memory.oom.group') === '1', `${bot}'s room holds ${CEILING_MB} MB, no swap, and dies as one`);

  const task = await s.post(hog, HOG); let high = 0, hits = 0;
  log(file, `\nAsked ${hog} to read an endless file while ${a} and ${b} are mid-turn.`);
  const end = s.ended(hog, task);
  while (!(await Promise.race([end.then(() => true), wait(20).then(() => false)]))) { high = Math.max(high, Number(read(rooms[hog], 'memory.current') ?? 0)); hits = Math.max(hits, count(rooms[hog], 'memory.events', 'oom_kill'), count(rooms[hog], 'memory.events', 'max')); }
  const { state, said } = await end, words = execFileSync('journalctl', ['--user', '-u', `${unit}`, '--no-pager', '-o', 'cat'], { encoding: 'utf8', env: { ...process.env, ...bus() } });
  log(file, `The chat says: ${said}`);
  log(file, `The login manager said of ${unit}:\n${words.trim().split('\n').slice(-3).join('\n')}`);
  log(table, `\nWhile ${hog} read: its room's highest reading was ${mb(high)}, and it reached the ceiling ${hits} time(s) before the kernel stopped it.`);
  check(file, state === 'failed' && said === `This job needed more than the ${CEILING_MB} MB of memory a bot may use, so Crewhouse stopped it. The other bots carried on.`, `${hog}'s job ends on the plain line`);
  check(file, /oom-kill/.test(words), 'the manager names the memory ceiling as the cause');
  check(file, high <= CEILING_MB * MB && high > CEILING_MB * MB * 0.5, `its room never held more than ${CEILING_MB} MB`);
  check(file, !pi(hog) && !existsSync(rooms[hog]), 'nothing of it is left: no Pi, no room');
  for (const bot of [a, b]) check(file, pi(bot) === kept[bot] && count(rooms[bot], 'memory.events', 'oom_kill') === 0, `${bot} is the same process, and its room lost nothing`);
  release('one', 'First answered');
  release('two', 'Second answered');
  const answers = [await s.ended(a, one), await s.ended(b, two)];
  log(file, `${a} says: ${answers[0].said}\n${b} says: ${answers[1].said}`);
  check(file, answers.every((x) => x.state === 'done') && answers[0].said === 'First answered' && answers[1].said === 'Second answered', 'both others answered their turns');
  const back = await s.ask(hog, 'Back again');
  check(file, back.state === 'done', `${hog}'s next message starts a fresh room and answers`);
  rooms[hog] = roomOf(pi(hog));
  log(table, '\nAfter: the two who carried on, and a fresh room for the one that was stopped.');
  for (const bot of [hog, a, b]) log(table, row(bot));

  const door = 'door.txt', home = join(s.root, 'state', 'pi', hog), environ = readFileSync(`/proc/${pi(hog)}/environ`, 'utf8');
  log(door, `The model saw ${model.calls.length} calls: ${[...new Set(model.calls.map((c) => `POST ${c.path}, key ${c.authorization === `Bearer ${KEY}` ? 'the real one' : c.authorization}`))].join('; ')}`);
  check(door, model.calls.length > 0 && model.calls.every((c) => c.path === '/v1/chat/completions' && c.authorization === `Bearer ${KEY}`), 'every model call came through the door with the real key, added there');
  log(door, `What the bot has in models.json: ${JSON.stringify(JSON.parse(readFileSync(join(home, 'models.json'), 'utf8')).providers.crewhouse).replace(/,"models".*/, '}')}`);
  check(door, !readFileSync(join(home, 'models.json'), 'utf8').includes(KEY), 'the key is not in the file the bot reads');
  check(door, !environ.includes(KEY), 'and not in the running Pi\'s environment');
  check(door, readdirSync(work(hog), { recursive: true, encoding: 'utf8' }).every((f) => { try { return !readFileSync(join(work(hog), f), 'utf8').includes(KEY); } catch { return true; } }), 'and not anywhere in the bot\'s folder');
  await s.stop();
  await until('no Pi after crewd stops', () => Object.values(kept).every((p) => !existsSync(`/proc/${p}`)), 15_000);
  check(file, true, 'crewd stopped, and no Pi is left running');
}

/** Two bots in their rooms beside a port this computer holds, driven through the kit as crewd drives it, with the probe loaded: crewd loads only the reviewed list. */
async function ports(env) {
  const file = 'ports.txt', state = join(lab, 'ports'), sock = join(state, 'door.sock'), probe = join(lab, 'probe.mjs');
  mkdirSync(state, { recursive: true });
  const door = await openDoor(sock, { baseUrl: model.url, apiKey: KEY }), pi = await kit(state), calls = model.calls.length;
  log(file, `State: two bots in their rooms, the same launcher and door crewd uses, the probe loaded. This computer holds port ${env.HOLD}, and another program listens on ${env.HOST_PORT}.`);
  const one = async (id) => {
    const home = join(state, 'pi', id), folder = join(home, 'work'), extensions = [...piBuiltIn(repo), probe];
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(home, 'SYSTEM.md'), `Your id in Crewhouse is ${id}.`);
    writeFileSync(join(home, 'settings.json'), '{"defaultTools":[]}');
    writeFileSync(join(home, 'models.json'), JSON.stringify({ providers: { crewhouse: { baseUrl: MODEL_URL, api: 'openai-completions', apiKey: 'added-at-the-door', models: [{ id: 'test' }] } } }));
    const bot = pi.bot({ id, folder, session: id, extensions, env: { ...bus(), ...env }, launch: ({ command, args }) => ({ command: 'systemd-run', args: [...piRoom(`crewhouse-lab-${id}-${process.pid}`), 'bwrap', ...piWall({ folder, home, repo, extensions, door: sock }), command, ...args] }) });
    const said = await answer(bot, 'Hello');
    await until(`${id}'s probe`, () => existsSync(join(folder, 'found.json')), 30_000);
    return { said, found: JSON.parse(readFileSync(join(folder, 'found.json'), 'utf8')) };
  };
  for (const [id, { said, found }] of Object.entries({ one: await one('one'), two: await one('two') })) {
    log(file, `\n${id} says: ${said}`);
    for (const [what, got] of Object.entries(found)) log(file, `Reaching ${what}: ${got}`);
    check(file, /done/.test(said), 'its model call got through the door');
    check(file, found['a port this computer already holds'] === 'bound', 'it holds the same port as the other bot and this computer, each on its own network');
    check(file, found['another program on this computer'] === 'ECONNREFUSED' && found['the model, direct'] === 'ECONNREFUSED', 'nothing on this computer is reachable from it');
    check(file, found['the internet'] === 'ENETUNREACH', 'nor is the internet');
    check(file, ['the door, asked for a list of models', 'the door, asked for embeddings', 'the door, asked for an admin path'].every((k) => found[k] === 403), 'and the door refuses everything but a model call');
  }
  check(file, model.calls.slice(calls).every((c) => c.path === '/v1/chat/completions' && c.authorization === `Bearer ${KEY}`), 'the model saw only model calls, with the real key');
  await pi.close();
  door.close();
}

/** The one policy line the product's own writer puts in a service on the flag: its unit, with a manager that says yes. */
function writtenPolicy(flag) {
  const home = join(lab, `unit-${flag}`), bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true }); writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  execFileSync(join(repo, 'crewhouse'), ['autostart', 'on'], { cwd: repo, stdio: 'ignore', env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, LANG: 'C.UTF-8', TMPDIR: home, CREWHOUSE_RUN_MODE: 'product', ...(flag === 'on' ? { CREWHOUSE_ENGINE: 'pi' } : {}) } });
  return /^OOMPolicy=(.*)$/m.exec(readFileSync(join(home, '.config/systemd/user/crewhouse.service'), 'utf8'))?.[1];
}

/** A real crewd in a real user service, with one process in that service killed for memory, under the given policy (the manager's default when none). */
async function service(policy) {
  const file = 'service.txt', name = `pi-room-${policy ?? 'default'}`, root = join(lab, name), port = await freePort(), unit = `crewhouse-lab-${name}-${process.pid}.service`, go = join(root, 'go'), pidFile = join(root, 'crewd.pid');
  for (const dir of ['home', 'run']) mkdirSync(join(root, dir), { recursive: true });
  const env = envOf(root, port, { CREWHOUSE_ENGINE: 'pi', CREWHOUSE_PI_TOOLS: 'read', CREWHOUSE_ENGINE_BASE_URL: model.url, CREWHOUSE_ENGINE_API_KEY: KEY });
  // crewd, then a greedy process beside it in the same service once the file appears: what a screen or a tool of crewd's would be.
  const script = `${process.execPath} src/main.ts & echo $! > ${pidFile}; until [ -e ${go} ]; do sleep 0.1; done; ${process.execPath} -e 'const a=[];for(;;)a.push(Buffer.alloc(1048576,1))'; wait`;
  execFileSync('systemd-run', ['--user', `--unit=${unit}`, '--quiet', `--working-directory=${repo}`, '-p', 'MemoryMax=600M', '-p', 'MemorySwapMax=0', ...(policy ? ['-p', `OOMPolicy=${policy}`] : []), ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`), '/bin/sh', '-c', script], { env: { ...process.env, ...bus() } });
  services.add(unit);
  const s = await client(name, root, port), { id } = await s.api('/api/recruit', { template: 'scout' }), crewdPid = readFileSync(pidFile, 'utf8').trim();
  log(file, `\nState: a real crewd in the user service ${unit.replace(`-${process.pid}`, '')}, OOMPolicy ${policy ?? 'left to the manager'}, a 600 MB limit on the service for this proof.`);
  check(file, (await s.ask(id, 'Good morning')).state === 'done', 'a bot answers through the service\'s crewd');
  writeFileSync(go, '');
  return { s, id, unit, crewdPid, file };
}

async function serviceKilled() {
  const { s, unit, crewdPid, file } = await service();
  await until('the service to stop', () => unitState(unit).ActiveState !== 'active', 60_000);
  const st = unitState(unit);
  log(file, `One process in the service was killed for memory. The manager: ${st.ActiveState}, ${st.Result}. crewd: ${existsSync(`/proc/${crewdPid}`) ? 'still running' : 'gone'}.`);
  await until('crewd gone', () => !existsSync(`/proc/${crewdPid}`), 30_000);
  check(file, st.Result === 'oom-kill', 'with the manager\'s default the one death took the whole service down, crewd with it');
  check(file, await s.api('/api/state').then(() => false, () => true), 'and nothing answers');
  manager('reset-failed', unit);
  services.delete(unit);
}

async function serviceContinues(policy) {
  const { s, id, unit, crewdPid, file } = await service(policy);
  const cgroup = join('/sys/fs/cgroup', manager('show', '--value', '-p', 'ControlGroup', unit).trim());
  await until('the kernel to kill the greedy process', () => count(cgroup, 'memory.events', 'oom_kill') > 0, 60_000);
  await until('the greedy process gone', () => read(cgroup, 'cgroup.procs')?.split('\n').length <= 3, 30_000);
  const st = unitState(unit);
  log(file, `One process in the service was killed for memory (the service's oom_kill count: ${count(cgroup, 'memory.events', 'oom_kill')}). The manager: ${st.ActiveState}, restarts ${st.NRestarts}. crewd: ${existsSync(`/proc/${crewdPid}`) ? 'still running' : 'gone'}.`);
  check(file, st.ActiveState === 'active' && existsSync(`/proc/${crewdPid}`), 'with the flag\'s policy the service and crewd stay up, the same process');
  check(file, (await s.ask(id, 'Still there?')).state === 'done', 'and a bot still answers');
  const end = await s.ask(id, HOG);
  log(file, `A bot in its room then reached its ceiling. The chat says: ${end.said}`);
  check(file, end.state === 'failed' && /needed more than/.test(end.said) && unitState(unit).ActiveState === 'active', 'and that stopped only the bot: the service stays up');
  manager('stop', unit);
  services.delete(unit);
  await until('crewd stopped with its service', () => !existsSync(`/proc/${crewdPid}`), 30_000);
}

/** A folder of programs with git and a real bubblewrap, and no systemd-run. */
const noManager = () => { const dir = join(lab, 'bin'), real = (name) => execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim(); mkdirSync(dir); for (const name of ['git', 'bwrap']) symlinkSync(real(name), join(dir, name)); writeFileSync(join(dir, 'true'), '#!/bin/sh\n', { mode: 0o755 }); return dir; };

async function flagOff(path, policyOff) {
  const file = 'flag-off.txt', on = await crewd('no-manager', { PATH: path, CREWHOUSE_ENGINE: 'pi', CREWHOUSE_ENGINE_BASE_URL: model.url, CREWHOUSE_ENGINE_API_KEY: KEY });
  log(file, 'State: the Pi flag on, on a machine with no systemd-run.');
  const engine = await until('the engine to report', () => on.api('/api/state').then((st) => st.engine?.phase === 'failed' && st.engine, () => false));
  log(file, `The app's engine line: ${engine.words}`);
  const { id } = await on.api('/api/recruit', { template: 'scout' }), asked = model.calls.length, end = await on.ask(id, 'Good morning');
  log(file, `The chat says: ${end.said}`);
  check(file, /own memory limit: systemd-run is not on this computer/.test(engine.words), 'the boot refuses, in one line that names the cause and the fix');
  check(file, end.state === 'failed' && end.said === engine.words && model.calls.length === asked, 'a job ends on that same line: no model was asked, and it does not run without its room');
  await on.stop();
  const off = await crewd('flag-off', { PATH: path, CREWHOUSE_ENGINE: 'stub' });
  log(file, '\nState: the Pi flag off, on the same machine.');
  const { id: bot } = await off.api('/api/recruit', { template: 'scout' }), done = await off.ask(bot, 'Good morning'), st = await off.api('/api/state');
  log(file, `The chat says: ${done.said}`);
  check(file, done.state === 'done' && st.engine?.phase !== 'failed', 'with the flag off no room is asked for: the job finishes as before');
  check(file, !existsSync(join(off.root, 'state', 'pi')), 'and nothing of Pi was made: no door, no room');
  check(file, policyOff === undefined, 'and the login service\'s unit carries no OOM policy');
  await off.stop();
}

let failed = 0;
const hold = createServer(), spare = createServer();
try {
  for (const name of ['no-room.txt', 'ceiling.txt', 'memory.txt', 'door.txt', 'ports.txt', 'service.txt', 'flag-off.txt']) rmSync(join(out, name), { force: true });
  await Promise.all([hold, spare].map((l) => new Promise((r) => l.listen(0, '127.0.0.1', r))));
  const env = { HOLD: String(hold.address().port), HOST_PORT: String(spare.address().port), MODEL_PORT: new URL(model.url).port };
  await noRoom(env);
  await ceiling();
  await ports(env);
  const policy = writtenPolicy('on'), policyOff = writtenPolicy('off');
  log('service.txt', `The unit the product writes: OOMPolicy=${policy} on the flag; ${policyOff ?? 'no OOMPolicy line'} off it.`);
  await serviceKilled();
  await serviceContinues(policy);
  await flagOff(noManager(), policyOff);
  execFileSync(process.execPath, [join(repo, 'scripts', 'verify', 'steps.mjs'), out, 'pi-room'], { stdio: 'inherit' });
  console.log(`pi-room: one bot stopped at its ceiling while two others answered; captures in ${out}`);
} catch (e) { failed = 1; console.error(`pi-room: ${e.message}`); }
hold.close(); spare.close();
for (const unit of services) { try { manager('stop', unit); } catch { /* stopped */ } try { manager('reset-failed', unit); } catch { /* collected */ } }
for (const daemon of daemons) { try { process.kill(-daemon.pid, 'SIGKILL'); } catch { /* gone */ } }
void model.close();
await until('every crewd gone', () => [...daemons].every((d) => d.exitCode !== null || d.signalCode !== null), 10_000).catch(() => {});
execFileSync('chmod', ['-R', 'u+w', lab]);
rmSync(lab, { recursive: true, force: true });
process.exit(failed);
