// Private authenticated Xvfb displays and Chromium, streamed through the capture kit; never the owner's display.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EngineClient, resolveEngine, explainMissingEngine, type EngineEvent } from '@desklink/host';
import { WebSocket, WebSocketServer } from 'ws';

export const WIDTH = 1280, HEIGHT = 800;
const IDLE_MS = Number(process.env.CREWHOUSE_DESKTOP_IDLE_MS || 10 * 60_000);
const BROWSERS = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];

const onPath = (bin: string) => (process.env.PATH ?? '').split(':').find((d) => d && existsSync(join(d, bin))) && bin;
export const browserBin = () => BROWSERS.map(onPath).find(Boolean) || null;
/** What is missing on this machine for bot desktops, in words fit for doctor and the app. */
export function missing() {
  const engine = explainMissingEngine();
  return [!onPath('Xvfb') && 'Xvfb (apt install xvfb, dnf install xorg-x11-server-Xvfb, pacman -S xorg-server-xvfb)',
    engine && `the desklink engine: ${engine}`].filter((m): m is string => !!m);
}

/** An Xauthority file with one wildcard MIT-MAGIC-COOKIE-1 entry: only holders of this file may use the display. */
function xauthority(n: number | string, cookie: Buffer) {
  const field = (b: Buffer) => { const len = Buffer.alloc(2); len.writeUInt16BE(b.length); return Buffer.concat([len, b]); };
  const family = Buffer.from([0xff, 0xff]); // FamilyWild
  return Buffer.concat([family, field(Buffer.alloc(0)), field(Buffer.from(String(n))), field(Buffer.from('MIT-MAGIC-COOKIE-1')), field(cookie)]);
}

/** A client-facing session event, as @desklink/react-native's Signaling.subscribe expects it. */
export type DeskEvent = ({ kind: 'description'; description: unknown } | { kind: 'candidate'; candidate: unknown }
  | { kind: 'state'; capture: string; transport: string; firstFrame: boolean } | { kind: 'revoked'; reason: string; code?: string }) & { sessionId?: string };

function unwrap(e: EngineEvent): DeskEvent | null {
  const p: any = e.params;
  switch (e.event) {
    case 'session.description': return { kind: 'description', sessionId: p.sessionId, description: p.description };
    case 'session.candidate': return { kind: 'candidate', sessionId: p.sessionId, candidate: { candidate: p.candidate, sdpMid: p.sdpMid, sdpMLineIndex: p.sdpMLineIndex } };
    case 'session.state': return { kind: 'state', sessionId: p.sessionId, capture: p.capture, transport: p.transport, firstFrame: p.firstFrame };
    case 'session.revoked': return { kind: 'revoked', sessionId: p.sessionId, reason: p.reason, code: p.code };
    default: return null; // restore tokens stay with the host
  }
}

/** Whoever is watching: where its session's events go. One watcher per bot ("one session, one controller"). */
export interface Watcher { send(e: DeskEvent): void }

interface Desk {
  bot: string; n: number; display: string; xauth: string;
  /** Where the bot's browser tool attaches: crewd's own endpoint for this Chromium, at a secret path (see `browser`). */
  cdp?: string;
  xvfb: ChildProcess; chrome?: ChildProcess; engine?: EngineClient; devtools?: WebSocketServer;
  session?: { id: string; generation: number; control: boolean; watcher: Watcher };
  used: number;
  /** The engine announces a session's offer before its open call returns; held here until the session is known. */
  early: EngineEvent[];
}

const refused = (message: string, code = 'permission') => Object.assign(new Error(message), { code, status: 403 });

export class Desktops {
  private desks = new Map<string, Desk>();
  private starts = new Map<string, Promise<Desk>>();
  private ends = new Map<string, Promise<unknown>>();
  private stateDir: string;
  constructor(stateDir: string) { this.stateDir = stateDir; }

  running(bot: string) { return this.desks.has(bot); }
  info(bot: string) {
    const d = this.desks.get(bot);
    return d ? { display: d.display, watching: !!d.session, control: !!d.session?.control } : null;
  }

  /** Start the bot's display and browser if they aren't up. Idempotent; called before every run that needs a screen. */
  ensure(bot: string, botDir: string): Promise<Desk> {
    const have = this.starts.get(bot);
    if (have) return have;
    const pending = this.start(bot, botDir);
    this.starts.set(bot, pending);
    void pending.finally(() => this.starts.delete(bot)).catch(() => {});
    return pending;
  }

