#!/usr/bin/env node
// done-done journey `pi-wall`: a bot's whole Pi process behind bubblewrap, on the real pinned Pi and a scripted model on loopback (no account, no
// network, nothing spent). The same deliberate escape runs in both states: with no wall, the kit driven with no launcher, and with the wall, a real
// crewd on the Pi flag. Then a machine without bubblewrap, on the flag and off it. What the host sees decides every check, never the bot's reply.
// Lives off /tmp, as a person's files do: inside the wall /tmp is the bot's own throwaway.
//   node scripts/verify/pi-wall.mjs <out-dir>
// Needs node scripts/prepare-pi.mjs. Writes no-wall.txt, with-wall.txt, launcher.txt, mounts.txt, no-sandbox.txt, flag-off.txt and the step record.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { startModelStub } from '../../test/openclaw-stub.ts';

const out = process.argv[2], repo = join(import.meta.dirname, '..', '..'), KEY = 'lab-model-key', LINE = "That's outside my folder, so I can't open it.";
if (!out) { console.error('usage: pi-wall.mjs <out-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const lab = mkdtempSync('/var/tmp/crewhouse-pi-wall-'), model = await startModelStub(), daemons = new Set();
const log = (file, line) => appendFileSync(join(out, file), `${line}\n`);
const check = (file, ok, what) => { log(file, `${ok ? 'PASS' : 'FAIL'}: ${what}`); if (!ok) throw new Error(`${file}: ${what}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 60_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(50)) { const v = await fn(); if (v) return v; } throw new Error(`timed out: ${what}`); };
const freePort = () => new Promise((r) => { const l = createServer().listen(0, '127.0.0.1', () => { const { port } = l.address(); l.close(() => r(port)); }); });
const tree = (dir) => { const hash = createHash('sha256'); for (const f of readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) { hash.update(f); try { hash.update(readFileSync(join(dir, f))); } catch { /* a folder */ } } return hash.digest('hex'); };
/** A stand-in person: the files an escape is after. */
const person = (root) => { const dir = join(root, 'person'); mkdirSync(join(dir, 'Documents'), { recursive: true }); writeFileSync(join(dir, 'Documents', 'tax.txt'), 'the person\'s own file\n'); return dir; };
const writeCall = (path) => `[tool write ${JSON.stringify({ path, content: 'written by the bot' })}]`;

/** A real crewd of its own, in its own process group, with nothing of this shell's environment but what is named. */
async function crewd(name, env) {
  const root = join(lab, name), port = await freePort();
  for (const dir of ['home', 'run']) mkdirSync(join(root, dir), { recursive: true });
  const daemon = spawn(process.execPath, [join(repo, 'src', 'main.ts')], { detached: true, stdio: ['ignore', 'ignore', 'ignore'], env: {
    PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: join(root, 'home'), TMPDIR: root, XDG_STATE_HOME: join(root, 'home/.local/state'), XDG_DATA_HOME: join(root, 'home/.local/share'), XDG_CONFIG_HOME: join(root, 'home/.config'), XDG_CACHE_HOME: join(root, 'home/.cache'),
    XDG_RUNTIME_DIR: join(root, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, 'no-bus')}`, CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools'), ...env } });
  daemons.add(daemon);
  const api = async (path, body) => (await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8').trim()}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined })).json();
  await until(`${name} crewd up`, () => api('/api/state').then((s) => s.person, () => false));
  await api('/api/onboard', { address: 'Umer' });
  const ask = async (bot, text) => {
    const { task } = await api(`/api/bots/${bot}/messages`, { text });
    return until(`${bot}'s job ${task}`, async () => {
      const page = await api(`/api/bots/${bot}`), t = page.tasks.find((x) => x.id === task);
      if (!t || ['queued', 'working'].includes(t.state)) return undefined;
      return { state: t.state, said: (page.messages ?? []).filter((m) => m.author === 'bot' && m.task_id === task && String(m.text ?? '').trim()).at(-1)?.text ?? t.result ?? '' };
    });
  };
  return { root, daemon, api, ask, stop: async () => { try { process.kill(-daemon.pid, 'SIGTERM'); } catch { /* gone */ } await until(`${name} crewd down`, () => daemon.exitCode !== null || daemon.signalCode !== null, 15_000); daemons.delete(daemon); } };
}

/** A Pi under this crewd and the bubblewrap above it, the one working in `work` if named: Pi renames itself, and sits behind bubblewrap, so it is a descendant. */
const piOf = (root, work) => {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/)), parent = new Map(rows.map(([pid, ppid]) => [pid, ppid]));
  const chain = (pid) => { const up = []; for (let at = parent.get(pid); at; at = parent.get(at)) up.push(at); return up; };
  const pi = rows.find(([pid, , comm]) => comm === 'pi-rpc' && chain(pid).includes(String(root)) && (!work || readlinkSync(`/proc/${pid}/cwd`) === work))?.[0];
  return pi ? { pi, wall: chain(pi).find((p) => p !== '1' && parent.get(p) === String(root)) } : undefined;
};

async function noWall() {
  const file = 'no-wall.txt', root = join(lab, 'no-wall'), mine = person(root), state = join(root, 'state'), home = join(state, 'pi', 'scout'), work = join(home, 'work'), target = join(mine, 'Documents', 'escape.txt');
  mkdirSync(work, { recursive: true });
  writeFileSync(join(home, 'SYSTEM.md'), 'Your id in Crewhouse is scout.');
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ defaultTools: ['write'] }));
  writeFileSync(join(home, 'models.json'), JSON.stringify({ providers: { crewhouse: { baseUrl: model.url, api: 'openai-completions', apiKey: '$CREWHOUSE_MODEL_KEY', models: [{ id: 'test' }] } } }));
  const { createPiKit } = await import(join(repo, 'runtime', 'byokit', 'packages', 'pi', 'dist', 'index.js'));
  const kit = createPiKit({ stateDir: state }), bot = kit.bot({ id: 'scout', folder: work, session: 'no-wall', extensions: [], env: { CREWHOUSE_MODEL_KEY: KEY } });
  log(file, 'State: no wall. The real pinned Pi through the kit with no launcher, the Pi write tool on, a stand-in person beside it.');
  log(file, `Asked the bot to write: ${target}`);
  const said = await new Promise((resolve, reject) => { const off = bot.on((e) => { if (e.type === 'end') { off(); resolve(e.end.text ?? e.end.message); } }); bot.prompt(writeCall(target)).catch(reject); });
  log(file, `The bot read: ${said}`);
  check(file, existsSync(target), 'the escape got out: the file is on the host, in the person\'s Documents');
  await kit.close();
}

