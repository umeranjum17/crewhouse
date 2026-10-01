// A bot's own desktop: display lifecycle, its own X cookie, and crewd's say over what a watcher may do.
// Needs Xvfb (skipped without it); the desklink parts also need the Linux x64 engine and its system libraries.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { EngineClient, resolveEngine } from '@desklink/host';
import { browserBin, Desktops, missing, type DeskEvent } from '../src/desktop.ts';
import { bashTool, sandboxReady } from '../src/engine.ts';
import { setup } from './lab.ts';
import { Teacher } from '../src/teach.ts';
import { effectOf } from '../src/policy.ts';

const root = temp('crewhouse-desk');
const botDir = join(root, 'bots', 'reel');
mkdirSync(join(botDir, '.crewhouse'), { recursive: true });
/** Loopback ports this test's own processes listen on (crewd's relays, the bots' browsers, the decoy): the attack scans
 *  these and leaves every other program's alone, including other test files' browsers running alongside. */
function ours() {
  const kids = new Map<number, number[]>();
  for (const p of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try { const st = readFileSync(`/proc/${p}/stat`, 'utf8'); const ppid = Number(st.slice(st.lastIndexOf(') ') + 2).split(' ')[1]); kids.set(ppid, [...(kids.get(ppid) ?? []), Number(p)]); } catch { /* gone */ }
  }
  const tree = [process.pid];
  for (let i = 0; i < tree.length; i++) tree.push(...(kids.get(tree[i]) ?? []));
  // A busy Chrome opens and closes descriptors while they are read: skip the one that went, never the whole process.
  const link = (f: string) => { try { return readlinkSync(f); } catch { return ''; } };
  const inodes = new Set(tree.flatMap((p) => { try { return readdirSync(`/proc/${p}/fd`).map((f) => link(`/proc/${p}/fd/${f}`)); } catch { return []; } })
    .map((l) => l.match(/^socket:\[(\d+)\]$/)?.[1]).filter(Boolean));
  return ['/proc/net/tcp', '/proc/net/tcp6'].flatMap((f) => readFileSync(f, 'utf8').split('\n').slice(1)).map((l) => l.trim().split(/\s+/))
    .filter((c) => c[3] === '0A' && inodes.has(c[9])).map((c) => String(parseInt(c[1].split(':')[1], 16)));
}
const desks = new Desktops(join(root, 'state'));
after(() => desks.stopAll());
const noXvfb = missing().some((m) => m.startsWith('Xvfb')) && 'Xvfb is not installed';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const watcher = () => { const seen: DeskEvent[] = []; return { seen, send: (e: DeskEvent) => { seen.push(e); } }; };

test('independent installs reserve private displays and stop only their own', { skip: noXvfb }, async (t) => {
  const installs = ['foreign', 'one', 'two'].map((id) => {
    const dir = join(root, id); mkdirSync(dir, { recursive: true });
    return { dir, desktops: new Desktops(join(dir, 'state')) };
  });
  t.after(() => Promise.all(installs.map((i) => i.desktops.stopAll())));
  const [foreign, one, two] = installs;
  const held = await foreign.desktops.ensure('same', foreign.dir);
  const foreignSocket = statSync(`/tmp/.X11-unix/X${held.n}`).ino;
  const [a, b, again] = await Promise.all([one.desktops.ensure('same', one.dir),
    two.desktops.ensure('same', two.dir), one.desktops.ensure('same', one.dir)]);
  assert.equal(a, again, 'concurrent requests share one owned display');
  assert.equal(new Set([held.display, a.display, b.display]).size, 3, 'the same helper row never chooses another install’s display');
  assert.equal(statSync(`/tmp/.X11-unix/X${held.n}`).ino, foreignSocket, 'allocation preserves the foreign socket itself');
  assert.equal((await probe(a.display, b.xauth))?.available, false, 'another install’s cookie cannot drive this display');
  assert.ok(existsSync(`/tmp/.X11-unix/X${held.n}`));
  await one.desktops.stopAll();
  assert.ok(!existsSync(`/tmp/.X11-unix/X${a.n}`), 'shutdown waits for its display socket to go');
  assert.ok(existsSync(`/tmp/.X11-unix/X${held.n}`), 'the foreign display survives');
  assert.equal(statSync(`/tmp/.X11-unix/X${held.n}`).ino, foreignSocket, 'shutdown never replaces or unlinks the foreign socket');
  assert.ok(existsSync(`/tmp/.X11-unix/X${b.n}`), 'the other install survives');
  assert.equal(two.desktops.info('same')?.display, b.display);
  const restarted = await one.desktops.ensure('same', one.dir);
  assert.notEqual(restarted.display, held.display);
  assert.notEqual(restarted.display, b.display);
  one.desktops.stop('same');
  const rapid = await one.desktops.ensure('same', one.dir);
  assert.ok(existsSync(`/tmp/.X11-unix/X${rapid.n}`), 'rapid restart waits for its own shutdown');
  assert.equal(statSync(`/tmp/.X11-unix/X${held.n}`).ino, foreignSocket);
});

