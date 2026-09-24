// A bot's own desktop: display lifecycle, its own X cookie, and crewd's say over what a watcher may do.
// Needs Xvfb (skipped without it); the desklink parts also need the Linux x64 engine and its system libraries.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineClient, resolveEngine } from '@desklink/host';
import { deskFor, Desktops, missing, type DeskEvent } from '../src/desktop.ts';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-desk-'));
const botDir = join(root, 'bots', 'reel');
mkdirSync(join(botDir, '.crewhouse'), { recursive: true });
// A display number nobody holds, so side-by-side runs and a real X server never collide.
let n = 190 + Math.floor(Math.random() * 60);
while (existsSync(`/tmp/.X${n}-lock`) || existsSync(`/tmp/.X11-unix/X${n}`)) n++;
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
  for (let i = 0; i < 50 && existsSync(`/tmp/.X11-unix/X${n}`); i++) await sleep(100);
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
  for (let i = 0; i < 30 && !a.seen.some((e) => e.kind === 'description'); i++) await sleep(100);
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
