// Each bot's own desktop (plan 3, section 3.15): an Xvfb display with its own X cookie, the bot's own Chromium on it,
// and, while a person watches, a desklink engine streaming it. Never the owner's display.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EngineClient, resolveEngine, explainMissingEngine, type EngineEvent } from '@desklink/host';

export const WIDTH = 1280, HEIGHT = 800;
const IDLE_MS = Number(process.env.CREWHOUSE_DESKTOP_IDLE_MS || 10 * 60_000);
const BROWSERS = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];

const onPath = (bin: string) => (process.env.PATH ?? '').split(':').find((d) => d && existsSync(join(d, bin))) && bin;
export const browserBin = () => BROWSERS.map(onPath).find(Boolean) || null;
/** What is missing on this machine for bot desktops, in words fit for doctor and the app. */
export function missing() {
  const out: string[] = [];
  if (!onPath('Xvfb')) out.push('Xvfb (apt install xvfb, dnf install xorg-x11-server-Xvfb, pacman -S xorg-server-xvfb)');
  const engine = explainMissingEngine();
  if (engine) out.push(`the desklink engine: ${engine}`);
  return out;
}

/** Display :N, its cookie file, and the bot's Chromium debugging port. N is stable per bot, so a restarted desktop keeps its address. */
export function deskFor(stateDir: string, bot: string, n: number) {
  return { n, display: `:${n}`, xauth: join(stateDir, 'desktops', `${bot}.xauth`), cdp: 29000 + n };
}

/** An Xauthority file with one wildcard MIT-MAGIC-COOKIE-1 entry: only holders of this file may use the display. */
function xauthority(n: number, cookie: Buffer) {
  const field = (b: Buffer) => { const len = Buffer.alloc(2); len.writeUInt16BE(b.length); return Buffer.concat([len, b]); };
  const family = Buffer.from([0xff, 0xff]); // FamilyWild
  return Buffer.concat([family, field(Buffer.alloc(0)), field(Buffer.from(String(n))), field(Buffer.from('MIT-MAGIC-COOKIE-1')), field(cookie)]);
}

/** A client-facing session event, as @desklink/react-native's Signaling.subscribe expects it. */
export type DeskEvent = { kind: 'description'; description: unknown } | { kind: 'candidate'; candidate: unknown }
  | { kind: 'state'; capture: string; transport: string; firstFrame: boolean } | { kind: 'revoked'; reason: string };

function unwrap(e: EngineEvent): DeskEvent | null {
  const p: any = e.params;
  switch (e.event) {
    case 'session.description': return { kind: 'description', description: p.description };
    case 'session.candidate': return { kind: 'candidate', candidate: { candidate: p.candidate, sdpMid: p.sdpMid, sdpMLineIndex: p.sdpMLineIndex } };
    case 'session.state': return { kind: 'state', capture: p.capture, transport: p.transport, firstFrame: p.firstFrame };
    case 'session.revoked': return { kind: 'revoked', reason: p.reason };
    default: return null; // restore tokens stay with the host
  }
}

/** Whoever is watching: where its session's events go. One watcher per bot ("one session, one controller"). */
export interface Watcher { send(e: DeskEvent): void }

interface Desk {
  bot: string; n: number; display: string; xauth: string; cdp: number;
  xvfb: ChildProcess; chrome?: ChildProcess; engine?: EngineClient;
  session?: { id: string; generation: number; control: boolean; watcher: Watcher };
  used: number;
  /** The engine announces a session's offer before its open call returns; held here until the session is known. */
  early: EngineEvent[];
}

const refused = (message: string, code = 'permission') => Object.assign(new Error(message), { code, status: 403 });

export class Desktops {
  private desks = new Map<string, Desk>();
  private stateDir: string;
  constructor(stateDir: string) { this.stateDir = stateDir; }

  running(bot: string) { return this.desks.has(bot); }
  info(bot: string) {
    const d = this.desks.get(bot);
    return d ? { display: d.display, watching: !!d.session, control: !!d.session?.control } : null;
  }