  private async start(bot: string, botDir: string) {
    await this.ends.get(bot);
    botDir = realpathSync(botDir);
    const have = this.desks.get(bot);
    if (have) {
      have.used = Date.now();
      if (!have.chrome || have.chrome.exitCode !== null) await this.browser(have, botDir);
      return have;
    }
    const why = missing().find((m) => m.startsWith('Xvfb'));
    if (why) throw new Error(`bot desktops need ${why}`);
    const xauth = join(this.stateDir, 'desktops', `${bot}.xauth`), cookie = randomBytes(16);
    mkdirSync(join(this.stateDir, 'desktops'), { recursive: true });
    this.reapOrphan(xauth, botDir);
    writeFileSync(xauth, xauthority('', cookie), { mode: 0o600 });
    // Xvfb atomically reserves a free display; no SQL-derived address or check-then-start race.
    const xvfb = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', `${WIDTH}x${HEIGHT}x24`, '-nolisten', 'tcp', '-auth', xauth],
      { cwd: botDir, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
    let err = '';
    xvfb.stderr!.on('data', (c) => { err = (err + c).slice(-2000); });
    const n = await new Promise<number>((resolve, reject) => {
      const done = (v: number | Error) => { clearTimeout(timer); v instanceof Error ? reject(v) : resolve(v); };
      const failed = (why = err.trim().split('\n').pop()) => done(new Error(`Xvfb did not start: ${why || 'exited'}`));
      const timer = setTimeout(() => failed('timed out reserving a display'), 5000);
      xvfb.once('error', (e) => failed(e.message)); xvfb.once('exit', () => failed());
      let ready = '';
      xvfb.stdio[3]!.on('data', (c) => { ready += String(c); if (/^\d+\n$/.test(ready)) done(Number(ready.trim())); });
    }).catch((e) => { xvfb.kill(); throw e; });
    const desk: Desk = { bot, n, display: `:${n}`, xauth, xvfb, used: Date.now(), early: [] };
    xvfb.on('exit', () => { if (this.desks.get(bot) === desk) this.stop(bot); });
    this.desks.set(bot, desk);
    try { writeFileSync(xauth, xauthority(n, cookie), { mode: 0o600 }); await this.browser(desk, botDir); } catch (e) { await this.stop(bot); throw e; }
    return desk;
  }

  /** A crewd that died leaves its Xvfb behind; ours is recognisable by our own cookie path on its command line. */
  private reapOrphan(xauth: string, botDir: string) {
    for (const pid of existsSync('/proc') ? readdirSync('/proc').filter((p) => /^\d+$/.test(p)).map(Number) : []) {
      const cmd = (() => { try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0'); } catch { return []; } })();
      try { if (/Xvfb$/.test(cmd[0] ?? '') && cmd[cmd.indexOf('-auth') + 1] === xauth && readlinkSync(`/proc/${pid}/cwd`) === botDir) process.kill(pid); } catch { /* gone */ }
    }
  }

  /** Its own profile/display. DevTools uses a pipe: bot shells share loopback, so a TCP endpoint is unsafe.
   *  crewd relays it only at a fresh secret WebSocket path given to this bot's browser tool. */
  private async browser(d: Desk, botDir: string) {
    const bin = browserBin();
    if (!bin) return;
    d.devtools?.close();
    const child = spawn(bin, [
      // Last flag wins, so these beat a distro wrapper's own flags (for example a Wayland default).
      '--ozone-platform=x11', `--user-data-dir=${join(botDir, 'browser')}`, '--remote-debugging-pipe',
      '--no-first-run', '--no-default-browser-check', '--password-store=basic', '--force-device-scale-factor=1', '--start-maximized',
      '--window-position=0,0', `--window-size=${WIDTH},${HEIGHT}`, 'about:blank',
    ], { env: this.env(d), stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    let said = '', buf = '', client: WebSocket | undefined, answered: ((bad?: string) => void) | undefined;
    child.stderr!.on('data', (c) => { said = (said + c).slice(-400); });
    child.on('error', (e) => { said = `${said}\n${e.message}`.slice(-400); });
    const path = `/devtools/browser/${randomBytes(24).toString('hex')}`;
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, path });
    await new Promise((r) => wss.once('listening', r));
    // Chromium's pipe carries one JSON message per NUL; one client at a time (a newer attach replaces the last).
    const toChrome = child.stdio[3] as NodeJS.WritableStream, fromChrome = child.stdio[4] as NodeJS.ReadableStream;
    fromChrome.setEncoding('utf8'); // a character split across chunks stays whole
    fromChrome.on('data', (c) => {
      buf += c;
      for (let i; (i = buf.indexOf('\0')) >= 0; buf = buf.slice(i + 1)) { answered?.(); client?.send(buf.slice(0, i)); }
    });
    toChrome.on('error', () => {});
    wss.on('connection', (ws) => { client?.close(); client = ws; ws.on('message', (m) => toChrome.write(`${m}\0`)); });
    child.on('exit', () => { wss.close(); if (d.devtools === wss) d.cdp = undefined; });
    // A Chromium that died (a crash, a missing library, a socket path past the kernel's 108 bytes) leaves this relay
    // listening, and every DevTools call then waits for a reply forever: make it answer before handing the endpoint out.
    toChrome.write('{"id":0,"method":"Browser.getVersion"}\0');
    await new Promise<void>((ok, no) => {
      answered = (bad) => { answered = undefined; if (!bad) return ok(); // settled once: a later ordinary exit is not a failed start
        console.error(`${d.bot}'s browser ${bad}: ${said.trim().split('\n').pop() || 'it said nothing'}`); no(new Error(`${d.bot}'s browser ${bad}`)); };
      child.once('exit', () => answered?.('could not start')); setTimeout(() => answered?.('did not answer'), 60_000).unref();
    }).catch((e) => { wss.close(); child.kill('SIGKILL'); throw e; });
    d.chrome = child; d.devtools = wss; d.cdp = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}${path}`;
  }

  /** Environment bound to the bot's display only: its cookie, and no route to the owner's Wayland session. */
  private env(d: Desk) {
    const { WAYLAND_DISPLAY: _w, GDK_SCALE: _s, ...rest } = process.env;
    return { ...rest, DISPLAY: d.display, XAUTHORITY: d.xauth, XDG_SESSION_TYPE: 'x11' };
  }

  /** crewd picks the display/permissions, not the watcher; control requires the person holding the wheel. */
  async signal(bot: string, watcher: Watcher, method: string, params: Record<string, any>, mayControl: boolean) {
    const d = this.desks.get(bot);
    if (!d) throw refused(`${bot}'s desktop is not running`, 'no-screen');
    d.used = Date.now();
    if (method === 'session.open') {
      if (params.source !== undefined) throw refused('the client cannot choose the desktop source', 'source');
      const perms: string[] = Array.isArray(params.permissions) ? params.permissions : ['view'];
      const control = perms.includes('control');
      if (control && !mayControl) throw refused('Take over first: the bot has the controls');
      await this.closeSession(d, 'another screen opened this desktop');
      d.engine ??= await this.engine(d);
      const opened: any = await d.engine.request('session.open', {
        ...params, source: { kind: 'x11', display: d.display }, permissions: control ? ['view', 'control'] : ['view'],
      });
      d.session = { id: opened.sessionId, generation: opened.generation, control, watcher };
      const early = d.early.filter((e) => (e.params as any).sessionId === opened.sessionId);
      d.early = [];
      // After the reply, so the watcher knows its session before the offer arrives.
      setTimeout(() => early.forEach((e) => this.deliver(d, e)));
      return opened;
    }
    if (!['session.description', 'session.candidate', 'session.restart_ice', 'session.close'].includes(method)) throw refused(`${method} is not allowed`, 'malformed');
    if (!d.session || d.session.watcher !== watcher || params.session_id !== d.session.id) throw refused('not your session', 'not-authorized');
    if (method === 'session.close') { await this.closeSession(d); return { closed: true }; }
    if (!d.engine) throw refused('no engine', 'no-screen');
    return d.engine.request(method, params);
  }

  private async engine(d: Desk) {
    const e = resolveEngine();
    if (!e) throw refused(explainMissingEngine() ?? 'the desklink engine is missing', 'platform');
    return EngineClient.start(e.command, e.args, {
      onEvent: (ev) => {
        d.engine?.drainEvents(); // delivered here; don't let the engine client's backlog grow
        if (d.session && (ev.params as any).sessionId === d.session.id) this.deliver(d, ev);
        else d.early = [...d.early.slice(-100), ev];
      },
      onExit: () => { d.engine = undefined; d.session?.watcher.send({ kind: 'revoked', reason: 'the desktop engine stopped' }); d.session = undefined; },
    }, this.env(d));
  }

  private deliver(d: Desk, ev: EngineEvent) {
    const s = d.session, out = unwrap(ev);
    if (!s || !out || (ev.params as any).sessionId !== s.id) return;
    s.watcher.send(out);
    if (out.kind === 'revoked') d.session = undefined;
  }

  private async closeSession(d: Desk, reason?: string) {
    const s = d.session;
    if (!s) return;
    d.session = undefined;
    d.used = Date.now();
    if (reason) s.watcher.send({ kind: 'revoked', reason });
    await d.engine?.request('session.close', { session_id: s.id, generation: s.generation }).catch(() => {});
  }

  /** The watcher went away (socket closed): release its session so no input is left held. */
  release(watcher: Watcher) {
    for (const d of this.desks.values()) if (d.session?.watcher === watcher) void this.closeSession(d);
  }

  /** The person gave the controls back: end any session that can drive the bot's screen. */
  async revokeControl(bot: string) {
    const d = this.desks.get(bot);
    if (d?.session?.control) await this.closeSession(d, 'The controls went back to the bot');
  }

  /** One pipe client at a time: use only while the person holds the wheel and the bot's browser tool is detached. */
  private async withPipe<T>(bot: string, run: (call: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>) => Promise<T>): Promise<T> {
    const d = this.desks.get(bot);
    if (!d?.cdp || !d.chrome || d.chrome.exitCode !== null) throw new Error("the bot's browser is not running");
    const ws = new WebSocket(d.cdp, { perMessageDeflate: false });
    let n = 0;
    try {
      await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
      const call = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<any>((r) => {
        const id = ++n;
        ws.on('message', function back(m) { const x = JSON.parse(String(m)); if (x.id === id) { ws.off('message', back); r(x.result); } });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
      return await run(call);
    } finally { ws.close(); }
  }

  /** crewd reads bare hosts (`www.` stripped, matching policy.ts), visible first; never trust the bot's sign-in claim. */
  async pages(bot: string): Promise<string[]> {
    const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const out: { host: string; on: boolean }[] = [];
    try {
      await this.withPipe(bot, async (call) => {
        const { targetInfos } = await call('Target.getTargets');
        const tabs = (targetInfos as { type: string; url: string; targetId: string }[]).filter((t) => t.type === 'page' && /^https?:/.test(t.url));
        for (const t of tabs) {
          try {
            const { sessionId } = await call('Target.attachToTarget', { targetId: t.targetId, flatten: true });
            const v = await call('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }, sessionId);
            out.push({ host: host(t.url), on: v?.result?.value === 'visible' });
          } catch { out.push({ host: host(t.url), on: false }); } // the tab went away while we read
        }
      });
    } catch { /* no browser to read: an empty list, nothing to tick */ }
    const hosts = [...out.filter((o) => o.on), ...out.filter((o) => !o.on)].map((o) => o.host).filter(Boolean);
    return [...new Set(hosts)];
  }

  /** Clear both site origins on this bot's page session; missing context or acknowledgment retains the marker. */
  async clearSite(bot: string, host: string) {
    return this.withPipe(bot, async (call) => {
      const { targetInfos } = await call('Target.getTargets');
      const page = targetInfos?.find((t: { type: string }) => t.type === 'page');
      if (!page) return false;
      const { sessionId } = await call('Target.attachToTarget', { targetId: page.targetId, flatten: true });
      if (!sessionId) return false;
      try {
        for (const scheme of ['https', 'http']) if (!await call('Storage.clearDataForOrigin', { origin: `${scheme}://${host}`, storageTypes: 'all' }, sessionId)) return false;
        return true;
      } finally { await call('Target.detachFromTarget', { sessionId }); }
    });
  }

  /** Stop desktops nobody is watching and no task needs, after the idle window. */
  sweep(busy: (bot: string) => boolean, now = Date.now()) {
    for (const d of [...this.desks.values()]) if (!d.session && !busy(d.bot) && now - d.used > IDLE_MS) this.stop(d.bot);
  }

  stop(bot: string) {
    const d = this.desks.get(bot);
    if (!d) return this.ends.get(bot);
    this.desks.delete(bot);
    d.session?.watcher.send({ kind: 'revoked', reason: 'the desktop stopped' });
    const gone = Promise.all([d.engine?.stop().catch(() => {}), ...[d.chrome, d.xvfb].map((p) =>
      p && p.exitCode === null && p.signalCode === null ? new Promise((r) => p.once('exit', r)) : undefined)]);
    this.ends.set(bot, gone);
    void gone.finally(() => { if (this.ends.get(bot) === gone) this.ends.delete(bot); });
    const chrome = d.chrome; chrome?.kill();
    // A Chromium that won't finish shutting down is not left running.
    if (chrome) setTimeout(() => { if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL'); }, 3000).unref();
    d.devtools?.close();
    d.xvfb.kill();
    return gone;
  }

  /** Wait for owned displays, browsers and captures, including a start or shutdown already in flight. */
  async stopAll() {
    await Promise.all([...this.starts.values()].map((p) => p.catch(() => {})));
    for (const bot of [...this.desks.keys()]) this.stop(bot);
    return Promise.all(this.ends.values());
  }
}
