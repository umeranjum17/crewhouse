import './isolate.ts'; // first: before anything loads the engine
import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineTool, type AgentSession, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { CHIEF, type Config } from './config.ts';
import type { Row, Store } from './db.ts';
import * as disk from './bots.ts';
import { Desktops, deskFor, browserBin, missing as desktopMissing, type Watcher } from './desktop.ts';
import { Accounts, OWNER, PROVIDERS } from './accounts.ts';
import { Connections, type AppTool } from './connections.ts';
import { cliTool, Mcp, openSession, sandboxBash, sandboxReady, webTools } from './engine.ts';
import { coversOf, effectOf, toolWords, type Effect } from './policy.ts';
import { registry, resolveGrants, toolBin, which } from './tools.ts';
import { stubModels } from './stub.ts';
import { describe, nextRun, parseSchedule } from './routines.ts';

const HOLD_MS = Number(process.env.CREWHOUSE_HOLD_MS || 180_000); // how long a tool call waits for an answer before the turn parks
const TASK_TIMEOUT_MS = 60 * 60_000;
// How long an account rests when its limit didn't say.
const REST_MS = { rate_limit: 60 * 60_000, overloaded: 5 * 60_000, signed_out: 0 };
type Why = keyof typeof REST_MS;

/** An account's error, in the three kinds crewd acts on, and when it said to come back. Anything else fails the task. */
export function classify(error: string): { why: Why; until: number } | null {
  const mins = /try again in ~?(\d+)\s*min/i.exec(error)?.[1];
  const until = mins ? Date.now() + Number(mins) * 60_000 : 0;
  if (/usage limit|rate.?limit|quota|too many requests|\b429\b/i.test(error)) return { why: 'rate_limit', until };
  if (/overloaded|high demand|\b50[234]\b|unavailable/i.test(error)) return { why: 'overloaded', until };
  if (/unauthori[sz]ed|\b40[13]\b|sign in again|expired|invalid.*token|authentication/i.test(error)) return { why: 'signed_out', until };
  return null;
}

export const clock = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? '' : new Date(t).toLocaleDateString('en-US', { weekday: 'short' }) + ' ') +
  new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();

/** At most n characters, cut at a word boundary with an ellipsis: titles on cards and in the digest. */
export const short = (s: string, n: number) => (s = s.trim(), s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);

const STUCK_MS = Number(process.env.CREWHOUSE_STUCK_MS || 180_000); // working with no news this long: show "stuck?"
/** Events that make up a bot's plain "what I did" trail. */
const TRAIL = ['task.created', 'task.working', 'task.done', 'task.failed', 'task.progress', 'run.tool', 'run.allowed', 'run.typed',
  'ask.opened', 'ask.answered', 'ask.parked', 'file.delivered', 'memory.learned', 'memory.undone', 'bot.recruited', 'bot.allowed', 'run.resumed'];

/** Whether a member's quiet hours ("22:00-07:00", may wrap past midnight) cover this moment. */
export function quietNow(quiet: string | null | undefined, at = new Date()) {
  const m = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(quiet ?? '');
  if (!m) return false;
  const t = at.getHours() * 60 + at.getMinutes(), from = +m[1] * 60 + +m[2], to = +m[3] * 60 + +m[4];
  return from <= to ? t >= from && t < to : t >= from || t < to;
}

const clean = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

const partOfDay = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'afternoon' : 'evening'; };
/** Chief's first words (plan 3, section 3.13). Deterministic: no model call before we know how to address the person. */
export const chiefGreeting = () =>
  `Good ${partOfDay()}. I am Chief, of the Crewhouse, and I'm at your service.\n\n` +
  'A word on how we work. The crew works here, on this computer, even while you are away. ' +
  'We stop and ask you first before anything leaves this house, costs money or touches your own files, ' +
  "and whenever a sign-in or a fee looks off. We'd rather ask than get it wrong. " +
  'Nothing you tell us leaves this computer, apart from what the crew sends your own AI account to do the work.\n\n' +
  'Before we begin, how would you like me to address you? "Sir", "ma\'am", or by name, as you prefer.';

/** A bot at work: its task's engine session, on whose account and which AI, and the browser if it has one. */
interface Live { session: AgentSession; task: number; member: number; brain: disk.Brain; mcp?: Mcp; page?: string; apps?: Record<string, AppTool> }

/** The deterministic half: people, bots, tasks, the per-bot queue, asks. Models only ever see prompts. */
export class Crew {
  private live = new Map<string, Live>();
  /** Tasks to pick up in their own session: after a restart, or on the next AI account after a limit. */
  private handoffs = new Map<number, string>();
  private holds = new Map<number, (answer: string) => void>();
  /** One-time grants from answers that arrived after the hold: the retried tool call is let through once. */
  private granted = new Set<string>();
  /** "For this task" answers: the gate's keys a task's later calls go through on. */
  private taskGrants = new Map<number, string[]>();
  /** When each account rests until, keyed "<member>:<account>": one person's limit never rests another's account. */
  private rests = new Map<string, number>();
  private starting = new Set<string>();
  private timer?: NodeJS.Timeout;
  /** Bots whose screen the person is driving: the bot is paused until they give the controls back. */
  private held = new Set<string>();
  readonly desktops: Desktops;
  readonly accounts: Accounts;
  readonly connections: Connections;
  private freshAt = 0;

  private cfg: Config;
  private db: Store;

  constructor(cfg: Config, db: Store) {
    this.cfg = cfg; this.db = db;
    this.desktops = new Desktops(cfg.stateDir);
    this.accounts = new Accounts(cfg);
    if (cfg.engine === 'stub') this.accounts.prepare = stubModels;
    this.accounts.onChange = (member, key) => this.db.event('account.changed', null, { member, account: key });
    this.accounts.onExpired = (member, key) => this.say(CHIEF, 'system', `Your ${PROVIDERS[key].name} sign-in has run out. Sign in again under Settings, AI accounts, and the crew carries on.`, null, member);
    this.connections = new Connections(cfg, `http://${cfg.host}:${cfg.port}/connect/callback`);
    this.connections.onChange = (member, app) => this.db.event('app.changed', null, { member, app });
    this.connections.onExpired = (member, app) => this.say(CHIEF, 'system', `Your ${this.connections.apps[app].name} connection has run out. Connect it again under Settings, Connections, whenever you like.`, null, member);
  }

  init() {
    this.db.tx(() => {
      if (!this.db.get('SELECT 1 FROM people WHERE id = 1')) this.db.run('INSERT INTO people (id, name, created_at) VALUES (1, ?, ?)', 'Owner', Date.now());
      if (!this.bot(CHIEF)) this.addBot(disk.loadTemplate(this.cfg, 'chief'), 'Chief', CHIEF, 'system');
      // Questions whose task is over have no one left to answer them.
      this.db.run("UPDATE asks SET state = 'withdrawn' WHERE state = 'open' AND (task_id IS NULL OR task_id NOT IN (SELECT id FROM tasks WHERE state IN ('working', 'needs_you')))");
      this.db.run("UPDATE bots SET state = 'off'");
      this.db.event('system.started', null, {});
      for (const m of this.members()) this.ensureDigest(m.id);
    });
    if (!this.member(OWNER).onboarded && !this.db.get('SELECT 1 FROM messages WHERE bot = ?', CHIEF)) this.say(CHIEF, 'bot', chiefGreeting(), null, OWNER);
    this.timer = setInterval(() => this.tick(), 1500);
    this.recover();
    this.dispatch();
  }

  /** A restart is a non-event: every task that was running continues in its own session, from its session file.
   *  A parked question stays open and answerable; the bot asks the same thing again and finds it. */
  private recover() {
    const tasks = this.db.all("SELECT * FROM tasks WHERE state IN ('working', 'needs_you')");
    for (const t of tasks) {
      this.handoffs.set(t.id, 'Crewhouse restarted');
      this.setTask(t, 'queued');
    }
    if (tasks.length) this.db.event('system.recovered', null, { resumed: tasks.length });
  }