  /** Start the bot's display and browser if they aren't up. Idempotent; called before every run that needs a screen. */
  async ensure(bot: string, n: number, botDir: string) {
    const have = this.desks.get(bot);
    if (have) {
      have.used = Date.now();
      if (!have.chrome || have.chrome.exitCode !== null) have.chrome = this.browser(have, botDir);
      return have;
    }
    const why = missing().find((m) => m.startsWith('Xvfb'));
    if (why) throw new Error(`bot desktops need ${why}`);
    const d = deskFor(this.stateDir, bot, n);
    mkdirSync(join(this.stateDir, 'desktops'), { recursive: true });
    this.reapOrphan(d.display, d.xauth);
    const sock = `/tmp/.X11-unix/X${n}`;
    if (existsSync(sock)) throw new Error(`display ${d.display} is already in use by another program`);
    writeFileSync(d.xauth, xauthority(n, randomBytes(16)), { mode: 0o600 });
    const xvfb = spawn('Xvfb', [d.display, '-screen', '0', `${WIDTH}x${HEIGHT}x24`, '-nolisten', 'tcp', '-auth', d.xauth], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    xvfb.stderr!.on('data', (c) => { err = (err + c).slice(-2000); });
    for (let i = 0; !existsSync(sock); i++) {
      if (xvfb.exitCode !== null || i > 50) { xvfb.kill(); throw new Error(`Xvfb ${d.display} did not start: ${err.trim().split('\n').pop() ?? ''}`); }
      await new Promise((r) => setTimeout(r, 100));
    }
    const desk: Desk = { bot, ...d, xvfb, used: Date.now(), early: [] };
    xvfb.on('exit', () => { if (this.desks.get(bot) === desk) this.stop(bot); });
    this.desks.set(bot, desk);
    desk.chrome = this.browser(desk, botDir);
    return desk;
  }

  /** A crewd that died leaves its Xvfb behind; ours is recognisable by our own cookie path on its command line. */
  private reapOrphan(display: string, xauth: string) {
    // ponytail: scans /proc once per desktop start; fine for a handful of bots.
    for (const pid of existsSync('/proc') ? readdirSync('/proc').filter((p) => /^\d+$/.test(p)).map(Number) : []) {
      const cmd = (() => { try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0'); } catch { return []; } })();
      if (/Xvfb$/.test(cmd[0] ?? '') && cmd[1] === display && cmd.includes(xauth)) try { process.kill(pid); } catch { /* gone */ }
    }
  }

  /** The bot's own Chromium: its own profile in its folder, maximized on its display; the browser MCP drives it over CDP. */
  private browser(d: Desk, botDir: string) {
    const bin = browserBin();
    if (!bin) return undefined;
    const child = spawn(bin, [
      // Last flag wins, so these beat a distro wrapper's own flags (for example a Wayland default).
      '--ozone-platform=x11', `--user-data-dir=${join(botDir, 'browser')}`, `--remote-debugging-port=${d.cdp}`,
      '--no-first-run', '--no-default-browser-check', '--password-store=basic', '--force-device-scale-factor=1', '--start-maximized',
      '--window-position=0,0', `--window-size=${WIDTH},${HEIGHT}`, 'about:blank',
    ], { env: this.env(d), stdio: 'ignore' });
    child.on('error', () => {});
    return child;
  }

  /** Environment bound to the bot's display only: its cookie, and no route to the owner's Wayland session. */
  private env(d: Desk) {
    const { WAYLAND_DISPLAY: _w, GDK_SCALE: _s, ...rest } = process.env;
    return { ...rest, DISPLAY: d.display, XAUTHORITY: d.xauth, XDG_SESSION_TYPE: 'x11' };
  }

  /**
   * One signaling request from a watcher. crewd, not the client, picks the display and the permissions:
   * `control` is granted only while the person holds the controls.
   */
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
    if (!['session.description', 'session.candidate', 'session.close'].includes(method)) throw refused(`${method} is not allowed`, 'malformed');
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

  /** Stop desktops nobody is watching and no task needs, after the idle window. */
  sweep(busy: (bot: string) => boolean, now = Date.now()) {
    for (const d of [...this.desks.values()]) if (!d.session && !busy(d.bot) && now - d.used > IDLE_MS) this.stop(d.bot);
  }

  stop(bot: string) {
    const d = this.desks.get(bot);
    if (!d) return;
    this.desks.delete(bot);
    d.session?.watcher.send({ kind: 'revoked', reason: 'the desktop stopped' });
    void d.engine?.stop().catch(() => {});
    d.chrome?.kill();
    d.xvfb.kill();
  }

  stopAll() { for (const bot of [...this.desks.keys()]) this.stop(bot); }
}