/** What the engine sees on a display, given an X cookie file. Null when the engine can't run here. */
async function probe(display: string, xauth: string) {
  const e = resolveEngine();
  if (!e) return null;
  try {
    const c = await EngineClient.start(e.command, e.args, {}, { ...process.env, DISPLAY: display, XAUTHORITY: xauth });
    const caps = await c.capabilities();
    await c.stop();
    return caps.x11;
  } catch (err: any) {
    console.log(`# desklink engine cannot run here: ${err.message}`);
    return null;
  }
}

test('display lifecycle: start once, own cookie, idle stop', { skip: noXvfb }, async (t) => {
  const d = await desks.ensure('reel', botDir);
  assert.match(d.display, /^:\d+$/);
  assert.ok(existsSync(`/tmp/.X11-unix/X${d.n}`), 'the display is up');
  assert.equal(statSync(d.xauth).mode & 0o777, 0o600, 'cookie readable by the owner only');
  assert.equal(await desks.ensure('reel', botDir), d, 'a second run reuses the same desktop');

  const withCookie = await probe(d.display, d.xauth);
  if (withCookie) {
    assert.deepEqual(withCookie, { available: true, size: [1280, 800] });
    assert.equal((await probe(d.display, '/dev/null'))?.available, false, 'no cookie, no display');
  } else t.diagnostic('desklink engine unavailable here; cookie check skipped');

  desks.sweep(() => true, Date.now() + 60 * 60_000);
  assert.ok(desks.running('reel'), 'a busy bot keeps its desktop');
  desks.sweep(() => false, Date.now() + 5 * 60_000);
  assert.ok(desks.running('reel'), 'not idle long enough yet');
  desks.sweep(() => false, Date.now() + 11 * 60_000);
  assert.ok(!desks.running('reel'), 'idle for ten minutes: stopped');
  for (let i = 0; i < 100 && existsSync(`/tmp/.X11-unix/X${d.n}`); i++) await sleep(100);
  assert.ok(!existsSync(`/tmp/.X11-unix/X${d.n}`), 'the display is gone');
});

test('watching: crewd picks the display and the permissions', { skip: noXvfb }, async (t) => {
  const d = await desks.ensure('reel', botDir);
  if (!(await probe(d.display, d.xauth))) return t.skip('desklink engine unavailable here');
  const a = watcher(), b = watcher();
  await assert.rejects(desks.signal('reel', a, 'session.open', { permissions: ['view'], source: { kind: 'portal' } }, false), { code: 'source' });
  await assert.rejects(desks.signal('reel', a, 'session.open', { permissions: ['view', 'control'] }, false), { code: 'permission' });

  const view = await desks.signal('reel', a, 'session.open', { permissions: ['view'] }, false);
  assert.equal(view.source.kind, 'x11-root');
  assert.deepEqual([view.source.width, view.source.height], [1280, 800]);
  for (let i = 0; i < 100 && !a.seen.some((e) => e.kind === 'description'); i++) await sleep(100);
  assert.ok(a.seen.some((e) => e.kind === 'description'), 'the offer reaches the watcher');
  assert.ok(a.seen.every((e) => e.sessionId === view.sessionId), 'engine events retain their session for viewer recovery');
  await assert.rejects(desks.signal('reel', b, 'session.candidate', { session_id: view.sessionId, candidate: '' }, false), { code: 'not-authorized' });
  await assert.rejects(desks.signal('reel', b, 'session.restart_ice', { session_id: view.sessionId, generation: view.generation }, false), { code: 'not-authorized' });
  await assert.rejects(desks.signal('reel', a, 'session.restart_ice', { session_id: 'someone-else', generation: view.generation }, false), { code: 'not-authorized' });
  const offers = () => a.seen.filter((e) => e.kind === 'description').length;
  const beforeRestart = offers();
  await desks.signal('reel', a, 'session.restart_ice', { session_id: view.sessionId, generation: view.generation }, false);
  await until('a fresh offer for the same watching session', () => offers() > beforeRestart, 10_000);
  assert.equal(desks.info('reel')?.watching, true, 'ICE recovery keeps the watching session');
  await assert.rejects(desks.signal('reel', a, 'clipboard.read', { session_id: view.sessionId }, false), { code: 'malformed' });
  desks.release(a);
  assert.equal(desks.info('reel')?.watching, false, 'a closed socket ends its session');

  const drive = await desks.signal('reel', b, 'session.open', { permissions: ['view', 'control'] }, true);
  assert.ok(drive.sessionId);
  assert.equal(desks.info('reel')?.control, true);
  await desks.revokeControl('reel');
  assert.equal(desks.info('reel')?.watching, false, 'Give back ends the controlling session');
  assert.ok(b.seen.some((e) => e.kind === 'revoked'));
  desks.stop('reel');
});