  stop() {
    clearInterval(this.timer);
    for (const [id, l] of this.live) { this.live.delete(id); l.mcp?.stop(); l.session.dispose(); }
    this.desktops.stopAll();
    this.accounts.stop();
  }

  // ---- reads ----
  member(id: number): Row {
    const m = this.db.get('SELECT * FROM people WHERE id = ?', id);
    if (!m) throw Object.assign(new Error('no such person'), { status: 404 });
    return m;
  }
  members(): Row[] { return this.db.all('SELECT * FROM people ORDER BY id').map((m) => ({ ...m, quietNow: quietNow(m.quiet) })); }
  /** Who is looking. The web app says so in a header; an unknown id falls back to the owner (a view, never an authorization). */
  viewer(id: unknown) { return this.db.get('SELECT * FROM people WHERE id = ?', Number(id) || OWNER) ?? this.member(OWNER); }
  /** "sir", "Sam", or "the person": how a member is named in prompts. */
  private called(member: number) { const m = this.member(member); return m.address || (this.members().length > 1 ? m.name : '') || 'the person'; }
  bot(id: string) { return this.db.get('SELECT rowid + 100 AS n, * FROM bots WHERE id = ?', id); }
  bots() { return this.db.all('SELECT * FROM bots ORDER BY created_at'); }
  activeTask(bot: string) { return this.db.get("SELECT * FROM tasks WHERE bot = ? AND state IN ('working', 'needs_you') ORDER BY id LIMIT 1", bot); }

  /** 0 when the member's account is available; otherwise when it stops resting. */
  restingUntil(account: string, member = OWNER) {
    const until = this.rests.get(`${member}:${account}`) ?? 0;
    return until > Date.now() ? until : 0;
  }

  /** The accounts a task may run on, in order: its own choice, the bot's fallback order, then any other account its
   *  member has signed in to (someone who only has Meta Muse still gets a working crew). Never another member's. */
  choices(task: Row) {
    return disk.dedupe([...(task.brain ? [disk.parseBrain(task.brain)] : []), ...disk.brains(this.cfg, task.bot), ...Object.keys(PROVIDERS).map((provider) => ({ provider }))]);
  }

  /** What the bot page and crew cards show: "Thinks with ChatGPT, then Grok". Account names only, never model ids. */
  thinks(id: string) {
    try {
      const member = this.bot(id)?.member ?? OWNER;
      return disk.dedupe(disk.brains(this.cfg, id).map((b) => ({ provider: b.provider }))).map((b) => ({ key: b.provider, name: disk.brainName(b), restingUntil: this.restingUntil(b.provider, member) }));
    } catch { return []; } // a hand-edited bot.json with a bad model must not take the whole app down
  }

  /** A working bot's latest step and how long it has been quiet; quiet past STUCK_MS reads as "stuck?". */
  private progress(bot: string, task: Row | undefined) {
    if (!task) return { step: null, quietSince: null, stuck: false };
    const step = this.db.get(`SELECT seq, at, kind, data FROM events WHERE bot = ? AND kind IN ('run.tool', 'task.progress', 'file.delivered') AND json_extract(data, '$.task') = ? ORDER BY seq DESC LIMIT 1`, bot, task.id);
    const quietSince = this.db.get('SELECT MAX(at) AS at FROM events WHERE bot = ?', bot)!.at as number;
    return { step: step ? { ...step, data: JSON.parse(step.data) } : null, quietSince, stuck: task.state === 'working' && Date.now() - quietSince > STUCK_MS };
  }

  /** Ideas are promises a hired bot can keep: each needs tools the bot is granted and that work on this computer. */
  private ideas() {
    return this.bots().filter((b) => b.id !== CHIEF).flatMap((b) => {
      const ready = new Set(disk.botTools(this.cfg, b.id).filter((t) => t.granted && t.ready).map((t) => t.id));
      return (disk.botConfig(this.cfg, b.id).ideas ?? []).filter((i) => i.needs.every((t) => ready.has(t)))
        .map((i) => ({ bot: b.id, promise: i.promise, ask: i.ask }));
    }).slice(0, 6);
  }

  /** A bot as the app sees it: no token, no model, nothing technical. */
  private pub(b: Row) {
    const task = this.activeTask(b.id);
    return { id: b.id, display: b.display, role: b.role, template: b.template, color: b.color, member: b.member, state: b.state, created_at: b.created_at,
      thinks: this.thinks(b.id), ...this.screenOf(b.id), live: this.liveState(b.id), task: task ? this.task(task) : null, ...this.progress(b.id, task),
      queued: this.db.get("SELECT COUNT(*) AS n FROM tasks WHERE bot = ? AND state = 'queued'", b.id)!.n,
      pausedUntil: this.db.get("SELECT MIN(wake_at) AS w FROM tasks WHERE bot = ? AND state = 'paused'", b.id)!.w };
  }

  private liveState(id: string) { const l = this.live.get(id); return !l ? 'off' : l.session.isStreaming ? 'working' : 'idle'; }

  /** A task for the app: its words and state, not the AI it asked for or its session file. */
  private task({ brain, session, ...t }: Row) { return { ...t, thinks: brain ? disk.brainName(disk.parseBrain(brain)) : null }; }

  /** An open question for the app: the plain sentence and what "For this task" or "Always" would cover. The gate's key stays here. */
  private askView({ detail, ...a }: Row) {
    const d = JSON.parse(detail || '{}');
    const covers = d.key ? coversOf(d.key) : null;
    return { ...a, detail: { effect: d.effect, words: a.title, spends: d.effect === 'spend', covers, ...(covers ? { always: covers } : {}) } };
  }

  /** What one member sees: the whole crew, but their own tasks, questions and accounts. */
  snapshot(viewer = OWNER) {
    const files = (task: number) => this.db.all(`SELECT data FROM events WHERE kind = 'file.delivered' AND json_extract(data, '$.task') = ?`, task).map((e) => JSON.parse(e.data).path);
    const me = this.viewer(viewer);
    return {
      person: { ...me, quietNow: quietNow(me.quiet) },
      members: this.members(),
      bots: this.bots().map((b) => this.pub(b)),
      templates: disk.listTemplates(this.cfg).map((t) => ({ id: t.id, display: t.display, role: t.role, color: t.color, kit: disk.templateKit(this.cfg, t) })),
      tasks: this.db.all('SELECT * FROM tasks WHERE bot != ? AND member = ? ORDER BY id DESC LIMIT 50', CHIEF, me.id).map((t) => ({ ...this.task(t), files: t.state === 'done' ? files(t.id) : [] })),
      ideas: this.ideas(),
      asks: this.db.all("SELECT * FROM asks WHERE state = 'open' AND COALESCE(member, ?) = ? ORDER BY id", OWNER, me.id).map((a) => this.askView(a)),
      events: this.db.events(0, 80),
      /** This member's AI accounts that are resting now, and until when (docs/ui-contract.md). */
      resting: Object.fromEntries(Object.keys(PROVIDERS).map((k) => [k, this.restingUntil(k, me.id)]).filter(([, t]) => t)),
      /** The apps this member has connected, by the app screen's own names. */
      connections: this.connections.on(me.id),
      desktops: { ready: desktopMissing().length === 0 },
      routines: this.routines(me.id),
    };
  }

  // ---- routines: time-based, deterministic, no model call to decide when ----
  /** One member's routines: those they set up, and their own morning digest. */
  routines(member = OWNER) {
    return this.db.all('SELECT * FROM routines WHERE member = ? ORDER BY kind, id', member).map(({ brain, ...r }): Row => ({
      ...r, words: describe(parseSchedule(r.schedule)), thinks: brain ? disk.brainName(disk.parseBrain(brain)) : null,
      history: this.db.all("SELECT seq, at, kind, data FROM events WHERE kind IN ('routine.fired', 'routine.skipped') AND json_extract(data, '$.routine') = ? ORDER BY seq DESC LIMIT 8", r.id)
        .map((e) => { const d = JSON.parse(e.data); return { at: e.at, kind: e.kind, ...d, state: d.task ? this.db.get('SELECT state FROM tasks WHERE id = ?', d.task)?.state : undefined }; }),
    }));
  }

