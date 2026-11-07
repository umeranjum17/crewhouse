#!/usr/bin/env node
// done-done journey `pi-signin`: a person signs in on Pi and a bot answers a job, on a real crewd started with CREWHOUSE_ENGINE=pi (no
// engine, no env provider), the real pinned Pi behind its wall and the sign-in sheet's own API calls. The person asks Chief first and the job
// waits; they start the key sign-in, paste a wrong key (refused in plain words, the card stays open) and then the right one (signed in); the waiting
// job starts by itself and Chief answers in the chat; the key is on no disk in the clear and a stand-in ~/.pi hashes the same; crewd restarts and a second job answers on the saved key; signing out ends it.
//   node scripts/verify/pi-signin.mjs <out-dir>                    a provider of the journey's own that refuses every key but one, then a scripted model (nothing spent)
//   node scripts/verify/pi-signin.mjs <out-dir> <minimax-key-file>  the real MiniMax (a handful of 1-token and tiny calls on that key, which is read from the file into crewd's paste and nowhere else)
// PI_SIGNIN_SHOTS=on also drives the built app (npm run build:web; chrome-devtools-axi with CHROME_DEVTOOLS_AXI_SESSION set): signin-1-refused, signin-2-signed-in and signin-3-chief shots.
// Needs node scripts/prepare-pi.mjs. Writes signin.txt (the transcript) and the step record.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as http, request as ask } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { startModelStub } from '../../test/openclaw-stub.ts';

const out = process.argv[2], keyFile = process.argv[3], repo = join(import.meta.dirname, '..', '..'), real = !!keyFile, GOOD = real ? readFileSync(keyFile, 'utf8').trim() : 'sk-lab-good-key-9f3a', WRONG = 'sk-not-a-real-key';
if (!out) { console.error('usage: pi-signin.mjs <out-dir> [minimax-key-file]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const lab = mkdtempSync('/var/tmp/crewhouse-pi-signin-'), file = join(out, 'signin.txt');
rmSync(file, { force: true });
const log = (line) => appendFileSync(file, `${line}\n`), wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, what) => { log(`${ok ? 'PASS' : 'FAIL'}: ${what}`); if (!ok) throw new Error(what); };
const until = async (what, fn, ms = 90_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(100)) { const v = await fn(); if (v) return v; } throw new Error(`timed out: ${what}`); };
const freePort = () => new Promise((r) => { const l = createServer().listen(0, '127.0.0.1', () => { const { port } = l.address(); l.close(() => r(port)); }); });
const tree = (dir) => { const h = createHash('sha256'); for (const f of readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) { h.update(f); try { h.update(readFileSync(join(dir, f))); } catch { /* a folder */ } } return h.digest('hex'); };