// Every bot's sandboxed shell shares the machine's loopback. A browser whose DevTools listened on a port there could be
// driven by any bot's shell, past crewd's gate: open pages as the person, read their signed-in sites. This runs the real
// attack from a real bot shell: find every loopback port that appeared during the test and, wherever DevTools answers,
// open a page. A decoy Chromium with an open port shows the attack works; the bot's own browser must be out of its
// reach, yet still drivable through crewd's own endpoint. (Only this test's own processes' ports are scanned: other
// programs', and other test files' browsers, are left alone.)
const noAttack = noXvfb || (!browserBin() && 'no Chromium here') || (!sandboxReady() && 'bubblewrap is not usable here');
test("a bot's shell cannot find or drive another bot's browser", { skip: noAttack }, async (t) => {
  const hits: string[] = [];
  const pages = createServer((q, r) => { hits.push(q.url!); r.end('<title>page</title><button>Place order</button>'); }).listen(0, '127.0.0.1');
  await new Promise((r) => pages.once('listening', r));
  const site = `http://127.0.0.1:${(pages.address() as AddressInfo).port}`;
  const decoyDir = join(root, 'decoy');
  // --disable-dev-shm-usage: a CI container's /dev/shm is tiny, and a headless Chrome that cannot fit its shared
  // memory there hangs silently. The decoy is only bait: it must start, then stay out of the way.
  const decoy = spawn(browserBin()!, ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${decoyDir}`, '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let said = '';
  decoy.stderr!.on('data', (c) => { said = (said + c).slice(-1000); });
  decoy.on('error', (e) => { said = `${said}\nspawn error: ${e.message}`.slice(-1000); });
  t.after(async () => { pages.close(); decoy.kill('SIGKILL'); await Promise.all([new Promise((r) => (decoy.exitCode === null && decoy.signalCode === null ? decoy.once('exit', r) : r(0))), desks.stopAll()]); });
  const d = await desks.ensure('reel', botDir);
  // The attacker, maya, has a computer and browser of its own too.
  const space = join(root, 'bots', 'maya');
  mkdirSync(join(space, '.crewhouse'), { recursive: true });
  const own = await desks.ensure('maya', space);
  // A cold Chrome on a busy CI runner can take a while to open its port. A Chromium that DIED (crash, sandbox,
  // singleton) never will: say so at once with its last words, instead of burning the whole bound on an empty wait.
  await until(`the decoy's DevTools port (Chrome said: ${said.slice(-300)})`, () => {
    if (decoy.exitCode !== null || decoy.signalCode !== null) throw new Error(`the decoy Chromium exited (code ${decoy.exitCode ?? decoy.signalCode}): ${said.slice(-300)}`);
    return existsSync(join(decoyDir, 'DevToolsActivePort'));
  }, 60_000);
  const decoyPort = readFileSync(join(decoyDir, 'DevToolsActivePort'), 'utf8').split('\n')[0];

  // crewd's own endpoint for a bot's browser (the only one that bot's browser tool is given): open a page, list its pages.
  const drive = async (cdp: string, path: string) => {
    const ws = new WebSocket(cdp);
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    const call = (id: number, method: string, params = {}) => new Promise<any>((r) => {
      ws.on('message', (raw) => { const j = JSON.parse(String(raw)); if (j.id === id) r(j.result); });
      ws.send(JSON.stringify({ id, method, params }));
    });
    if (path) await call(1, 'Target.createTarget', { url: `${site}${path}` });
    const { targetInfos } = await call(2, 'Target.getTargets');
    ws.close();
    return (targetInfos as any[]).map((x) => x.url);
  };
  await drive(d.cdp!, '/crewd');
  await until("crewd drove the bot's browser", () => hits.includes('/crewd'));

  // Bot "maya"'s own shell, exactly as a task gets it; it scans every port this test's processes listen on.
  const scan = ours();
  assert.ok(scan.includes(decoyPort), 'the decoy is among the ports scanned');
  const attack = `
    for hex in $(awk 'NR>1 && $4=="0A" { split($2, a, ":"); print a[2] }' /proc/net/tcp /proc/net/tcp6 | sort -u); do
      p=$((16#$hex))
      case " ${scan.join(' ')} " in *" $p "*) ;; *) continue;; esac
      if curl -s -m 2 http://127.0.0.1:$p/json/version | grep -q '"Browser"'; then
        echo "devtools $p"
        curl -s -m 2 -X PUT "http://127.0.0.1:$p/json/new?${site}/pwned-$p" > /dev/null
      fi
      for path in / /devtools/browser /devtools/browser/x; do
        code=$(curl -s -m 2 -o /dev/null -w '%{http_code}' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' http://127.0.0.1:$p$path)
        [ "$code" = 101 ] && echo "websocket $p$path"
      done
    done; echo scanned`;
  const r: any = await bashTool(space, [], {}).run({ command: attack });
  const out = typeof r === 'string' ? r : r.content.map((c: any) => c.text).join('');
  assert.match(out, /scanned/, out);
  assert.deepEqual(out.match(/^devtools \d+$/gm), [`devtools ${decoyPort}`], "the shell found the decoy's DevTools, and no other");
  assert.doesNotMatch(out, /^websocket /m, 'no DevTools socket answers without its secret');
  await until('the decoy was driven', () => hits.includes(`/pwned-${decoyPort}`));
  assert.deepEqual(hits.filter((h) => h.startsWith('/pwned') && h !== `/pwned-${decoyPort}`), []);
  for (const cdp of [d.cdp!, own.cdp!]) assert.deepEqual((await drive(cdp, '')).filter((u) => /pwned/.test(u)), [], "nothing the shell sent reached a bot's browser");

  // What must keep working: each bot still drives its own browser through crewd, and its gate still asks at a checkout.
  for (const [bot, cdp, dir] of [['reel', d.cdp!, botDir], ['maya', own.cdp!, space]]) {
    const urls = await drive(cdp, `/${bot}/checkout`);
    await until(`${bot} drove its own browser`, () => hits.includes(`/${bot}/checkout`));
    const page = urls.find((u) => u.endsWith(`/${bot}/checkout`));
    assert.ok(page, `${bot}'s browser is on its checkout page`);
    const seen = { bot, space: dir, page, secret: [] };
    assert.equal(effectOf('browser', { args: ['snapshot'] }, seen).kind, 'safe', 'looking needs no yes');
    assert.equal(effectOf('browser', { args: ['click', 'e3'] }, seen).kind, 'spend', 'acting on a checkout asks every time');
  }
});