async function withWall() {
  const file = 'with-wall.txt', s = await crewd('wall', { CREWHOUSE_ENGINE: 'pi', CREWHOUSE_PI_TOOLS: 'write', CREWHOUSE_ENGINE_BASE_URL: model.url, CREWHOUSE_ENGINE_API_KEY: KEY });
  const mine = person(s.root), target = join(mine, 'Documents', 'escape.txt'), before = tree(mine);
  log(file, 'State: the wall. A real crewd with CREWHOUSE_ENGINE=pi; only the proof turns Pi\'s write tool on (CREWHOUSE_PI_TOOLS=write).');
  const { id: scout } = await s.api('/api/recruit', { template: 'scout' }), { id: other } = await s.api('/api/recruit', { template: 'scribe' });
  await s.ask(other, 'Hello'); // the neighbour's folder exists
  const home = join(s.root, 'state', 'pi', scout), work = join(home, 'work'), neighbour = join(s.root, 'state', 'pi', other, 'work');

  const inside = join(work, 'notes', 'mine.txt'), ok = await s.ask(scout, writeCall(inside));
  log(file, `\nAsked the bot to write inside its folder: ${inside}\nThe bot read: ${ok.said}`);
  check(file, ok.state === 'done' && readFileSync(inside, 'utf8') === 'written by the bot', 'the write inside the folder is on the host');

  const seen = piOf(s.daemon.pid, work);
  check(file, !!seen?.wall, 'Pi runs under bubblewrap under crewd');
  const argv = readFileSync(`/proc/${seen.wall}/cmdline`, 'utf8').split('\0').slice(0, -1), own = (pid, ns) => readlinkSync(`/proc/${pid}/ns/${ns}`);
  writeFileSync(join(out, 'launcher.txt'), `The command the kit ran for ${scout}, read from the running process, one argument per line:\n${argv.join('\n')}\n`);
  check(file, readFileSync(`/proc/${seen.wall}/comm`, 'utf8').trim() === 'bwrap' && argv.includes('--disable-userns') && argv.includes('--die-with-parent') && !argv.includes(KEY), 'the launcher is bubblewrap, and the model key is not on its command line');
  check(file, ['mnt', 'pid', 'user', 'ipc', 'uts', 'cgroup', 'net'].every((ns) => own(seen.pi, ns) !== own('self', ns)), 'Pi has its own mount, process, user, ipc, uts, cgroup and network namespaces');
  const mounts = readFileSync(`/proc/${seen.pi}/mountinfo`, 'utf8').trim().split('\n').map((l) => l.split(' ')).map((f) => ({ at: f[4], mode: f[5].split(',')[0], type: f[f.indexOf('-') + 1] }));
  writeFileSync(join(out, 'mounts.txt'), `What Pi's own process has mounted, from its mount table on the host:\n${mounts.map((m) => `${m.mode} ${m.type} ${m.at}`).join('\n')}\n`);
  const writable = mounts.filter((m) => m.mode === 'rw' && !m.at.startsWith('/dev'));
  log(file, `\nWritable mounts: ${writable.map((m) => `${m.at} (${m.type})`).join(', ')}`);
  check(file, writable.filter((m) => m.type !== 'tmpfs').every((m) => m.at === work) && writable.some((m) => m.at === work), 'the bot\'s folder is the only writable place on a real disk');
  check(file, writable.filter((m) => m.type === 'tmpfs').every((m) => [home, '/tmp'].includes(m.at)), 'the only other writable places are throwaways: Pi\'s home and /tmp');

  for (const [name, path] of [['the person\'s Documents', target], ['the person\'s home', join(mine, 'made-by-the-bot', 'escape.txt')], ['another bot\'s folder', join(neighbour, 'escape.txt')], ['Crewhouse\'s control key', join(s.root, 'state', 'person.key')], ['its own model setup', join(home, 'models.json')]]) {
    const was = existsSync(path) ? readFileSync(path, 'utf8') : undefined, end = await s.ask(scout, writeCall(path));
    log(file, `\nAsked the bot to write to ${name}: ${path}\nThe chat says: ${end.said}`);
    check(file, end.state === 'done' && end.said.includes(LINE), 'refused, in the plain line, and the job carried on');
    check(file, (existsSync(path) ? readFileSync(path, 'utf8') : undefined) === was, 'and the host shows nothing changed there');
  }
  log(file, '');
  check(file, tree(mine) === before, 'the stand-in person\'s folder hashes the same before and after');
  const after = await s.ask(scout, writeCall(join(work, 'after.txt')));
  check(file, after.state === 'done' && existsSync(join(work, 'after.txt')), 'the bot keeps working after the refusals');
  await s.stop();
  await until('no Pi after crewd stops', () => !existsSync(`/proc/${seen.pi}`) && !existsSync(`/proc/${seen.wall}`), 15_000);
  check(file, true, 'crewd stopped, and neither Pi nor its bubblewrap is left running');
}