let model, provider, daemon, failed = 0;
const stop = async () => { if (!daemon) return; try { process.kill(-daemon.pid, 'SIGTERM'); } catch { /* gone */ } const d = daemon; await until('crewd gone', () => d.exitCode !== null || d.signalCode !== null, 15_000).catch(() => { try { process.kill(-d.pid, 'SIGKILL'); } catch { /* gone */ } }); };
try {
  // The provider the journey owns: it refuses every key but one, like the real one, and hands the rest to the scripted model.
  const env = {};
  if (!real) {
    model = await startModelStub();
    provider = http((req, res) => {
      if (req.headers.authorization !== `Bearer ${GOOD}`) { res.writeHead(401, { 'content-type': 'application/json' }); req.resume(); return void res.end('{"error":{"message":"Invalid API key"}}'); }
      const up = ask(new URL(req.url, model.url), { method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
      req.pipe(up);
    });
    await new Promise((r) => provider.listen(0, '127.0.0.1', r));
    env.CREWHOUSE_PI_ROUTE_BASE = `http://127.0.0.1:${provider.address().port}/v1`;
  }
  const root = join(lab, 'crewd'), port = await freePort(), standIn = join(root, 'home', '.pi', 'agent');
  for (const dir of ['run', 'tools']) mkdirSync(join(root, dir), { recursive: true });
  mkdirSync(standIn, { recursive: true }); writeFileSync(join(standIn, 'auth.json'), '{"canary":{"type":"api_key","key":"CANARY"}}');
  const before = tree(join(root, 'home', '.pi'));
  const boot = () => spawn(process.execPath, [join(repo, 'src', 'main.ts')], { detached: true, stdio: ['ignore', 'ignore', 'ignore'], env: {
    PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: join(root, 'home'), TMPDIR: root, XDG_STATE_HOME: join(root, 'home/.local/state'), XDG_DATA_HOME: join(root, 'home/.local/share'), XDG_CONFIG_HOME: join(root, 'home/.config'), XDG_CACHE_HOME: join(root, 'home/.cache'),
    XDG_RUNTIME_DIR: join(root, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, 'no-bus')}`, CREWHOUSE_ENGINE: 'pi', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools'), ...env } });
  daemon = boot();
  const api = async (path, body) => (await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8').trim()}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined })).json();
  await until('crewd up', () => api('/api/state').then((s) => s.person, () => false), 30_000);
  await api('/api/onboard', { address: 'Umer' });
  const row = async () => (await api('/api/accounts')).find((a) => a.account === 'minimax');
  const chat = async (task) => { const page = await api('/api/bots/chief'), t = page.tasks.find((x) => x.id === task); return { state: t?.state, said: (page.messages ?? []).filter((m) => m.author === 'bot' && m.task_id === task && String(m.text ?? '').trim()).at(-1)?.text ?? '' }; };

  log(`State: a real crewd with CREWHOUSE_ENGINE=pi and no AI account. The provider is ${real ? 'the real MiniMax' : "the journey's own, refusing every key but one, in front of a scripted model"}.`);
  check(!(await row()).signedIn, 'MiniMax is not signed in to start with');
  log('Person asks Chief: "Good morning"');
  const { task } = await api('/api/bots/chief/messages', { text: 'Good morning' });
  await until('the job waits for a sign-in', async () => (await chat(task)).state === 'paused', 30_000);
  check(true, 'with no AI account the job waits (paused) and nothing is asked of any model');
  if (model) check(model.calls.length === 0, 'the model heard nothing before the sign-in');

  log('Person taps Sign in with MiniMax (the key sheet)');
  const started = (await api('/api/accounts/1/minimax/login', { via: 'key' })).signIn;
  check(started.state === 'waiting' && started.via === 'key', 'the card waits for a pasted key');
  log('Person pastes a wrong key');
  await api('/api/accounts/1/minimax/paste', { text: WRONG });
  const refused = (await row()).signIn;
  log(`The card says: ${refused.error}`);
  check(refused.state === 'waiting' && /That key didn't work/.test(refused.error) && !(await row()).signedIn, 'a refused key leaves the card open, with the plain line, and signs nothing in');
  log('Person pastes the right key (not printed here)');
  await api('/api/accounts/1/minimax/paste', { text: GOOD });
  await until('signed in', async () => (await row()).signedIn, 30_000);
  check((await row()).signIn?.state === 'done', 'the card ends done and MiniMax shows signed in');

  const end = await until('the waiting job answers', async () => { const c = await chat(task); return ['queued', 'working', 'paused'].includes(c.state) ? undefined : c; });
  log(`The chat says: ${end.said}`);
  check(end.state === 'done' && end.said.trim().length > 0, 'the job that was waiting started by itself and Chief answered in the chat');
  if (model) {
    check(/stub chief: done with "The person says: Good morning"/.test(end.said), "Chief's own prompt reached the model through Pi and his answer is the chat's");
    check(model.calls.at(-1).authorization === `Bearer ${GOOD}`, 'the door added the saved key to the model call');
  } else check(!/^stub /.test(end.said), 'the answer is a real model\'s, not the scripted one');

  const files = readdirSync(join(root, 'state'), { recursive: true, encoding: 'utf8' }).map((f) => join(root, 'state', f)).filter((p) => { try { return readFileSync(p).length >= 0; } catch { return false; } });
  check(!files.some((p) => readFileSync(p).includes(GOOD)), 'the key is on no disk in the clear: not Pi\'s home, not the bot\'s folder, not the sealed store');
  check(existsSync(join(root, 'state', 'pi', 'signins', 'pi-key-minimax')), 'it is sealed in crewd\'s own store');
  check(tree(join(root, 'home', '.pi')) === before, "a stand-in ~/.pi hashes the same after the sign-in and the job");

  log('crewd is stopped and started again over the same folders');
  await stop(); daemon = boot();
  await until('crewd up again', () => api('/api/state').then((x) => x.person, () => false), 30_000);
  check((await row()).signedIn, 'after the restart MiniMax is still signed in: the key was read back from the sealed store');
  log('Person asks Chief: "Good afternoon" (no sign-in this time)');
  const again = (await api('/api/bots/chief/messages', { text: 'Good afternoon' })).task, second = await until('the second job answers', async () => { const c = await chat(again); return ['queued', 'working', 'paused'].includes(c.state) ? undefined : c; });
  log(`The chat says: ${second.said}`);
  check(second.state === 'done' && second.said.trim().length > 0 && (model ? /Good afternoon/.test(second.said) : !/^stub /.test(second.said)), 'a second job answers on the saved key with no sign-in');
  log('Person signs out of MiniMax');
  await api('/api/accounts/1/minimax/logout', {});
  check(!(await row()).signedIn && !existsSync(join(root, 'state', 'pi', 'signins', 'pi-key-minimax')), 'signed out: the account shows signed out and the sealed key is gone');
  if (process.env.PI_SIGNIN_SHOTS === 'on') {
    // The sheet a person sees, driven through the built app: a refused key, the signed-in line, then Chief's thread with the answer the job gave.
    const base = `http://127.0.0.1:${port}`, person = readFileSync(join(root, 'state', 'person.key'), 'utf8').trim();
    // Asynchronous on purpose: this process serves the provider and the scripted model the page is waiting on.
    const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: process.env.CHROME_DEVTOOLS_AXI_SESSION || 'ch-pi-signin-job' };
    const run = (...a) => new Promise((r) => execFile('chrome-devtools-axi', a, { encoding: 'utf8', env }, (e, stdout, stderr) => r(String(stdout) + String(stderr))));
    const ax = async (...a) => { const o = await run(...a); if (process.env.PI_SIGNIN_AXLOG) appendFileSync(process.env.PI_SIGNIN_AXLOG, `${a.join(' ').slice(0, 150)}\n--> ${o.slice(0, 300)}\n`); if (!o.includes('No page is currently selected')) return o; await run('selectpage', /^ {2}(\d+),/m.exec(await run('pages'))?.[1] ?? '1'); return run(...a); }; // a fresh browser has no page selected
    const click = (sel, text) => ax('eval', `(()=>{const b=[...document.querySelectorAll('${sel}')].find(b=>/${text}/i.test(b.textContent||b.getAttribute('aria-label')));b.click();return 1})()`);
    const fill = async (text) => { await ax('eval', `(()=>{const i=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'${text}');i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`); await wait(300); };
    const open = async (theme, w, hash) => { await ax('open', 'about:blank'); await ax('resize', String(w), w === 1280 ? '900' : '844'); await ax('open', `${base}/?r=${Date.now()}&${theme}${hash}`); await wait(1500); };
    for (const [theme, w] of [['day', 390], ['night', 1280]]) {
      await api('/api/accounts/1/minimax/logout', {});
      await open(theme, w, `#person=${person}`);
      await click('button', '^Sign in with MiniMax'); await ax('wait', 'Paste the key from your');
      await fill(WRONG); await click('form .btn', 'Sign in with MiniMax'); await ax('wait', 'Check it and paste it again'); await wait(800); // the sheet settles before it is looked at
      await ax('screenshot', join(out, `signin-1-refused-${theme}-${w}.png`));
      await fill(GOOD); await click('form .btn', 'Sign in with MiniMax'); await ax('wait', "You're signed in!"); await wait(800);
      await ax('screenshot', join(out, `signin-2-signed-in-${theme}-${w}.png`));
    }
    if (real) for (const [theme, w] of [['day', 390], ['night', 390], ['day', 1280], ['night', 1280]]) { // the app hides the scripted model's reply lines, so Chief's thread is captured only with a real model's answer in it
      await open(theme, w, `#person=${person}`); await ax('open', `${base}/?r=${Date.now()}&${theme}#/chief`); await wait(1500); await ax('screenshot', join(out, `signin-3-chief-${theme}-${w}.png`)); }
    await ax('open', 'about:blank');
    check(readdirSync(out).filter((f) => f.endsWith('.png')).length === (real ? 8 : 4), real ? 'eight captures: the refused key and the signed-in line (two views each) and Chief\'s thread with the real answer (four)' : 'four captures: the refused key and the signed-in line (two views each)');
  }
  execFileSync(process.execPath, [join(repo, 'scripts', 'verify', 'steps.mjs'), out, 'pi-signin', `provider=${real ? 'the real MiniMax' : 'a scripted provider'}`], { stdio: 'inherit' });
  console.log(`pi-signin: signed in on Pi with a pasted key and Chief answered; transcript in ${file}`);
} catch (e) { failed = 1; log(`FAIL: ${e.message}`); console.error(`pi-signin: ${e.message}`); }
await stop();
provider?.close(); void model?.close();
execFileSync('chmod', ['-R', 'u+w', lab]);
rmSync(lab, { recursive: true, force: true });
process.exit(failed);