// Teach by showing records through the same endpoint: crewd's recorder is the one client of the bot's DevTools while the
// person has the wheel. The page clicks and moves on by itself, standing in for the person's hands on the screen.
test("a show is recorded through crewd's own endpoint to the bot's browser", { skip: noXvfb || (!browserBin() && 'no Chromium here') }, async (t) => {
  const page = `<label for="q">Search</label><input id="q"><button id="go">Find</button>
    <script>setTimeout(() => { const q = document.getElementById('q'); q.value = 'private words'; q.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('go').click(); setTimeout(() => { location = '/results'; }, 300); }, 1500)</script>`;
  const site = createServer((q, r) => r.writeHead(200, { 'content-type': 'text/html' })
    .end(q.url === '/results' ? '<p>3 found</p>' : q.url === '/crewd' ? '<p>crewd was here</p>' : page)).listen(0, '127.0.0.1');
  await new Promise((r) => site.once('listening', r));
  const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  const teacher = new Teacher();
  t.after(async () => { teacher.stop('reel'); site.close(); await desks.stopAll(); });
  const d = await desks.ensure('reel', botDir);
  // The bot's browser was on the page (its own tool had it open, then let go when the person took the wheel).
  const bot = new WebSocket(d.cdp!);
  await new Promise((r, j) => { bot.once('open', r); bot.once('error', j); });
  // The person took the wheel on the front page; behind it sit pages crewd opened itself (its tool's page, and one an
  // old session restored). The recorder writes down what the person saw, never the pages behind the front one.
  const open = (id: number, path: string) => new Promise((r) => {
    bot.send(JSON.stringify({ id, method: 'Target.createTarget', params: { url: `${url}${path}` } }));
    bot.on('message', function back(m) { if (JSON.parse(String(m)).id === id) { bot.off('message', back); r(0); } });
  });
  await open(1, '/crewd');
  await open(2, '/search');
  bot.close();
  await teacher.start('reel', 'find a thing', d.cdp!, () => {});
  // The show must see the final navigation itself: a count of steps can be filled by anything recorded early.
  await until('the show saw the next page', () => teacher.steps('reel').includes('Opened 127.0.0.1/results'));
  const out = teacher.stop('reel')!;
  assert.deepEqual(out.steps.slice(0, 4), ['Opened 127.0.0.1/search', 'Typed in “Search”', 'Clicked “Find”', 'Opened 127.0.0.1/results']);
  assert.doesNotMatch(JSON.stringify(out), /private words/, 'never what was typed');
});