/** A folder of programs with git, which crewd needs, and no bubblewrap. */
const noBubblewrap = () => { const dir = join(lab, 'bin'); mkdirSync(dir); symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(dir, 'git')); return dir; };

async function noSandbox(path) {
  const file = 'no-sandbox.txt', s = await crewd('no-sandbox', { PATH: path, CREWHOUSE_ENGINE: 'pi', CREWHOUSE_PI_TOOLS: 'write', CREWHOUSE_ENGINE_BASE_URL: model.url, CREWHOUSE_ENGINE_API_KEY: KEY });
  log(file, 'State: the Pi flag on, on a machine with no bubblewrap.');
  const engine = await until('the engine to report', () => s.api('/api/state').then((st) => st.engine?.phase === 'failed' && st.engine, () => false));
  log(file, `The app's engine line: ${engine.words}`);
  const { id } = await s.api('/api/recruit', { template: 'scout' }), asked = model.calls.length, end = await s.ask(id, 'Good morning');
  log(file, `The chat says: ${end.said}`);
  check(file, /bubblewrap is not installed/.test(engine.words) && /sudo apt install bubblewrap/.test(engine.words), 'the boot refuses, in one line that names the cause and the fix');
  check(file, end.state === 'failed' && end.said === engine.words, 'a job ends on that same line');
  check(file, model.calls.length === asked && !piOf(s.daemon.pid), 'no model was asked and no Pi ran: it does not fall back to running without the wall');
  await s.stop();
}

async function flagOff(path) {
  const file = 'flag-off.txt', s = await crewd('flag-off', { PATH: path, CREWHOUSE_ENGINE: 'stub' });
  log(file, 'State: the Pi flag off, on the same machine with no bubblewrap.');
  const { id } = await s.api('/api/recruit', { template: 'scout' }), end = await s.ask(id, 'Good morning'), st = await s.api('/api/state');
  log(file, `The chat says: ${end.said}`);
  check(file, end.state === 'done' && st.engine?.phase !== 'failed', 'with the flag off the wall is not asked for: the job finishes as before');
  check(file, !existsSync(join(s.root, 'state', 'pi')), 'and nothing of Pi was made');
  await s.stop();
}

let failed = 0;
try {
  for (const name of ['no-wall.txt', 'with-wall.txt', 'no-sandbox.txt', 'flag-off.txt']) rmSync(join(out, name), { force: true });
  await noWall();
  await withWall();
  const path = noBubblewrap();
  await noSandbox(path);
  await flagOff(path);
  execFileSync(process.execPath, [join(repo, 'scripts', 'verify', 'steps.mjs'), out, 'pi-wall'], { stdio: 'inherit' });
  console.log(`pi-wall: the escape got out with no wall and was refused with it; captures in ${out}`);
} catch (e) { failed = 1; console.error(`pi-wall: ${e.message}`); }
for (const daemon of daemons) { try { process.kill(-daemon.pid, 'SIGKILL'); } catch { /* gone */ } }
void model.close();
await until('every crewd gone', () => [...daemons].every((d) => d.exitCode !== null || d.signalCode !== null), 10_000).catch(() => {});
execFileSync('chmod', ['-R', 'u+w', lab]);
rmSync(lab, { recursive: true, force: true });
process.exit(failed);
