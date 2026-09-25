// A bot's own desktop: display lifecycle, its own X cookie, and crewd's say over what a watcher may do.
// Needs Xvfb (skipped without it); the desklink parts also need the Linux x64 engine and its system libraries.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { EngineClient, resolveEngine } from '@desklink/host';
import { browserBin, deskFor, Desktops, missing, type DeskEvent } from '../src/desktop.ts';
import { sandboxBash, sandboxReady } from '../src/engine.ts';

const root = temp('crewhouse-desk');
const botDir = join(root, 'bots', 'reel');
mkdirSync(join(botDir, '.crewhouse'), { recursive: true });
// A display number nobody holds, so side-by-side runs and a real X server never collide.
let n = 190 + Math.floor(Math.random() * 60);
while (existsSync(`/tmp/.X${n}-lock`) || existsSync(`/tmp/.X11-unix/X${n}`)) n++;
/** Loopback ports already listening before any desktop here starts: other programs' own, which the attack test leaves alone. */
const before = new Set(['/proc/net/tcp', '/proc/net/tcp6'].flatMap((f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').slice(1) : []))
  .map((l) => l.trim().split(/\s+/)).filter((c) => c[3] === '0A').map((c) => String(parseInt(c[1].split(':')[1], 16))));
const desks = new Desktops(join(root, 'state'));
const xauth = deskFor(join(root, 'state'), 'reel', n).xauth;
after(() => desks.stopAll());
const noXvfb = missing().some((m) => m.startsWith('Xvfb')) && 'Xvfb is not installed';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const watcher = () => { const seen: DeskEvent[] = []; return { seen, send: (e: DeskEvent) => { seen.push(e); } }; };

/** What the engine sees on a display, given an X cookie file. Null when the engine can't run here. */
async function probe(xauth: string) {
  const e = resolveEngine();
  if (!e) return null;
  try {
    const c = await EngineClient.start(e.command, e.args, {}, { ...process.env, DISPLAY: `:${n}`, XAUTHORITY: xauth });
    const caps = await c.capabilities();
    await c.stop();
    return caps.x11;
  } catch (err: any) {
    console.log(`# desklink engine cannot run here: ${err.message}`);
    return null;
  }
}

test('display lifecycle: start once, own cookie, idle stop', { skip: noXvfb }, async (t) => {
  const d = await desks.ensure('reel', n, botDir);
  assert.equal(d.display, `:${n}`);
  assert.ok(existsSync(`/tmp/.X11-unix/X${n}`), 'the display is up');
  assert.equal(statSync(d.xauth).mode & 0o777, 0o600, 'cookie readable by the owner only');
  assert.equal(await desks.ensure('reel', n, botDir), d, 'a second run reuses the same desktop');

  const withCookie = await probe(d.xauth);
  if (withCookie) {
    assert.deepEqual(withCookie, { available: true, size: [1280, 800] });
    assert.equal((await probe('/dev/null'))?.available, false, 'no cookie, no display');
  } else t.diagnostic('desklink engine unavailable here; cookie check skipped');

  desks.sweep(() => true, Date.now() + 60 * 60_000);
  assert.ok(desks.running('reel'), 'a busy bot keeps its desktop');
  desks.sweep(() => false, Date.now() + 5 * 60_000);
  assert.ok(desks.running('reel'), 'not idle long enough yet');
  desks.sweep(() => false, Date.now() + 11 * 60_000);
  assert.ok(!desks.running('reel'), 'idle for ten minutes: stopped');
  for (let i = 0; i < 100 && existsSync(`/tmp/.X11-unix/X${n}`); i++) await sleep(100);
  assert.ok(!existsSync(`/tmp/.X11-unix/X${n}`), 'the display is gone');
});

test('watching: crewd picks the display and the permissions', { skip: noXvfb }, async (t) => {
  await desks.ensure('reel', n, botDir);
  if (!(await probe(xauth))) return t.skip('desklink engine unavailable here');
  const a = watcher(), b = watcher();
  await assert.rejects(desks.signal('reel', a, 'session.open', { permissions: ['view'], source: { kind: 'portal' } }, false), { code: 'source' });
  await assert.rejects(desks.signal('reel', a, 'session.open', { permissions: ['view', 'control'] }, false), { code: 'permission' });

  const view = await desks.signal('reel', a, 'session.open', { permissions: ['view'] }, false);
  assert.equal(view.source.kind, 'x11-root');
  assert.deepEqual([view.source.width, view.source.height], [1280, 800]);
  for (let i = 0; i < 100 && !a.seen.some((e) => e.kind === 'description'); i++) await sleep(100);
  assert.ok(a.seen.some((e) => e.kind === 'description'), 'the offer reaches the watcher');
  await assert.rejects(desks.signal('reel', b, 'session.candidate', { session_id: view.sessionId, candidate: '' }, false), { code: 'not-authorized' });
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
// reach, yet still drivable through crewd's own endpoint. (Ports already open before this file ran, other programs'
// own, are left alone.)
const noAttack = noXvfb || (!browserBin() && 'no Chromium here') || (!sandboxReady() && 'bubblewrap is not usable here');
test("a bot's shell cannot find or drive another bot's browser", { skip: noAttack }, async (t) => {
  const hits: string[] = [];
  const pages = createServer((q, r) => { hits.push(q.url!); r.end('<title>page</title>'); }).listen(0, '127.0.0.1');
  await new Promise((r) => pages.once('listening', r));
  const site = `http://127.0.0.1:${(pages.address() as AddressInfo).port}`;
  const decoyDir = join(root, 'decoy');
  const decoy = spawn(browserBin()!, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${decoyDir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  t.after(async () => { pages.close(); decoy.kill('SIGKILL'); await Promise.all([new Promise((r) => (decoy.exitCode === null && decoy.signalCode === null ? decoy.once('exit', r) : r(0))), desks.stopAll()]); });
  const d = await desks.ensure('reel', n, botDir);
  for (let i = 0; i < 100 && !existsSync(join(decoyDir, 'DevToolsActivePort')); i++) await sleep(100);
  const decoyPort = readFileSync(join(decoyDir, 'DevToolsActivePort'), 'utf8').split('\n')[0];

  // The bot's browser is up, and crewd's own endpoint (the only one its browser tool is given) drives it.
  const ws = new WebSocket(d.cdp!);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const reply = (id: number) => new Promise<any>((r) => ws.on('message', (m) => { const j = JSON.parse(String(m)); if (j.id === id) r(j.result); }));
  ws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: `${site}/crewd` } }));
  await until("crewd drove the bot's browser", () => hits.includes('/crewd'));

  // Bot "maya"'s own shell, exactly as a task gets it; it scans every port except those open before this file ran.
  const space = join(root, 'bots', 'maya');
  mkdirSync(space, { recursive: true });
  const attack = `
    for hex in $(awk 'NR>1 && $4=="0A" { split($2, a, ":"); print a[2] }' /proc/net/tcp /proc/net/tcp6 | sort -u); do
      p=$((16#$hex))
      case " ${[...before].join(' ')} " in *" $p "*) continue;; esac
      if curl -s -m 2 http://127.0.0.1:$p/json/version | grep -q '"Browser"'; then
        echo "devtools $p"
        curl -s -m 2 -X PUT "http://127.0.0.1:$p/json/new?${site}/pwned-$p" > /dev/null
      fi
      for path in / /devtools/browser /devtools/browser/x; do
        code=$(curl -s -m 2 -o /dev/null -w '%{http_code}' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' http://127.0.0.1:$p$path)
        [ "$code" = 101 ] && echo "websocket $p$path"
      done
    done; echo scanned`;
  const r: any = await sandboxBash(space, [], {}).execute('attack', { command: attack }, undefined as any, undefined as any);
  const out = r.content.map((c: any) => c.text).join('');
  assert.match(out, /scanned/, out);
  assert.deepEqual(out.match(/^devtools \d+$/gm), [`devtools ${decoyPort}`], "the shell found the decoy's DevTools, and no other");
  assert.doesNotMatch(out, /^websocket /m, 'no DevTools socket answers without its secret');
  await until('the decoy was driven', () => hits.includes(`/pwned-${decoyPort}`));
  ws.send(JSON.stringify({ id: 2, method: 'Target.getTargets' }));
  const { targetInfos } = await reply(2);
  ws.close();
  assert.deepEqual(targetInfos.filter((x: any) => /pwned/.test(x.url)), [], "nothing the shell sent reached the bot's browser");

  assert.deepEqual(hits.filter((h) => h.startsWith('/pwned') && h !== `/pwned-${decoyPort}`), []);
});

async function until(what: string, fn: () => unknown, ms = 15_000) {
  for (const end = Date.now() + ms; !(await fn()); await sleep(50)) if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
}
