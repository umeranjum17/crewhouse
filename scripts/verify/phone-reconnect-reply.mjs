#!/usr/bin/env node
// One message gives one reply on the phone, even when the link drops while Chief is answering
// (features/phone-chat-keyboard.md). The real engine on the scripted model (native-delegation.ts with LAB_HI_REPLY:
// Chief's "Hi" reply streams its first sentence, then the rest 8 s later), the repo's relay, and the task's emulator
// paired by the typed relay code. The phone's link (direct and by the relay) then runs through pipes this script cuts
// while Chief's first words are on screen and holds down until his reply is written; then it counts the copies of his
// reply on screen after the reconnect, after a tab switch and after backgrounding the app. Exits 1 unless each is one.
//
//   node scripts/verify/phone-reconnect-reply.mjs --serial <emulator> --apk <app.apk> --lab <empty scratch dir> --out <dir>
import { spawn, execFileSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const REPO = join(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const [SERIAL, APK, LAB, OUT] = ['serial', 'apk', 'lab', 'out'].map(opt);
if (!SERIAL || !APK || !LAB || !OUT) { console.error('usage: phone-reconnect-reply.mjs --serial <emulator> --apk <app.apk> --lab <dir> --out <dir>'); process.exit(2); }
const HI = 'Hi Umer. What can I take off your plate today?';
mkdirSync(OUT, { recursive: true }); mkdirSync(join(LAB, 'relay'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (label, f, ms = 120_000) => { const end = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${label}`); await sleep(400); } };
const say = (...a) => { const l = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; console.log(l); appendFileSync(join(OUT, 'run.log'), l + '\n'); };
const free = () => new Promise((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const A = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const nodes = () => {
  let xml = '';
  for (let i = 0; i < 3 && !xml; i++) { try { A('shell', 'uiautomator', 'dump', '/sdcard/ui.xml'); xml = A('shell', 'cat', '/sdcard/ui.xml'); } catch { /* busy */ } }
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => ({ text: (n.match(/ text="([^"]*)"/) || [])[1] || '', desc: (n.match(/content-desc="([^"]*)"/) || [])[1] || '',
    pkg: (n.match(/package="([^"]*)"/) || [])[1], cls: (n.match(/class="([^"]*)"/) || [])[1], b: (n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []).slice(1).map(Number) }));
};
const app = () => nodes().filter((n) => n.pkg === 'dev.crewhouse.app');
const tap = (n) => A('shell', 'input', 'tap', String((n.b[0] + n.b[2]) >> 1), String((n.b[1] + n.b[3]) >> 1));
const find = (re) => app().find((n) => re.test(n.text) || re.test(n.desc));
// Copies of Chief's reply on screen: text nodes that carry his first words (a streamed copy or the finished one).
const copies = () => app().filter((n) => n.text.includes('Hi Umer.')).map((n) => n.text);
const shot = (name) => writeFileSync(join(OUT, `${name}.png`), execFileSync('adb', ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 26 }));
const results = {};
const count = async (name) => { await sleep(1500); const c = copies(); results[name] = c; shot(name); say(`${name}: ${c.length} cop${c.length === 1 ? 'y' : 'ies'} on screen`, JSON.stringify(c)); return c; };

const RP = await free(), LP = await free(), PP = await free(), READY = join(LAB, 'ready.json');
const env = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: join(LAB, 'tmp'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${LAB}/no-bus` };
mkdirSync(join(LAB, 'tmp'), { recursive: true });
const relay = spawn('node', ['relay/main.ts'], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, HOME: join(LAB, 'relay'), PORT: String(RP), HOST: '127.0.0.1', RELAY_DATA: join(LAB, 'relay'), RELAY_SIGNUP: 'open' } });
relay.stdout.on('data', (b) => appendFileSync(join(OUT, 'relay.log'), b)); relay.stderr.on('data', (b) => appendFileSync(join(OUT, 'relay.log'), b));
rmSync(READY, { force: true });
const crewd = spawn('node', ['scripts/verify/native-delegation.ts', LAB, READY, '--scripted'], { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...env, CREWHOUSE_ENGINE_DIR: `${REPO}/runtime/openclaw`, LAB_LINK_PORT: String(LP), CREWHOUSE_LINK_HOST: '127.0.0.1', LAB_HI_REPLY: HI, CREWHOUSE_RELAY: `http://127.0.0.1:${RP}` } });
crewd.stdout.on('data', (b) => appendFileSync(join(OUT, 'lab.log'), b)); crewd.stderr.on('data', (b) => appendFileSync(join(OUT, 'lab.log'), b));
say('relay', relay.pid, 'crewd group', crewd.pid, 'link', LP, 'pipe', PP, 'relay port', RP);

// The phone's link (direct, and by the relay) runs through these pipes once paired: a cut drops both and refuses
// redials until they open again.
const socks = new Set(); let refuse = false; const dials = [];
const pipeTo = (target) => createServer((p) => {
  dials.push({ at: Date.now(), target, refused: refuse });
  if (refuse) return p.destroy();
  const h = connect(target, '127.0.0.1'); socks.add(p); socks.add(h);
  p.on('data', (b) => h.write(b)); h.on('data', (b) => p.write(b));
  const end = () => { p.destroy(); h.destroy(); socks.delete(p); socks.delete(h); };
  p.on('error', end); h.on('error', end); p.on('close', end); h.on('close', end);
});
const PR = await free();
const pipe = pipeTo(LP), pipeR = pipeTo(RP);
await new Promise((r) => pipe.listen(PP, '127.0.0.1', r)); await new Promise((r) => pipeR.listen(PR, '127.0.0.1', r));

let base = '', key = '';
const http = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${key}` }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
try {
  await until('lab ready', () => existsSync(READY) && readFileSync(READY, 'utf8').trim(), 900_000);
  base = JSON.parse(readFileSync(READY, 'utf8')).base; key = readFileSync(join(LAB, 'state/person.key'), 'utf8').trim();
  writeFileSync(join(LAB, 'env'), `B=${base}\nPORT=${new URL(base).port}\nLINK_PORT=${LP}\nRELAY=http://127.0.0.1:${RP}\nREPO=${REPO}\nLAB=${LAB}\n`);
  await until('pairing ready', async () => (await http('POST', '/api/phones/pair', { role: 'control' }).catch(() => null))?.status === 200);
  say('lab up at', base);
  execFileSync('node', ['scripts/verify/phone-pair-typed.mjs', '--serial', SERIAL, '--apk', APK], { cwd: REPO, env: { ...process.env, LAB }, stdio: 'inherit', timeout: 600_000 });
  // From here the phone's link goes through the pipes.
  A('reverse', `tcp:${LP}`, `tcp:${PP}`); A('reverse', `tcp:${RP}`, `tcp:${PR}`);
  A('shell', 'am', 'force-stop', 'dev.crewhouse.app'); A('shell', 'monkey', '-p', 'dev.crewhouse.app', '-c', 'android.intent.category.LAUNCHER', '1');
  await until('app back on Home', () => find(/^Chief$/), 60_000);
  await until('link through the pipe', () => socks.size > 0, 60_000);
  tap(find(/^Chief$/)); await sleep(2500);
  const box = await until('message box', () => app().find((n) => n.cls === 'android.widget.EditText'), 30_000);
  tap(box); await sleep(800); A('shell', 'input', 'text', 'Hi'); await sleep(800);
  const before = (await http('GET', '/api/bots/chief')).body.messages.at(-1)?.id ?? 0;
  tap(await until('send', () => find(/^Send$/), 10_000));
  say('sent Hi');
  await until('Chief\'s first words on screen', () => copies().length > 0, 120_000);
  shot('1-streaming'); say('streamed on screen:', JSON.stringify(copies()));
  refuse = true; for (const s of socks) s.destroy(); say('cut the link');
  await until('reply written on the computer', async () => (await http('GET', '/api/bots/chief')).body.messages.some((m) => m.id > before && m.author === 'bot' && m.text === HI), 120_000);
  await sleep(2000); refuse = false; say('link open again');
  await until('phone back on the link', () => socks.size > 0, 120_000);
  await until('the reply drawn', () => copies().includes(HI), 60_000).catch((e) => say(e.message));
  await count('2-after-reconnect');
  tap(find(/^Home$/)); await until('Home', () => find(/^YOUR CREW$/), 20_000); tap(await until('Chief tab', () => find(/^Chief$/), 20_000));
  await until('Chief again', () => find(/Tell Chief anything/), 20_000); await count('3-after-tab-switch');
  A('shell', 'input', 'keyevent', '3'); await until('app left', () => !app().length, 20_000);
  A('shell', 'monkey', '-p', 'dev.crewhouse.app', '-c', 'android.intent.category.LAUNCHER', '1'); await until('app back', () => app().length, 20_000);
  if (!find(/Tell Chief anything/)) tap(await until('Chief tab', () => find(/^Chief$/), 20_000));
  await until('Chief again', () => find(/Tell Chief anything/), 20_000);
  await count('4-after-background');
  const msgs = (await http('GET', '/api/bots/chief')).body.messages.filter((m) => m.id > before);
  results.computer = msgs.map((m) => `${m.id} ${m.author} task=${m.task_id} ${JSON.stringify(m.text).slice(0, 80)}`);
  say('computer lines:', JSON.stringify(results.computer));
  results.ok = ['2-after-reconnect', '3-after-tab-switch', '4-after-background'].every((k) => results[k].length === 1 && results[k][0] === HI) && msgs.filter((m) => m.author === 'bot').length === 1;
  say(results.ok ? 'ok: one reply on the phone and on the computer' : 'FAIL: more or fewer than one reply');
  if (!results.ok) process.exitCode = 1;
} catch (e) { say('ERROR', e.stack); process.exitCode = 1; shot('error'); }
finally {
  pipe.close(); pipeR.close(); results.dials = dials.map((d) => ({ ...d, target: d.target === LP ? 'link' : 'relay' }));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2)); for (const s of socks) s.destroy();
  try { process.kill(-crewd.pid, 'SIGTERM'); } catch {}
  await until('crewd gone', () => { try { process.kill(-crewd.pid, 0); return false; } catch { return true; } }, 60_000).catch(() => { try { process.kill(-crewd.pid, 'SIGKILL'); } catch {} });
  relay.kill('SIGTERM');
  say('stopped');
}