  private routine(id: number) {
    const r = this.db.get('SELECT * FROM routines WHERE id = ?', id);
    if (!r) throw Object.assign(new Error('no such routine'), { status: 404 });
    return r;
  }

  /** Every member's morning digest is on from the start; they can move or pause it, not delete it. */
  private ensureDigest(member: number) {
    if (this.db.get("SELECT 1 FROM routines WHERE kind = 'digest' AND member = ?", member)) return;
    this.db.run("INSERT INTO routines (bot, name, schedule, kind, member, next_at, created_at) VALUES (?, 'Morning digest', 'every day 8:00', 'digest', ?, ?, ?)",
      CHIEF, member, nextRun(parseSchedule('every day 8:00'), Date.now()), Date.now());
  }

  /** A routine is its setter's: the member who added it, or the one Chief set it up for. Its runs use their accounts. */
  addRoutine(b: { bot?: string; schedule?: string; task?: string; model?: string; name?: string }, by: string, member = by === CHIEF ? this.chiefFor() : OWNER) {
    const bot = this.bot(String(b.bot ?? '').toLowerCase());
    if (!bot || bot.id === CHIEF) throw Object.assign(new Error(`no bot called ${b.bot}; a routine hands a task to one of the crew`), { status: 404 });
    const body = String(b.task ?? '').trim();
    if (!body) throw Object.assign(new Error('say what the routine should do'), { status: 400 });
    const when = parseSchedule(String(b.schedule ?? ''));
    const brain = b.model ? disk.brainKey(disk.parseBrain(b.model)) : null;
    // Unnamed routines take the task's first sentence: "Make a demo of this week's screenshots".
    const first = body.split(/\n|(?<=[.!?])\s/)[0].replace(/[.!?]$/, '');
    const name = String(b.name ?? '').trim().slice(0, 60) || short(first, 60);
    return this.db.tx(() => {
      const r = this.db.run('INSERT INTO routines (bot, name, schedule, body, brain, member, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        bot.id, name, String(b.schedule).trim(), body, brain, member, nextRun(when, Date.now()), Date.now());
      const row = this.routine(Number(r.lastInsertRowid));
      this.db.event('routine.created', bot.id, { routine: row.id, name, words: describe(when), by, member });
      if (by === CHIEF) this.say(CHIEF, 'system', `Routine added: “${name}” for ${bot.display}, ${describe(when).toLowerCase()}. First run ${clock(row.next_at)}.`, null, member);
      return row;
    });
  }

  /** Pause, resume or move a routine. Resuming counts from now: a paused routine never catches up. */
  updateRoutine(id: number, b: { state?: string; schedule?: string }) {
    const r = this.routine(id);
    const state = b.state ?? r.state;
    if (!['on', 'paused'].includes(state)) throw Object.assign(new Error('a routine is on or paused'), { status: 400 });
    const schedule = b.schedule?.trim() || r.schedule;
    const next = nextRun(parseSchedule(schedule), Date.now());
    this.db.tx(() => {
      this.db.run('UPDATE routines SET state = ?, schedule = ?, next_at = ? WHERE id = ?', state, schedule, next, id);
      this.db.event(state !== r.state ? `routine.${state === 'on' ? 'resumed' : 'paused'}` : 'routine.changed', r.bot, { routine: id, name: r.name, words: describe(parseSchedule(schedule)) });
    });
  }

  deleteRoutine(id: number) {
    const r = this.routine(id);
    if (r.kind === 'digest') throw Object.assign(new Error('the morning digest can be paused, not removed'), { status: 400 });
    this.db.tx(() => { this.db.run('DELETE FROM routines WHERE id = ?', id); this.db.event('routine.deleted', r.bot, { routine: id, name: r.name }); });
  }

  runRoutine(id: number) { this.fire(this.routine(id), 'now'); }

  /** Fire every routine that is due. A machine that slept through runs catches up once (latest only), then moves on. */
  schedule(now = Date.now()) {
    for (const r of this.db.all("SELECT * FROM routines WHERE state = 'on' AND next_at <= ?", now)) {
      this.db.run('UPDATE routines SET next_at = ? WHERE id = ?', nextRun(parseSchedule(r.schedule), now), r.id);
      try { this.fire(r, now - r.next_at > 60_000 ? 'late' : 'schedule'); } catch (e) { console.error('routine', r.id, e); }
    }
  }

  private fire(r: Row, why: 'schedule' | 'late' | 'now') {
    const now = Date.now();
    if (r.kind === 'digest') {
      this.db.tx(() => {
        this.say(CHIEF, 'bot', this.digest(r.member, r.last_at ?? now - 86_400_000), null, r.member);
        this.db.run('UPDATE routines SET last_at = ? WHERE id = ?', now, r.id);
        this.db.event('routine.fired', CHIEF, { routine: r.id, name: r.name, why, member: r.member });
      });
      return;
    }
    // Overlap: the last run is still going (or waiting on the person), so this one is skipped, not stacked.
    const open = r.last_task && this.db.get("SELECT id FROM tasks WHERE id = ? AND state IN ('queued', 'working', 'needs_you', 'paused')", r.last_task);
    if (open) {
      this.db.event('routine.skipped', r.bot, { routine: r.id, name: r.name, why: 'overlap', task: r.last_task });
      return;
    }
    const { task } = this.addTask(r.bot, r.body, 'routine', r.brain ?? undefined, r.member, r);
    this.db.tx(() => {
      this.db.run('UPDATE routines SET last_at = ?, last_task = ? WHERE id = ?', now, task, r.id);
      this.db.event('routine.fired', r.bot, { routine: r.id, name: r.name, why, task });
    });
  }

  /** Chief's "while you were away" for one member: what finished, what needs them, what is coming up. No model call. */
  digest(member: number, since: number) {
    const address = this.member(member).address;
    const name = (id: string) => this.bot(id)?.display ?? id;
    const list = (xs: string[]) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join('; ')} and ${xs.at(-1)}`;
    const done = this.db.all("SELECT * FROM tasks WHERE bot != ? AND member = ? AND state = 'done' AND updated_at >= ? ORDER BY id", CHIEF, member, since);
    const failed = this.db.all("SELECT * FROM tasks WHERE bot != ? AND member = ? AND state = 'failed' AND updated_at >= ? ORDER BY id", CHIEF, member, since);
    const asks = this.db.all("SELECT * FROM asks WHERE state = 'open' AND COALESCE(member, ?) = ? ORDER BY id", OWNER, member);
    const learned = this.db.all("SELECT bot, data FROM events WHERE kind = 'memory.learned' AND at >= ? ORDER BY seq", since);
    const soon = this.db.all("SELECT * FROM routines WHERE state = 'on' AND kind != 'digest' AND member = ? AND next_at <= ? ORDER BY next_at", member, Date.now() + 86_400_000);
    const lines = [`Good ${partOfDay()}${address ? `, ${address}` : ''}. While you were away:`];
    lines.push(done.length ? `- Finished: ${list(done.slice(0, 5).map((t) => `${name(t.bot)}, “${t.title}”`))}${done.length > 5 ? `, and ${done.length - 5} more` : ''}.` : '- Nothing new was finished.');
    if (failed.length) lines.push(`- Did not go well: ${list(failed.slice(0, 3).map((t) => `${name(t.bot)}, “${t.title}” (${String(t.result ?? '').slice(0, 80)})`))}.`);
    lines.push(asks.length ? `- Needs you: ${list(asks.slice(0, 3).map((a) => a.title))}. It is under Needs you.` : '- Nothing needs you.');
    for (const l of learned.slice(0, 3)) lines.push(`- ${name(l.bot)} learned: ${JSON.parse(l.data).text}`);
    lines.push(soon.length ? `- Coming up: ${list(soon.map((r) => `“${r.name}” with ${name(r.bot)}, ${clock(r.next_at)}`))}.` : '- Nothing is scheduled for the next day.');
    return lines.join('\n');
  }

  botPage(id: string, viewer = OWNER) {
    const b = this.bot(id);
    if (!b) throw Object.assign(new Error('no such bot'), { status: 404 });
    const undone = new Set(this.db.all("SELECT data FROM events WHERE bot = ? AND kind = 'memory.undone'", id).map((e) => JSON.parse(e.data).seq));
    return {
      bot: this.pub(b),
      // Each member has their own thread with a bot; notes to the whole house (member NULL) show to everyone.
      messages: this.db.all('SELECT * FROM (SELECT * FROM messages WHERE bot = ? AND COALESCE(member, ?) = ? ORDER BY id DESC LIMIT 200) ORDER BY id', id, viewer, viewer),
      tasks: this.db.all('SELECT * FROM tasks WHERE bot = ? ORDER BY id DESC LIMIT 50', id).map((t) => this.task(t)),
      notes: disk.readNotes(this.cfg, id),
      notesCap: disk.NOTES_CAP,
      skills: disk.listSkills(this.cfg, id),
      tools: disk.botTools(this.cfg, id),
      files: disk.listFiles(this.cfg, id),
      trail: this.db.all(`SELECT * FROM events WHERE bot = ? AND kind IN (${TRAIL.map(() => '?').join(', ')}) ORDER BY seq DESC LIMIT 300`, id, ...TRAIL)
        .map((e) => ({ ...e, data: JSON.parse(e.data), ...(e.kind === 'memory.learned' && undone.has(e.seq) ? { undone: true } : {}) })),
      // Standing answers in plain words; taking one back sends the words back.
      allow: (disk.botConfig(this.cfg, id).allow ?? []).map(coversOf),
      memory: disk.botConfig(this.cfg, id).memory !== false,
    };
  }

  private screenOf(id: string) {
    const d = this.desktops.info(id);
    return { controls: this.held.has(id) ? 'person' : 'bot', desktop: d && { watching: d.watching, control: d.control }, computer: disk.canUse(this.cfg, id, 'computer') };
  }

  // ---- people ----
  /** First meeting: the person tells Chief how to be addressed. Stored per person, used by every bot. */
  onboard(address: string, member = OWNER) {
    const a = clean(address, 40);
    if (!a) throw Object.assign(new Error('say how Chief should address you'), { status: 400 });
    const empty = this.bots().length === 1;
    this.db.tx(() => {
      this.db.run('UPDATE people SET address = ?, onboarded = 1 WHERE id = ?', a, member);
      this.say(CHIEF, 'person', a, null, member);
      this.say(CHIEF, 'bot', `Very good, ${a}. The whole crew will know it. ` +
        'Tell me what needs doing and I shall see it into the right hands. ' + (empty ? 'The crew is empty for now; I can recruit ' +
        'Reel for demo videos, Scout for research, Scribe for drafts, or Tracer for leads, whenever you wish.' : 'I can also recruit someone new, whenever you wish.'), null, member);
      this.db.event('person.onboarded', null, { member, address: a });
    });
  }

  /** Someone else in the house. Chief greets them in their own thread; they sign in to their own AI accounts in Settings. */
  addMember(name: string) {
    const n = clean(name, 32);
    if (!n) throw Object.assign(new Error('give them a name'), { status: 400 });
    if (this.db.get('SELECT 1 FROM people WHERE lower(name) = lower(?)', n)) throw Object.assign(new Error(`${n} is already here`), { status: 409 });
    return this.db.tx(() => {
      const id = Number(this.db.run('INSERT INTO people (name, created_at) VALUES (?, ?)', n, Date.now()).lastInsertRowid);
      this.say(CHIEF, 'bot', chiefGreeting(), null, id);
      this.db.event('person.added', null, { member: id, name: n });
      this.ensureDigest(id);
      return this.member(id);
    });
  }

  /** Name, how Chief addresses them, and quiet hours ("22:00-07:00", or null for none). */
  updateMember(id: number, body: { name?: unknown; address?: unknown; quiet?: unknown }) {
    this.member(id);
    if (body.name !== undefined) {
      const n = clean(body.name, 32);
      if (!n) throw Object.assign(new Error('give them a name'), { status: 400 });
      this.db.run('UPDATE people SET name = ? WHERE id = ?', n, id);
    }
    if (body.quiet !== undefined) {
      if (body.quiet !== null && !(typeof body.quiet === 'string' && /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(body.quiet))) {
        throw Object.assign(new Error('quiet hours look like 22:00-07:00'), { status: 400 });
      }
      this.db.run('UPDATE people SET quiet = ? WHERE id = ?', body.quiet, id);
    }
    if (body.address !== undefined) this.setAddress(String(body.address), id);
    this.db.event('person.updated', null, { member: id });
    return this.member(id);
  }

  // ---- crew ----
  private addBot(tpl: disk.Template, display: string, id: string, by: string, member = OWNER) {
    disk.createBotFolder(this.cfg, id, tpl, display);
    this.db.run('INSERT INTO bots (id, display, role, template, color, token, created_at, member) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, display, tpl.role, tpl.id, tpl.color, randomBytes(16).toString('hex'), Date.now(), member);
    this.db.event('bot.recruited', id, { display, template: tpl.id, by, member });
  }

  /** The member Chief is working for right now: whoever asked for his current task. */
  chiefFor() { return this.activeTask(CHIEF)?.member ?? OWNER; }

  /** A new bot is its recruiter's: the member who hired it, or the one Chief recruited it for. */
  recruit(template: string, name: string | undefined, by: string, member = by === CHIEF ? this.chiefFor() : OWNER) {
    const tpl = disk.loadTemplate(this.cfg, template);
    if (template === 'chief') throw Object.assign(new Error('there is only one Chief'), { status: 400 });
    const display = (name || tpl.display).trim().slice(0, 32);
    const id = disk.slug(display);
    if (this.bot(id) || id === CHIEF) throw Object.assign(new Error(`there is already a bot called ${display}`), { status: 409 });
    this.db.tx(() => {
      this.addBot(tpl, display, id, by, member);
      this.say(id, 'system', `${display} joined the crew (${tpl.role.toLowerCase()}).`);
    });
    return this.bot(id)!;
  }

  // ---- work ----
  /** A message in a bot's thread: the member's own thread when it belongs to their task, the whole house's otherwise. */
  say(bot: string, author: string, text: string, taskId: number | null = null, member?: number | null) {
    const m = member !== undefined ? member : taskId ? this.db.get('SELECT member FROM tasks WHERE id = ?', taskId)?.member ?? null : null;
    const r = this.db.run('INSERT INTO messages (bot, author, text, task_id, at, member) VALUES (?, ?, ?, ?, ?, ?)', bot, author, text, taskId, Date.now(), m);
    this.db.event('message', bot, { id: Number(r.lastInsertRowid), author, text: text.slice(0, 280) });
  }

  /** A person's message in a bot's thread is a task for that bot; Chief's thread is a task for Chief. */
  post(botId: string, text: string, model?: string, member = OWNER) {
    const bot = this.bot(botId);
    if (!bot) throw Object.assign(new Error('no such bot'), { status: 404 });
    if (!text.trim()) throw Object.assign(new Error('empty message'), { status: 400 });
    if (botId === CHIEF && !this.member(member).onboarded) return this.onboard(text, member);
    return this.addTask(botId, text.trim(), 'person', model, member);
  }

  /** `model` picks the AI account for this one task (a cheap one for bulk steps, a strong one for judgment). */
  assign(botId: string, text: string, by: string, model?: string) {
    if (!this.bot(botId)) throw Object.assign(new Error(`no bot called ${botId}; see crew roster`), { status: 404 });
    if (botId === CHIEF) throw Object.assign(new Error('Chief cannot assign to himself'), { status: 400 });
    // Chief's hand-offs are for whoever asked Chief, and run on that member's own accounts.
    return this.addTask(botId, text.trim(), by, model, by === CHIEF ? this.chiefFor() : this.bot(botId)!.member ?? OWNER);
  }

  private addTask(bot: string, body: string, origin: string, model: string | undefined, member: number, routine?: Row) {
    const brain = model ? disk.brainKey(disk.parseBrain(model)) : null;
    const title = short(routine?.name ?? body.split('\n')[0], 80);
    const id = this.db.tx(() => {
      const now = Date.now();
      const r = this.db.run('INSERT INTO tasks (bot, title, body, origin, state, created_at, updated_at, brain, member, routine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        bot, title, body, origin, 'queued', now, now, brain, member, routine?.id ?? null);
      const id = Number(r.lastInsertRowid);
      if (routine) this.say(bot, 'system', `Routine “${routine.name}”: ${body}`, id);
      else this.say(bot, origin === 'person' ? 'person' : origin, body, id);
      this.db.event('task.created', bot, { task: id, origin, member, title });
      return id;
    });
    queueMicrotask(() => this.dispatch());
    return { task: id };
  }

  private setTask(task: Row, state: string, result?: string) {
    if (state === 'done' || state === 'failed') this.taskGrants.delete(task.id);
    this.db.run('UPDATE tasks SET state = ?, result = COALESCE(?, result), updated_at = ? WHERE id = ?', state, result ?? null, Date.now(), task.id);
    this.db.event(`task.${state}`, task.bot, { task: task.id, title: task.title, ...(result ? { result: result.slice(0, 280) } : {}) });
  }

  private prompt(task: Row) {
    const member = this.member(task.member ?? OWNER);
    const who = task.origin === 'person' ? this.called(member.id) : task.origin === CHIEF ? 'Chief' : task.origin;
    const routine = task.routine && this.db.get('SELECT name FROM routines WHERE id = ?', task.routine)?.name;
    // The debrief: the bot proposes what to keep; crewd caps it, commits it and offers Undo.
    const debrief = disk.botConfig(this.cfg, task.bot).memory === false ? '' : `\n\n[Crewhouse] When you finish: if this task showed you a lasting preference of ${who}, ` +
      'save it with crew_remember (one short line; name the old note in `replaces` to correct one). Otherwise save nothing.';
    if (task.bot !== CHIEF) return `${this.memory(task.bot, member.id)}[Crewhouse task #${task.id} from ${routine ? `the routine “${routine}”, set up by ${this.called(member.id)}` : who}]\n${task.body}${debrief}`;
    const crew = this.bots().filter((b) => b.id !== CHIEF)
      .map((b) => `${b.display} (id ${b.id}, ${b.template}, ${this.activeTask(b.id) ? 'busy' : 'free'})`).join('; ') || 'nobody yet';
    const tpls = disk.listTemplates(this.cfg).map((t) => `${t.id}: ${t.role}`).join('; ');
    const house = this.members().length > 1 ? ` You are speaking with ${member.name}, one of the household; each person has their own crew thread and AI accounts.` : '';
    return `${this.memory(task.bot, member.id)}[Crewhouse]${house} Crew: ${crew}. Templates: ${tpls}.\nThe person says: ${task.body}`;
  }

  /** How to address the person, and the bot's notes: read at the start of every task, so a correction lands at once. */
  private memory(id: string, member: number) {
    const notes = disk.botConfig(this.cfg, id).memory === false ? '' : disk.readNotes(this.cfg, id).trim();
    return `[Crewhouse] ${disk.addressLine(this.member(member).address)}${notes ? `\nYour notes (what you have learned about the person):\n${notes}` : ''}\n\n`;
  }

  /** Per-bot queue: one task at a time per bot, a global cap across bots. */
  dispatch() {
    for (const t of this.db.all("SELECT * FROM tasks WHERE state = 'paused' AND wake_at <= ?", Date.now())) this.setTask(t, 'queued');
    const busy = this.db.get("SELECT COUNT(DISTINCT bot) AS n FROM tasks WHERE state IN ('working', 'needs_you')")!.n + this.starting.size;
    let free = this.cfg.maxConcurrent - busy;
    for (const t of this.db.all("SELECT * FROM tasks WHERE state = 'queued' ORDER BY id")) {
      if (free <= 0) break;
      if (this.activeTask(t.bot) || this.starting.has(t.bot) || this.held.has(t.bot)) continue;
      free--;
      this.starting.add(t.bot);
      void this.run(t);
    }
  }

  /** Start (or continue) a task in its own engine session, on its member's own accounts, never anyone else's. */
  private async run(task: Row) {
    const bot = this.bot(task.bot)!;
    const member = task.member ?? OWNER;
    try {
      const choices = this.choices(task);
      for (const b of choices) await this.accounts.signedIn(member, b.provider).catch(() => false);
      const brain = choices.find((b) => !this.restingUntil(b.provider, member) && !this.accounts.unready(member, b.provider));
      if (!brain) return this.pause(task, choices);
      this.setTask(task, 'working');
      const handoff = this.handoffs.get(task.id);
      this.handoffs.delete(task.id);
      const resumes = !!task.session && existsSync(task.session);
      const l = await this.open(bot, task, member, brain, resumes ? task.session : undefined);
      this.db.run("UPDATE bots SET state = 'on' WHERE id = ?", bot.id);
      this.db.event('run.started', bot.id, { task: task.id, account: brain.provider, name: disk.brainName(brain), member });
      if (handoff && resumes) this.db.event('run.resumed', bot.id, { task: task.id, why: handoff });
      if (handoff && handoff !== 'Crewhouse restarted') this.say(bot.id, 'system', `${handoff}. ${bot.display} carries on with ${disk.brainName(brain)}.`, task.id);
      this.turn(bot.id, l, resumes ? `[Crewhouse] ${handoff ?? 'You were interrupted'}. Continue task #${task.id} where you left off; ` +
        'check work/ and files/ before redoing anything.' : this.prompt(task));
    } catch (e: any) {
      console.error(`run ${bot.id} #${task.id}:`, e);
      this.close(bot.id);
      this.setTask(task, 'failed', `${bot.display} couldn't start. Try again.`);
      this.say(bot.id, 'system', `${bot.display} couldn't start this one. Try again in a moment.`, task.id);
    } finally {
      this.starting.delete(bot.id);
      this.dispatch();
    }
  }

  /** The engine session for a task: the bot's folder as its space, its granted tools, crewd's gate on every call. */
  private async open(bot: Row, task: Row, member: number, brain: disk.Brain, file?: string) {
    this.close(bot.id);
    const space = disk.botDir(this.cfg, bot.id);
    const conf = disk.botConfig(this.cfg, bot.id);
    const desk = deskFor(this.cfg.stateDir, bot.id, bot.n);
    const g = resolveGrants(this.cfg, conf.tools ?? [], { 'bot.dir': space, 'bot.id': bot.id });
    const tools: ToolDefinition[] = [...this.crewTools(bot.id)];
    const builtins = g.tools.includes('files') ? ['read', 'write', 'edit', 'ls', 'grep', 'find'] : [];
    const l = { task: task.id, member, brain } as Live;
    if (g.tools.includes('files') && sandboxReady()) tools.push(sandboxBash(space, [this.cfg.toolsDir], { ...g.env, PATH: toolBin(this.cfg) }) as ToolDefinition);
    if (g.tools.includes('web')) tools.push(...webTools());
    for (const t of registry(this.cfg).filter((t) => t.run && g.tools.includes(t.id))) {
      tools.push(cliTool(t.id.replace(/-/g, '_'), which(this.cfg, t.bins[0]) ?? t.bins[0], t.name, space, g.env));
    }
    // The person's connected apps (their Notion, their Google…): every helper working for them can use them, through the gate.
    const apps = await this.connections.tools(member);
    tools.push(...apps.tools);
    l.apps = apps.effects;
    if (g.mcp.browser) {
      // With its own computer, the bot's browser tool drives the visible Chromium crewd keeps on the bot's display.
      if (g.tools.includes('computer') && browserBin() && this.cfg.engine === 'pi') {
        await this.desktops.ensure(bot.id, bot.n, space);
        g.mcp.browser.args = ['--cdp-endpoint', `http://127.0.0.1:${desk.cdp}`, '--output-dir', join(space, 'work', 'browser')];
      }
      const mcp = new Mcp(g.mcp.browser.command, g.mcp.browser.args, g.mcp.browser.env);
      const seen = (text: string) => { const page = /Page URL: (\S+)/.exec(text)?.[1]; if (page) l.page = page; };
      try { tools.push(...await mcp.tools(seen)); l.mcp = mcp; } catch (e) { console.error(`browser for ${bot.id}:`, e); mcp.stop(); }
    }
    l.session = await openSession({
      runtime: await this.accounts.runtime(member), provider: PROVIDERS[brain.provider].pi, model: brain.model ?? PROVIDERS[brain.provider].model,
      space, file, sessionsDir: join(this.cfg.stateDir, 'sessions', bot.id), system: disk.systemPrompt(this.cfg, bot.id, bot.id === CHIEF),
      skills: join(space, 'skills'), builtins, tools, gate: (tool, input) => this.gate(bot.id, tool, input), retry: this.cfg.engine === 'pi',
    });
    this.live.set(bot.id, l);
    this.db.run('UPDATE tasks SET session = ? WHERE id = ?', l.session.sessionFile ?? null, task.id);
    return l;
  }

  private close(botId: string) {
    const l = this.live.get(botId);
    if (!l) return;
    this.live.delete(botId);
    l.mcp?.stop();
    l.session.dispose();
  }

  /** One turn: the prompt goes in, and when the engine settles the reply (or the account's error) is handled. */
  private turn(botId: string, l: Live, text: string) {
    this.db.event('run.prompted', botId, { task: l.task });
    const run = l.session.isStreaming ? l.session.followUp(text) : l.session.prompt(text);
    run.then(() => this.settled(botId, l), (e) => this.settled(botId, l, e));
  }

  private settled(botId: string, l: Live, err?: unknown) {
    if (this.live.get(botId) !== l || l.session.isStreaming) return; // replaced, reset, or more work queued behind this turn
    const last: any = [...l.session.messages].reverse().find((m: any) => m.role === 'assistant');
    if (last?.stopReason === 'aborted') return; // stopped on purpose: Take over or Stop
    const error = err ? String((err as Error).message ?? err) : last?.stopReason === 'error' ? String(last.errorMessage ?? 'error') : '';
    if (!error) return this.finish(botId, l.session.getLastAssistantText() ?? '');
    const kind = classify(error);
    if (kind) return void this.failover(botId, kind.why, kind.until);
    console.error(`${botId}: ${error}`);
    const task = this.activeTask(botId);
    if (task) this.setTask(task, 'failed', `${PROVIDERS[l.brain.provider].name} couldn't finish this one. Try again.`);
    this.close(botId);
    this.dispatch();
  }

  /** Every account this task could use is resting: wait for the earliest. Signed out of all of them: say so. */
  private pause(task: Row, choices: disk.Brain[]) {
    const member = task.member ?? OWNER;
    const whose = this.members().length > 1 ? `${this.member(member).name}'s` : '';
    // Only accounts the member has: a resting one wakes up; one never signed in doesn't.
    const rests = choices.filter((b) => !this.accounts.unready(member, b.provider)).map((b) => this.restingUntil(b.provider, member)).filter(Boolean);
    if (!rests.length) {
      const why = `${whose ? `${this.member(member).name} has` : 'You have'} no AI account signed in yet`;
      this.db.tx(() => {
        this.setTask(task, 'failed', `${why}. Sign in under Settings, AI accounts, then try again.`);
        this.say(task.bot, 'system', `${why}. Sign in under Settings, AI accounts; nobody else's account can stand in.`, task.id);
      });
      return;
    }
    const wake = Math.min(...rests);
    const why = `All ${whose ? whose + ' ' : ''}AI accounts are resting until ${clock(wake)}`;
    this.db.tx(() => {
      this.db.run('UPDATE tasks SET wake_at = ? WHERE id = ?', wake, task.id);
      this.setTask(task, 'paused', `${why}.`);
      this.say(task.bot, 'system', `${why}. I'll pick this up then.`, task.id);
    });
  }

  /** An account hit its limit, is overloaded or needs signing in again: rest it, and the task continues in its own
   *  session on the next account, conversation and all. */
  private async failover(botId: string, why: Why, known = 0) {
    const l = this.live.get(botId);
    const task = this.activeTask(botId);
    if (!l || !task) return;
    const name = PROVIDERS[l.brain.provider].name;
    let words = `${name} needs you to sign in again`;
    if (why === 'signed_out') this.accounts.forget(l.member, l.brain.provider);
    else {
      const until = known || Date.now() + REST_MS[why];
      this.rests.set(`${l.member}:${l.brain.provider}`, until);
      this.db.event('account.resting', null, { account: l.brain.provider, name, member: l.member, until });
      words = why === 'rate_limit' ? `${name} is resting until ${clock(until)}` : `${name} is busy right now`;
    }
    this.close(botId);
    this.handoffs.set(task.id, words);
    this.db.tx(() => {
      this.db.run("UPDATE bots SET state = 'off' WHERE id = ?", botId);
      this.setTask(task, 'queued');
    });
    this.dispatch();
  }

  /** A turn finished with a reply. */
  finish(botId: string, reply: string) {
    const task = this.activeTask(botId);
    const text = reply.trim();
    // A turn that ended on a parked question isn't the end of the task: it resumes when the person answers.
    const parked = task && this.db.get("SELECT 1 FROM asks WHERE task_id = ? AND state = 'open' AND kind = 'permission'", task.id);
    this.db.tx(() => {
      if (text) this.say(botId, 'bot', text, task?.id ?? null);
      if (task && parked && task.state !== 'needs_you') this.setTask(task, 'needs_you');
      // While the person holds the controls the turn was cut short on purpose; Give back resumes it.
      if (!task || parked || this.held.has(botId)) return;
      this.setTask(task, 'done', text || 'Done.');
      if (task.origin === CHIEF) {
        const b = this.bot(botId)!;
        this.say(CHIEF, 'system', `${b.display} has finished task #${task.id}: ${text.slice(0, 240)}${text.length > 240 ? '…' : ''}`, null, task.member ?? OWNER);
      }
    });
    if (task && !parked && !this.held.has(botId)) this.close(botId);
    this.dispatch();
  }

  // ---- the gate: every tool call, before it runs ----
  /** What the policy needs to know about a bot right now. */
  private seen(botId: string) {
    const conf = disk.botConfig(this.cfg, botId);
    const granted = new Set(conf.tools ?? []);
    return {
      bot: this.bot(botId)!.display, space: disk.botDir(this.cfg, botId), page: this.live.get(botId)?.page, signedIn: conf.signedIn ?? [], apps: this.live.get(botId)?.apps,
      run: Object.fromEntries(registry(this.cfg).filter((t) => t.run && granted.has(t.id)).map((t) => [t.id.replace(/-/g, '_'), { name: t.name, ...t.run! }])),
      // Sign-ins and keys: every member's, the engine's, and other programs'. Nothing reads them through a bot.
      secret: [this.cfg.stateDir, this.cfg.toolsDir, ...['.pi', '.ssh', '.gnupg', '.aws', '.config/gh', '.treg', '.codex', '.claude', '.claude.json'].map((d) => join(homedir(), d))],
    };
  }

  /** Run it, refuse it, or ask the person in one plain sentence and wait. The model's own words never decide. */
  private async gate(botId: string, tool: string, input: Record<string, any>) {
    if (this.held.has(botId)) return { block: true, reason: 'The person has the controls of your screen; wait. You will be told when they give them back.', terminate: true };
    const task = this.activeTask(botId);
    const e = effectOf(tool, input, this.seen(botId));
    const words = toolWords(tool, input);
    if (words) this.db.event('run.tool', botId, { task: task?.id, words });
    if (e.kind === 'safe') return undefined;
    if (e.kind === 'refuse') return { block: true, reason: e.why };
    if (this.granted.delete(`${botId}\n${e.words}`)) return undefined; // answered "allow" after the turn had parked
    const standing = e.key && [...(task && this.taskGrants.get(task.id) || []), ...(disk.botConfig(this.cfg, botId).allow ?? [])].includes(e.key);
    if (standing) {
      this.db.event('run.allowed', botId, { task: task?.id, words: e.words });
      return undefined;
    }
    const answer = await this.ask(botId, task, e);
    if (answer === null) return { block: true, terminate: true, reason: "The person hasn't answered yet; stop here and wait. You'll be told when they answer." };
    return answer === 'allow' ? undefined : { block: true, reason: 'The person said not now. Continue without it, or explain what you need.' };
  }

  /** Hold the call while the person decides; after the hold, park: the turn ends and the answer arrives as the next prompt. */
  private async ask(botId: string, task: Row | undefined, e: Extract<Effect, { words: string }>): Promise<string | null> {
    // The same call asked again (the bot resumed after a restart) takes over the card already shown.
    const same = this.db.all("SELECT id FROM asks WHERE bot = ? AND kind = 'permission' AND state = 'open' AND title = ?", botId, e.words).find((a) => !this.holds.has(a.id));
    const askId = same ? same.id : this.openAsk(botId, task, e.words, { effect: e.kind, key: e.key });
    if (same && task) this.setTask(task, 'needs_you');
    // In their quiet hours nobody will answer soon: park at once instead of holding the bot.
    const quiet = quietNow(this.member(task?.member ?? this.bot(botId)?.member ?? OWNER).quiet);
    const answer = await new Promise<string | null>((resolve) => {
      const t = setTimeout(() => { this.holds.delete(askId); resolve(null); }, quiet ? 0 : HOLD_MS);
      this.holds.set(askId, (a) => { clearTimeout(t); resolve(a); });
    });
    if (answer === null) this.db.event('ask.parked', botId, { ask: askId, task: task?.id, quiet });
    else if (task) this.setTask(this.db.get('SELECT * FROM tasks WHERE id = ?', task.id)!, 'working');
    return answer;
  }

  private openAsk(bot: string, task: Row | undefined, title: string, detail: Row) {
    return this.db.tx(() => {
      // The question goes to whoever the work is for.
      const member = task?.member ?? this.bot(bot)?.member ?? OWNER;
      const r = this.db.run("INSERT INTO asks (bot, task_id, kind, title, detail, at, member) VALUES (?, ?, 'permission', ?, ?, ?, ?)", bot, task?.id ?? null, title, JSON.stringify(detail), Date.now(), member);
      if (task) this.setTask(task, 'needs_you');
      this.db.event('ask.opened', bot, { ask: Number(r.lastInsertRowid), task: task?.id, title, effect: detail.effect });
      return Number(r.lastInsertRowid);
    });
  }

  /** Allow once, for this task, or always for the bot; or not now. Spending is never more than once. */
  async answer(askId: number, body: { answer?: string; scope?: string }) {
    const ask = this.db.get("SELECT * FROM asks WHERE id = ? AND state = 'open'", askId);
    if (!ask) throw fail('that question is already settled', 409);
    const detail = JSON.parse(ask.detail || '{}');
    if (!['allow', 'deny'].includes(body.answer ?? '')) throw fail('answer allow or deny');
    const scope = body.answer === 'allow' ? body.scope ?? 'once' : 'once';
    if (!['once', 'task', 'always'].includes(scope) || (scope !== 'once' && !detail.key) || (scope === 'task' && !ask.task_id)) throw fail('allow once, for this task, or always');
    const who = this.bot(ask.bot)?.display ?? ask.bot;
    const shown = body.answer === 'deny' ? 'not now' : scope === 'task' ? 'allowed for this task' : scope === 'always' ? `always allowed for ${who}` : 'allowed once';
    const held = this.holds.get(askId);
    this.db.tx(() => {
      this.db.run("UPDATE asks SET state = 'answered', answer = ?, answered_at = ? WHERE id = ?", shown, Date.now(), askId);
      this.db.event('ask.answered', ask.bot, { ask: askId, task: ask.task_id, answer: shown });
      if (scope === 'task') this.taskGrants.set(ask.task_id, [...(this.taskGrants.get(ask.task_id) ?? []), detail.key]);
      if (scope === 'always') {
        disk.setSettings(this.cfg, ask.bot, { allow: [...(disk.botConfig(this.cfg, ask.bot).allow ?? []), detail.key] });
        this.db.event('bot.allowed', ask.bot, { covers: coversOf(detail.key) });
      }
      const task = ask.task_id && this.db.get("SELECT * FROM tasks WHERE id = ? AND state = 'needs_you'", ask.task_id);
      if (task && !held) this.setTask(task, 'working');
    });
    if (held) { held(body.answer!); this.holds.delete(askId); return; }
    // Parked: the turn already ended with a "wait", so the answer is the next prompt into the same session.
    if (body.answer === 'allow') this.granted.add(`${ask.bot}\n${ask.title}`);
    const task = ask.task_id && this.db.get('SELECT * FROM tasks WHERE id = ?', ask.task_id);
    const l = this.live.get(ask.bot);
    if (!task || !l || l.task !== task.id) return; // not running now (after a restart): it asks again when it resumes, and goes through
    this.turn(ask.bot, l, `[Crewhouse] ${this.called(task.member ?? OWNER).replace(/^the/, 'The')} has answered your request ("${ask.title}"): ` +
      (body.answer === 'allow' ? 'allowed. Go ahead and continue the task.' : 'not now. Continue without it, or explain what you need.'));
  }

  /** "Chief, call me Umer": for Chief's current member unless another is named. */
  setAddress(address: string, member = this.chiefFor()) {
    const a = clean(address, 40);
    if (!a) throw fail('say how to address them');
    this.db.run('UPDATE people SET address = ?, onboarded = 1 WHERE id = ?', a, member);
    this.db.event('person.onboarded', null, { member, address: a });
  }

  /** The person adds a word while the bot works: it reads it after its current step, without starting over. */
  steer(botId: string, text: string, member = OWNER) {
    const l = this.live.get(botId);
    if (!text.trim()) throw fail('empty message');
    if (!l?.session.isStreaming) throw fail(`${this.bot(botId)?.display ?? 'That bot'} isn't working on anything right now; send it as a message`, 409);
    void l.session.steer(text.trim());
    this.say(botId, 'person', text.trim(), l.task, member);
    this.db.event('run.typed', botId, { task: l.task });
  }

  // ---- the crew tools: how a bot reports, delivers and remembers, and how Chief runs the crew ----
  private crewTools(botId: string): ToolDefinition[] {
    const tool = (name: string, description: string, params: Record<string, any>, fn: (p: any) => unknown) => defineTool({
      name, label: name, description, parameters: Type.Object(params),
      execute: async (_id, p) => ({ content: [{ type: 'text', text: JSON.stringify(await fn(p) ?? { ok: true }) }], details: {} }),
    }) as ToolDefinition;
    const task = () => this.activeTask(botId)?.id;
    const own = [
      tool('crew_report', 'A one-line progress note the person sees.', { text: Type.String() }, (p) => { this.db.event('task.progress', botId, { task: task(), text: clean(p.text, 200) }); }),
      tool('crew_deliver', 'Register a finished file (a path in your folder, usually under files/).', { path: Type.String(), note: Type.Optional(Type.String()) }, (p) => this.deliver(botId, p.path, p.note)),
      tool('crew_remember', 'Save a lasting preference of the person to your notes (one short line). `replaces`: words of an old note this corrects.',
        { text: Type.String(), replaces: Type.Optional(Type.String()) }, (p) => {
          const change = disk.remember(this.cfg, botId, String(p.text ?? ''), String(p.replaces ?? ''));
          this.db.event('memory.learned', botId, { task: task(), text: change.added.slice(2, 202), ...change });
        }),
    ];
    if (botId !== CHIEF) return own;
    const accounts = Object.keys(PROVIDERS).join(', ');
    return [...own,
      tool('crew_roster', 'Who is on the crew, and the templates you can recruit from.', {}, () => ({
        crew: this.bots().filter((x) => x.id !== CHIEF).map((x) => ({ id: x.id, name: x.display, role: x.role, busy: !!this.activeTask(x.id) })),
        templates: disk.listTemplates(this.cfg).map((t) => ({ id: t.id, name: t.display, role: t.role })),
      })),
      tool('crew_recruit', 'Recruit a bot from a template.', { template: Type.String(), name: Type.Optional(Type.String()) },
        (p) => { const n = this.recruit(p.template, p.name, CHIEF); return { recruited: { id: n.id, name: n.display } }; }),
      tool('crew_assign', `Hand a bot a task: the person's words, then one line "Done means: …". \`account\` (${accounts}) only when a task plainly suits another AI.`,
        { bot: Type.String(), task: Type.String(), account: Type.Optional(Type.String()) }, (p) => this.assign(String(p.bot).toLowerCase(), p.task ?? '', CHIEF, p.account)),
      tool('crew_routine', 'Hand a bot the same task on a schedule. `when` is plain words in local time: "every Monday 9:00", "weekdays 8am", "every 2 hours".',
        { bot: Type.String(), when: Type.String(), task: Type.String(), name: Type.Optional(Type.String()), account: Type.Optional(Type.String()) },
        (p) => { const x = this.addRoutine({ bot: p.bot, schedule: p.when, task: p.task, name: p.name, model: p.account }, CHIEF); return { routine: { id: x.id, name: x.name, next: new Date(x.next_at).toString() } }; }),
      tool('crew_routines', 'The routines and when each runs next.', {}, () => this.routines(this.chiefFor()).map((x) => ({ id: x.id, bot: x.bot, name: x.name, when: x.words, state: x.state, next: new Date(x.next_at).toString() }))),
      tool('crew_status', 'Open tasks.', {}, () => this.db.all("SELECT id, bot, title, state FROM tasks WHERE state IN ('queued','working','needs_you','paused') ORDER BY id")),
      tool('crew_call_me', 'Change how the person is addressed, when they ask.', { how: Type.String() }, (p) => { this.setAddress(String(p.how ?? '')); }),
    ];
  }

  /** A finished file, registered once per task (a retried call is a no-op). Only inside the bot's own folder. */
  private deliver(botId: string, path: string, note?: string) {
    const full = disk.insideBot(this.cfg, botId, String(path ?? ''));
    if (!existsSync(full)) throw new Error(`no file at ${path}`);
    const rel = full.slice(disk.botDir(this.cfg, botId).length + 1);
    const task = this.activeTask(botId)?.id;
    if (task && this.db.get(`SELECT 1 FROM events WHERE kind = 'file.delivered' AND bot = ? AND json_extract(data, '$.task') = ? AND json_extract(data, '$.path') = ?`, botId, task, rel)) return { ok: true, already: true };
    this.db.event('file.delivered', botId, { task, path: rel, note: clean(note, 200), size: statSync(full).size });
    this.say(botId, 'system', `Delivered ${rel}${note ? `: ${note}` : ''}`, task ?? null);
    return { ok: true };
  }

  // ---- crewd's own clock: routines, timeouts, idle desktops ----
  private tick() {
    try {
      this.schedule();
      for (const task of this.db.all("SELECT * FROM tasks WHERE state IN ('working', 'needs_you') AND created_at < ?", Date.now() - TASK_TIMEOUT_MS)) {
        void this.live.get(task.bot)?.session.abort();
        this.close(task.bot);
        this.setTask(task, 'failed', 'Took longer than an hour, so I stopped it.');
      }
      this.desktops.sweep((bot) => !!this.activeTask(bot) || this.held.has(bot));
      if (Date.now() - this.freshAt > 30 * 60_000) {
        this.freshAt = Date.now();
        const members = this.members().map((m) => m.id);
        void this.accounts.keepFresh(members).catch((e) => console.error('keep fresh', e));
        void this.connections.keepFresh(members).catch((e) => console.error('keep fresh', e));
      }
    } catch (e) { console.error('tick', e); }
    this.dispatch();
  }

  // ---- the bot's screen: watch, take over, give back ----
  /** One signaling request from a watching screen. Watching starts the bot's desktop if it is resting. */
  async desktopSignal(botId: string, watcher: Watcher, method: string, params: Row) {
    const bot = this.bot(botId);
    if (!bot) throw fail('no such bot', 404);
    if (method === 'session.open') {
      if (!disk.canUse(this.cfg, botId, 'computer')) throw Object.assign(new Error(`${bot.display} has no computer; grant it on the Tools tab`), { code: 'no-screen' });
      await this.desktops.ensure(botId, bot.n, disk.botDir(this.cfg, botId));
    }
    return this.desktops.signal(botId, watcher, method, params, this.held.has(botId));
  }

  /** The person takes the controls: the bot stops where it is, and its tool calls are refused until Give back. */
  async takeOver(botId: string) {
    const bot = this.bot(botId);
    if (!bot) throw fail('no such bot', 404);
    if (this.held.has(botId)) return;
    this.held.add(botId);
    const task = this.activeTask(botId);
    this.db.tx(() => {
      this.db.event('desktop.takeover', botId, { task: task?.id ?? null });
      if (task) this.say(botId, 'system', `You have the controls. ${bot.display} is paused until you give them back.`, task.id);
    });
    await this.live.get(botId)?.session.abort();
  }

  /** The person hands the controls back; the bot resumes its task with a note of what they did. */
  async giveBack(botId: string, note = '') {
    const bot = this.bot(botId);
    if (!bot) throw fail('no such bot', 404);
    if (!this.held.delete(botId)) throw fail(`${bot.display} already has the controls`, 409);
    await this.desktops.revokeControl(botId);
    const did = clean(note, 500);
    const task = this.activeTask(botId);
    this.db.tx(() => {
      this.db.event('desktop.giveback', botId, { task: task?.id ?? null, note: did });
      if (task) this.say(botId, 'system', `You gave the controls back${did ? `: ${did}` : '.'}`, task.id);
    });
    const l = this.live.get(botId);
    if (task && l) {
      const who = this.called(task.member ?? OWNER).replace(/^the/, 'The');
      this.turn(botId, l, `[Crewhouse] ${who} took the controls of your screen and has given them back. ` +
        `${did ? `What they did: ${did}. ` : 'They left no note. '}Look at your screen again before you carry on with task #${task.id}.`);
    } else this.dispatch();
  }

  async resetBot(id: string, why = 'Stopped by you.') {
    this.held.delete(id);
    await this.desktops.revokeControl(id);
    this.close(id);
    this.db.tx(() => {
      for (const t of this.db.all("SELECT * FROM tasks WHERE bot = ? AND state IN ('working', 'needs_you')", id)) this.setTask(t, 'failed', why);
      this.db.run("UPDATE asks SET state = 'withdrawn' WHERE bot = ? AND state = 'open'", id);
      this.db.run("UPDATE bots SET state = 'off' WHERE id = ?", id);
    });
  }

  /** The engine session a bot is working in, for tests. */
  sessionOf(botId: string) { return this.live.get(botId)?.session; }
}