// Give back keeps the sites the person ticked, from hosts crewd read itself off the bot's own tabs: the real read
// over its own pipe, then the whole flow — keep writes bot.json, a press there asks, an unknown host is a 400, Forget.
test('give back reads its tabs and keeps what the person ticked', { skip: noXvfb || (!browserBin() && 'no Chromium here') }, async (t) => {
  const front = createServer((_q, r) => r.end('<p>front page</p>')).listen(0, '127.0.0.1');
  const behind = createServer((_q, r) => r.end('<p>behind</p>')).listen(0, '127.0.0.1');
  await Promise.all([front, behind].map((s) => new Promise((r) => s.once('listening', r))));
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  const space = join(cfg.crewDir, 'bots', 'reel');
  const host = (s: any) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const desk = await crew.desktops.ensure('reel', space);
  t.after(async () => { front.close(); behind.close(); await crew.desktops.stopAll(); done(); });
  assert.deepEqual(await crew.desktops.pages('reel'), [], 'nothing signed in to yet: no tabs at all');

  // Two tabs. The one opened last would be on screen, but a window-managerless Xvfb puts each createTarget in its
  // own window, so which tab reports visible is not stable here. The list itself is: every tab, bare hosts, no
  // paths — the visible-tab-first ordering the sheet pre-ticks is A.signTicks, proven in ui.test.ts.
  const ws = new WebSocket(desk.cdp!);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const open = (id: number, url: string, background = false) => new Promise((r) => {
    ws.send(JSON.stringify({ id, method: 'Target.createTarget', params: background ? { url, background: true } : { url } }));
    ws.on('message', function back(raw) { if (JSON.parse(String(raw)).id === id) { ws.off('message', back); r(0); } });
  });
  await open(1, `http://localhost:${(behind.address() as AddressInfo).port}/behind`);
  await open(2, `${host(front)}/front`);
  ws.close();
  await until('crewd read both tabs', () => crew.desktops.pages('reel').then((p) => p.length === 2));
  assert.deepEqual([...(await crew.desktops.pages('reel'))].sort(), ['127.0.0.1', 'localhost'], 'bare hosts, deduped, no paths');

  await crew.takeOver('reel');
  await crew.giveBack('reel', '', ['127.0.0.1']);
  assert.deepEqual(crew.botPage('reel').signedIn, ['127.0.0.1'], 'the tick is kept in bot.json');
  assert.ok(db.get("SELECT 1 FROM events WHERE kind = 'signin.kept' AND bot = 'reel'"));
  const press = effectOf('browser', { args: ['click', 'e5'] },
    { bot: 'Reel', space, secret: [], page: 'http://127.0.0.1:1/claim', signedIn: crew.botPage('reel').signedIn });
  assert.equal(press.kind, 'send', 'a press on a kept site asks');

  // A host with no tab is refused, and the wheel stays held for a corrected tick.
  await crew.takeOver('reel');
  await assert.rejects(crew.giveBack('reel', '', ['gone.example']), (e: any) => e.status === 400);
  await crew.giveBack('reel', '', []);
  assert.deepEqual(crew.botPage('reel').signedIn, ['127.0.0.1'], 'an empty sheet keeps the list as it was');

  await crew.forget('reel', '127.0.0.1');
  assert.deepEqual(crew.botPage('reel').signedIn, [], 'Forget takes the site back off the list');
});

async function until(what: string, fn: () => unknown, ms = 15_000) {
  for (const end = Date.now() + ms; !(await fn()); await sleep(50)) if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
}
