import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { CHIEF, type Config } from './config.ts';
import type { Row, Store } from './db.ts';
import type { RunState, Runner } from './runner.ts';
import * as disk from './bots.ts';
import { Desktops, missing as desktopMissing, type Watcher } from './desktop.ts';

const HOLD_MS = Number(process.env.CREWHOUSE_HOLD_MS || 180_000); // how long a CLI's permission hook waits for an answer before its own dialog shows
const FALLBACK_MS = 12_000; // settled with no Stop hook this long: take the reply from the terminal instead
const TASK_TIMEOUT_MS = 60 * 60_000;
const REST_MS = { rate_limit: 60 * 60_000, overloaded: 5 * 60_000 }; // how long an account rests when we don't know its reset time
// Best-effort limit text for CLIs without a failure hook (Codex prints this and ends the turn).
const LIMIT_TEXT = /hit your usage limit|usage limit (has been )?reached|rate limit reached/i;
/** "…try again at Sep 26th, 2026 12:15 PM." (Codex) as epoch ms, or 0. */
export function limitResetFromText(text: string) {
  const m = /try again at\s+([^.]*\d:\d\d\s*[AP]M)/i.exec(text.replace(/\s+/g, ' '));
  if (!m) return 0;
  const when = m[1].replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  const t = Date.parse(/^\d/.test(when) ? `${new Date().toDateString()} ${when}` : when);
  return t > Date.now() ? t : 0;
}

/** Reset times arrive as epoch seconds, epoch ms or ISO text. */
const resetMs = (v: unknown): number => typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' ? (Number(v) ? resetMs(Number(v)) : Date.parse(v) || 0) : 0;
export const clock = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? '' : new Date(t).toLocaleDateString('en-US', { weekday: 'short' }) + ' ') +
  new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();

const BROWSER_ACTS = /^browser_(click|type|fill_form|press_key|select_option|file_upload|drag|hover|evaluate|run_code|handle_dialog)$/;
const PAYMENT = /checkout|payment|billing|purchase|\/cart\b|\/pay\b|paypal\.|pay\.google/i;

/** The browser's "asks first" rules, as a reason to ask, or null to let the call through. */
export function browserAsk(tool: string, url: string, signedIn: string[]): string | null {
  if (!BROWSER_ACTS.test(tool)) return null;
  let host = '';
  try { host = new URL(url).hostname; } catch { /* no page yet */ }
  if (PAYMENT.test(url)) return `a checkout or payment page (${host || url})`;
  if (host && signedIn.some((d) => host === d || host.endsWith(`.${d}`))) return `${host}, a site you signed it in to`;
  return null;
}
const STUCK_MS = Number(process.env.CREWHOUSE_STUCK_MS || 180_000); // working with no news this long: show "stuck?"
/** Events that make up a bot's plain "what I did" trail. */
const TRAIL = ['task.created', 'task.working', 'task.done', 'task.failed', 'task.progress', 'run.tool', 'run.allowed', 'run.typed',
  'ask.opened', 'ask.answered', 'ask.parked', 'file.delivered', 'memory.learned', 'bot.recruited', 'bot.allowed'];

const PLAIN_TOOL: Record<string, string> = { Bash: 'run a command', Write: 'write a file', Edit: 'change a file', Read: 'read a file', WebFetch: 'open a web page', WebSearch: 'search the web' };

const partOfDay = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'afternoon' : 'evening'; };
/** Chief's first words (plan 3, section 3.13). Deterministic: no model call before we know how to address the person. */
export const chiefGreeting = () =>
  `Good ${partOfDay()}. I am Chief, of the Crewhouse, and I'm at your service.\n\n` +
  'A word on how we work. The crew works here, on this computer, even while you are away. ' +
  'We stop and ask you first before anything leaves this house, costs money or touches your own files, ' +
  "and whenever a sign-in or a fee looks off. We'd rather ask than get it wrong. " +
  'Nothing you tell us leaves this computer, apart from what the crew sends your own AI account to do the work.\n\n' +
  'Before we begin, how would you like me to address you? "Sir", "ma\'am", or by name, as you prefer.';

/** The deterministic half: people, bots, tasks, the per-bot queue, asks. Models only ever see prompts. */
export class Crew {
  private live = new Map<string, { state: RunState; promptedAt: number; sawWorking: boolean; settledAt: number; prompted: boolean; brain?: disk.Brain; text?: string }>();
  /** Tasks whose last run was cut short by a limit: the next run starts from a continuation brief. */
  private handoffs = new Map<number, { from: disk.Brain; why: string }>();
  private holds = new Map<number, (answer: string) => void>();
  /** One-time grants from answers that arrived after the hold: the retried tool call is let through once. */
  private granted = new Set<string>();
  /** "For this task" answers: rules that let a task's later calls through without asking. */
  private taskGrants = new Map<number, string[]>();
  /** When the person last answered each bot: the CLI's own dialog lingers a moment after a hook answer. */
  private answeredAt = new Map<string, number>();
  private limits = new Map<string, Row>();
  private starting = new Set<string>();
  /** The page each bot's browser is on, from its own tool results. */
  private pages = new Map<string, string>();
  private timer?: NodeJS.Timeout;
  /** Bots whose screen the person is driving: the bot is paused until they give the controls back. */
  private held = new Set<string>();
  readonly desktops: Desktops;

  private cfg: Config;
  private db: Store;
  private runner: Runner;
  private url: string;

  constructor(cfg: Config, db: Store, runner: Runner, url: string) {
    this.cfg = cfg; this.db = db; this.runner = runner; this.url = url;
    this.desktops = new Desktops(cfg.stateDir);
  }

  init() {
    this.db.tx(() => {
      if (!this.db.get('SELECT 1 FROM people WHERE id = 1')) this.db.run('INSERT INTO people (id, name, created_at) VALUES (1, ?, ?)', 'Owner', Date.now());
      if (!this.bot(CHIEF)) this.addBot(disk.loadTemplate(this.cfg, 'chief'), 'Chief', CHIEF, 'system');
      // A restart interrupts whatever was running: queue it again so it resumes.
      const n = this.db.run("UPDATE tasks SET state = 'queued', updated_at = ? WHERE state IN ('working', 'needs_you')", Date.now()).changes;
      this.db.run("UPDATE asks SET state = 'withdrawn' WHERE state = 'open'");
      this.db.run("UPDATE bots SET state = 'off'");
      this.db.event('system.started', null, { requeued: Number(n) });
    });
    const person = this.person();
    if (!person.onboarded && !this.db.get('SELECT 1 FROM messages WHERE bot = ?', CHIEF)) this.say(CHIEF, 'bot', chiefGreeting());
    for (const b of this.bots()) if (existsSync(disk.botDir(this.cfg, b.id))) disk.writePerson(this.cfg, b.id, person.address);
    this.timer = setInterval(() => this.tick().catch((e) => console.error('tick', e)), 1500);
    this.dispatch();
  }

  stop() { clearInterval(this.timer); this.desktops.stopAll(); }

  // ---- reads ----
  person(): Row { return this.db.get('SELECT * FROM people WHERE id = 1')!; }
  bot(id: string) { return this.db.get('SELECT rowid + 100 AS n, * FROM bots WHERE id = ?', id); }
  bots() { return this.db.all('SELECT * FROM bots ORDER BY created_at'); }
  byToken(token: string | undefined) {
    const b = token && this.db.get('SELECT * FROM bots WHERE token = ?', token);
    if (!b) throw Object.assign(new Error('unknown bot token'), { status: 401 });
    return b;
  }
  activeTask(bot: string) { return this.db.get("SELECT * FROM tasks WHERE bot = ? AND state IN ('working', 'needs_you') ORDER BY id LIMIT 1", bot); }

  /** 0 when the account is available; otherwise when it stops resting (a limit hit, or a window at 95% or more). */
  restingUntil(runtime: string) {
    const l = this.limits.get(runtime);
    if (!l) return 0;
    const hot = [l.fiveHour, l.sevenDay].filter((w) => w && w.used >= 95).map((w) => resetMs(w.resetsAt));
    const until = Math.max(l.restUntil ?? 0, ...hot);
    return until > Date.now() ? until : 0;
  }

  /** The models a task may run on, in order: its own choice first, then the bot's fallback order. */
  choices(task: Row) {
    return disk.dedupe([...(task.brain ? [disk.parseBrain(task.brain)] : []), ...disk.brains(this.cfg, task.bot)]);
  }

  /** What the bot page and crew cards show: "Thinks with: Claude Opus · falls back to ChatGPT". */
  thinks(id: string) {
    try {
      return disk.brains(this.cfg, id).map((b) => ({ key: disk.brainKey(b), name: disk.brainName(b), restingUntil: this.restingUntil(b.runtime) }));
    } catch { return []; } // a hand-edited bot.json with a bad model must not take the whole app down
  }

  /** A working bot's latest step and how long it has been quiet; quiet past STUCK_MS reads as "stuck?". */
  private progress(bot: string, task: Row | undefined) {
    if (!task) return { step: null, quietSince: null, stuck: false };
    const step = this.db.get(`SELECT * FROM events WHERE bot = ? AND kind IN ('run.tool', 'task.progress', 'file.delivered') AND json_extract(data, '$.task') = ? ORDER BY seq DESC LIMIT 1`, bot, task.id);
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

  snapshot() {
    const pub = ({ token, ...b }: Row) => {
      const task = this.activeTask(b.id);
      return { ...b, thinks: this.thinks(b.id), ...this.screenOf(b.id), live: this.live.get(b.id)?.state ?? 'off', task: task ?? null, ...this.progress(b.id, task),
        queued: this.db.get("SELECT COUNT(*) AS n FROM tasks WHERE bot = ? AND state = 'queued'", b.id)!.n,
        pausedUntil: this.db.get("SELECT MIN(wake_at) AS w FROM tasks WHERE bot = ? AND state = 'paused'", b.id)!.w };
    };
    const files = (task: number) => this.db.all(`SELECT data FROM events WHERE kind = 'file.delivered' AND json_extract(data, '$.task') = ?`, task).map((e) => JSON.parse(e.data).path);
    return {
      person: this.person(),
      bots: this.bots().map(pub),
      templates: disk.listTemplates(this.cfg).map((t) => ({ ...t, kit: disk.templateKit(this.cfg, t) })),
      tasks: this.db.all('SELECT * FROM tasks WHERE bot != ? ORDER BY id DESC LIMIT 50', CHIEF).map((t) => ({ ...t, files: t.state === 'done' ? files(t.id) : [] })),
      ideas: this.ideas(),
      asks: this.db.all("SELECT * FROM asks WHERE state = 'open' ORDER BY id").map((a) => ({ ...a, detail: JSON.parse(a.detail || '{}') })),
      events: this.db.events(0, 80),
      limits: Object.fromEntries(this.limits),
      resting: Object.fromEntries(Object.keys(disk.RUNTIMES).map((r) => [r, this.restingUntil(r)])),
      desktops: { missing: desktopMissing() },
    };
  }

  botPage(id: string) {
    const b = this.bot(id);
    if (!b) throw Object.assign(new Error('no such bot'), { status: 404 });
    const { token, ...bot } = b;
    return {
      bot: { ...bot, thinks: this.thinks(id), ...this.screenOf(id), live: this.live.get(id)?.state ?? 'off' },
      messages: this.db.all('SELECT * FROM (SELECT * FROM messages WHERE bot = ? ORDER BY id DESC LIMIT 200) ORDER BY id', id),
      tasks: this.db.all('SELECT * FROM tasks WHERE bot = ? ORDER BY id DESC LIMIT 50', id),
      notes: disk.readNotes(this.cfg, id),
      notesCap: disk.NOTES_CAP,
      skills: disk.listSkills(this.cfg, id),
      tools: disk.botTools(this.cfg, id),
      files: disk.listFiles(this.cfg, id),
      trail: this.db.all(`SELECT * FROM events WHERE bot = ? AND kind IN (${TRAIL.map(() => '?').join(', ')}) ORDER BY seq DESC LIMIT 300`, id, ...TRAIL)
        .map((e) => ({ ...e, data: JSON.parse(e.data) })),
      allow: disk.botConfig(this.cfg, id).allow ?? [],
      memory: disk.botConfig(this.cfg, id).memory !== false,
      folder: disk.botDir(this.cfg, id),
    };
  }

  private screenOf(id: string) {
    return { controls: this.held.has(id) ? 'person' : 'bot', desktop: this.desktops.info(id), computer: disk.canUse(this.cfg, id, 'computer') };
  }

  // ---- people ----
  /** First meeting: the person tells Chief how to be addressed. Stored per person, used by every bot. */
  onboard(address: string) {
    const a = address.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!a) throw Object.assign(new Error('say how Chief should address you'), { status: 400 });
    this.db.tx(() => {
      this.db.run('UPDATE people SET address = ?, onboarded = 1 WHERE id = 1', a);
      this.say(CHIEF, 'person', a);
      this.say(CHIEF, 'bot', `Very good, ${a}. The whole crew will know it. ` +
        'Tell me what needs doing and I shall see it into the right hands. The crew is empty for now; I can recruit ' +
        'Reel for demo videos, Scout for research, Scribe for drafts, or Tracer for leads, whenever you wish.');
      this.db.event('person.onboarded', null, { address: a });
    });
    for (const b of this.bots()) disk.writePerson(this.cfg, b.id, a);
  }

  // ---- crew ----
  private addBot(tpl: disk.Template, display: string, id: string, by: string) {
    disk.createBotFolder(this.cfg, id, tpl, display);
    disk.writePerson(this.cfg, id, this.person()?.address ?? null);
    this.db.run('INSERT INTO bots (id, display, role, template, runtime, model, color, token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, display, tpl.role, tpl.id, tpl.runtime || this.cfg.runtime, tpl.model ?? null, tpl.color, randomBytes(16).toString('hex'), Date.now());
    this.db.event('bot.recruited', id, { display, template: tpl.id, by });
  }

  recruit(template: string, name: string | undefined, by: string) {
    const tpl = disk.loadTemplate(this.cfg, template);
    if (template === 'chief') throw Object.assign(new Error('there is only one Chief'), { status: 400 });
    const display = (name || tpl.display).trim().slice(0, 32);
    const id = disk.slug(display);
    if (this.bot(id) || id === CHIEF) throw Object.assign(new Error(`there is already a bot called ${display}`), { status: 409 });
    this.db.tx(() => {
      this.addBot(tpl, display, id, by);
      this.say(id, 'system', `${display} joined the crew (${tpl.role.toLowerCase()}).`);
    });
    return this.bot(id)!;
  }

  // ---- work ----
  say(bot: string, author: string, text: string, taskId: number | null = null) {
    const r = this.db.run('INSERT INTO messages (bot, author, text, task_id, at) VALUES (?, ?, ?, ?, ?)', bot, author, text, taskId, Date.now());
    this.db.event('message', bot, { id: Number(r.lastInsertRowid), author, text: text.slice(0, 280) });
  }

  /** A person's message in a bot's thread is a task for that bot; Chief's thread is a task for Chief. */
  post(botId: string, text: string, model?: string) {
    const bot = this.bot(botId);
    if (!bot) throw Object.assign(new Error('no such bot'), { status: 404 });
    if (!text.trim()) throw Object.assign(new Error('empty message'), { status: 400 });
    if (botId === CHIEF && !this.person().onboarded) return this.onboard(text);
    return this.addTask(botId, text.trim(), 'person', model);
  }

  /** `model` picks the CLI and model for this one task (a cheap one for bulk steps, a strong one for judgment). */
  assign(botId: string, text: string, by: string, model?: string) {
    if (!this.bot(botId)) throw Object.assign(new Error(`no bot called ${botId}; see crew roster`), { status: 404 });
    if (botId === CHIEF) throw Object.assign(new Error('Chief cannot assign to himself'), { status: 400 });
    return this.addTask(botId, text.trim(), by, model);
  }

  private addTask(bot: string, body: string, origin: string, model?: string) {
    const brain = model ? disk.brainKey(disk.parseBrain(model)) : null;
    const id = this.db.tx(() => {
      const now = Date.now();
      const r = this.db.run('INSERT INTO tasks (bot, title, body, origin, state, created_at, updated_at, brain) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        bot, body.split('\n')[0].slice(0, 80), body, origin, 'queued', now, now, brain);
      const id = Number(r.lastInsertRowid);
      this.say(bot, origin === 'person' ? 'person' : origin, body, id);
      this.db.event('task.created', bot, { task: id, origin, title: body.slice(0, 80) });
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
    const person = this.person();
    const who = task.origin === 'person' ? (person.address || 'the person') : task.origin === CHIEF ? 'Chief' : task.origin;
    if (task.bot !== CHIEF) return `[Crewhouse task #${task.id} from ${who}]\n${task.body}`;
    const crew = this.bots().filter((b) => b.id !== CHIEF)
      .map((b) => `${b.display} (id ${b.id}, ${b.template}, ${this.activeTask(b.id) ? 'busy' : 'free'})`).join('; ') || 'nobody yet';
    const tpls = disk.listTemplates(this.cfg).map((t) => `${t.id}: ${t.role}`).join('; ');
    return `[Crewhouse] ${disk.addressLine(person.address)} Crew: ${crew}. Templates: ${tpls}.\n` +
      `The person says: ${task.body}`;
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
      this.run(t);
    }
  }

  private async run(task: Row) {
    const bot = this.bot(task.bot)!;
    this.starting.add(bot.id);
    try {
      const choices = this.choices(task);
      const brain = choices.find((b) => !this.restingUntil(b.runtime));
      if (!brain) return this.pause(task, choices);
      this.setTask(task, 'working');
      // A bot switching models gets a new session on the new CLI; the folder, notes and files carry over.
      const running = this.live.get(bot.id)?.brain ?? { runtime: bot.runtime, model: bot.model ?? undefined };
      if (disk.brainKey(running) !== disk.brainKey(brain)) { await this.runner.stop(bot.id); this.live.delete(bot.id); }
      const fresh = (await this.runner.state(bot.id)) === 'off';
      this.db.run('UPDATE bots SET runtime = ?, model = ? WHERE id = ?', brain.runtime, brain.model ?? null, bot.id);
      // A bot with a computer gets its own display before its CLI starts, so DISPLAY points at it from the first turn.
      // The stub runner has no CLI to hand a screen to.
      if (this.cfg.runner === 'herdr' && disk.canUse(this.cfg, bot.id, 'computer')) await this.desktops.ensure(bot.id, bot.n, disk.botDir(this.cfg, bot.id));
      await this.runner.start(disk.launchSpec(this.cfg, { ...bot, runtime: brain.runtime, model: brain.model } as any, this.url));
      this.db.run("UPDATE bots SET state = 'on' WHERE id = ?", bot.id);
      this.db.event('run.started', bot.id, { task: task.id, brain: disk.brainKey(brain), name: disk.brainName(brain) });
      const handoff = this.handoffs.get(task.id);
      this.handoffs.delete(task.id);
      if (handoff) {
        const same = handoff.from.runtime === brain.runtime;
        this.say(bot.id, 'system', same ? `Back on ${disk.brainName(brain)}, continuing where it left off.`
          : `Switched from ${disk.RUNTIMES[handoff.from.runtime]} to ${disk.RUNTIMES[brain.runtime]}: ${handoff.why}.`, task.id);
      }
      let text = handoff ? this.brief(task, handoff.why) : this.prompt(task);
      // Claude loads notes and the person through CLAUDE.md imports; other CLIs are told at the start of a session.
      if (fresh && brain.runtime !== 'claude') text = this.memory(bot.id) + text;
      const st = await this.runner.state(bot.id);
      this.live.set(bot.id, { state: st, promptedAt: Date.now(), sawWorking: false, settledAt: 0, prompted: false, brain, text });
      // A CLI stuck at a first-run dialog is prompted later, once the person has answered it (see tick).
      if (st === 'idle' || st === 'done') await this.submit(task, text);
    } catch (e: any) {
      this.setTask(task, 'failed', `Could not start ${bot.display}: ${e.message}`);
      this.say(bot.id, 'system', `I couldn't start ${bot.display}'s ${bot.runtime}: ${e.message}`, task.id);
    } finally {
      this.starting.delete(bot.id);
      this.dispatch();
    }
  }

  /** Every account this task could use is resting: wait for the earliest reset. */
  private pause(task: Row, choices: disk.Brain[]) {
    const wake = Math.min(...choices.map((b) => this.restingUntil(b.runtime)));
    const why = `All AI accounts are resting until ${clock(wake)}`;
    this.db.tx(() => {
      this.db.run('UPDATE tasks SET wake_at = ? WHERE id = ?', wake, task.id);
      this.setTask(task, 'paused', `${why}.`);
      this.say(task.bot, 'system', `${why}. I'll pick this up then.`, task.id);
    });
  }

  /** Mark an account resting until its known reset, or for a while when we don't know it. */
  private rest(runtime: string, error: keyof typeof REST_MS, known = 0) {
    const l = this.limits.get(runtime) ?? {};
    const w = error === 'rate_limit' && [l.fiveHour, l.sevenDay].filter((w) => w && resetMs(w.resetsAt) > Date.now()).sort((a, b) => b.used - a.used)[0];
    const until = known || (w ? resetMs(w.resetsAt) : Date.now() + REST_MS[error]);
    this.limits.set(runtime, { ...l, restUntil: until });
    this.db.event('account.resting', null, { runtime, until, error });
    return until;
  }

  /** A limit or overload ended the run: rest that account and continue the task on the next model, in a new session. */
  async failover(botId: string, error: 'rate_limit' | 'overloaded', known = 0) {
    const task = this.activeTask(botId);
    const from = this.live.get(botId)?.brain;
    if (!task || !from) return;
    const until = this.rest(from.runtime, error, known);
    const who = disk.RUNTIMES[from.runtime];
    this.handoffs.set(task.id, { from, why: error === 'rate_limit' ? `${who} is resting until ${clock(until)}` : `${who} is overloaded right now` });
    // The old session is at a dead end (Codex even leaves a dialog up), so it ends; the next run starts clean.
    this.starting.add(botId);
    try { await this.runner.stop(botId).catch(() => {}); } finally { this.starting.delete(botId); }
    this.live.delete(botId);
    this.db.tx(() => {
      this.db.run("UPDATE asks SET state = 'withdrawn' WHERE bot = ? AND state = 'open'", botId);
      this.db.run("UPDATE bots SET state = 'off' WHERE id = ?", botId);
      this.setTask(task, 'queued');
    });
    this.dispatch();
  }

  /** CLIs without a failure hook print their limit and end the turn (Codex also opens a model-switch dialog). */
  private limitInPane(l: { brain?: disk.Brain }, pane: string) {
    if (!l.brain || l.brain.runtime === 'claude') return null;
    const tail = pane.trim().split('\n').slice(-20).join('\n');
    return LIMIT_TEXT.test(tail) ? { until: limitResetFromText(tail) } : null;
  }

  /** Claude's StopFailure hook: the turn ended on an API error instead of an answer. */
  hookFailure(botId: string, payload: Row) {
    const error = String(payload.error ?? 'unknown');
    const text = String(payload.last_assistant_message ?? '').slice(0, 200);
    this.db.event('run.error', botId, { error, text });
    if (error === 'rate_limit' || error === 'overloaded') return this.failover(botId, error);
    const task = this.activeTask(botId);
    if (task) this.setTask(task, 'failed', `Stopped on an error from ${this.bot(botId)!.runtime}: ${text || error}. Try again.`);
  }

  /** The continuation brief: a new session continues the work, so it is told the goal and what already happened. */
  private brief(task: Row, why: string) {
    const trail = this.db.all("SELECT kind, data FROM events WHERE bot = ? AND kind IN ('task.progress', 'file.delivered') AND at >= ? ORDER BY seq", task.bot, task.created_at)
      .map((e) => { const d = JSON.parse(e.data); return `- ${e.kind === 'file.delivered' ? `delivered ${d.path}` : d.text}`; });
    const last = this.db.all('SELECT author, text FROM messages WHERE task_id = ? AND author != ? ORDER BY id DESC LIMIT 3', task.id, 'system')
      .reverse().map((m) => `${m.author}: ${String(m.text).slice(0, 600)}`);
    return `${this.prompt(task)}\n\n[Crewhouse] A previous session started this task and stopped (${why}). You are continuing it in a new session. ` +
      'Anything it made is still in your folder; check files/ and work/ before redoing work.' +
      (trail.length ? `\nProgress so far:\n${trail.join('\n')}` : '') + (last.length ? `\nLast messages:\n${last.join('\n')}` : '');
  }

  private memory(id: string) {
    const notes = disk.readNotes(this.cfg, id).trim();
    return `[Crewhouse] ${disk.addressLine(this.person().address)}${notes ? `\nYour notes (notes.md):\n${notes}` : ''}\n\n`;
  }

  private async submit(task: Row, text: string) {
    const l = this.live.get(task.bot)!;
    Object.assign(l, { prompted: true, promptedAt: Date.now(), sawWorking: false, settledAt: 0 });
    await this.runner.prompt(task.bot, text);
    this.db.event('run.prompted', task.bot, { task: task.id });
  }

  /** A turn finished (Claude Stop hook, Codex notify, stub, or the terminal fallback). */
  finish(botId: string, reply: string) {
    const task = this.activeTask(botId);
    const text = reply.trim() || '(no reply)';
    // A turn that ended on a parked question isn't the end of the task: it resumes when the person answers.
    const parked = task && this.db.get("SELECT 1 FROM asks WHERE task_id = ? AND state = 'open' AND kind = 'permission'", task.id);
    this.db.tx(() => {
      this.say(botId, 'bot', text, task?.id ?? null);
      // While the person holds the controls the turn was cut short on purpose; Give back resumes it.
      if (!task || parked || this.held.has(botId)) return;
      this.setTask(task, 'done', text);
      if (task.origin === CHIEF) {
        const b = this.bot(botId)!;
        this.say(CHIEF, 'system', `${b.display} has finished task #${task.id}: ${text.slice(0, 240)}${text.length > 240 ? '…' : ''}`);
      }
      this.db.run("UPDATE asks SET state = 'withdrawn' WHERE bot = ? AND state = 'open' AND kind IN ('blocked', 'trust')", botId);
    });
    const l = this.live.get(botId);
    if (l) Object.assign(l, { state: 'done', sawWorking: false });
    this.dispatch();
  }

  // ---- asks ----
  private openAsk(bot: string, task: Row | undefined, kind: string, title: string, detail: Row) {
    return this.db.tx(() => {
      const r = this.db.run('INSERT INTO asks (bot, task_id, kind, title, detail, at) VALUES (?, ?, ?, ?, ?, ?)', bot, task?.id ?? null, kind, title, JSON.stringify(detail), Date.now());
      if (task) this.setTask(task, 'needs_you');
      this.db.event('ask.opened', bot, { ask: Number(r.lastInsertRowid), task: task?.id, kind, title, ...detail, pane: undefined });
      return Number(r.lastInsertRowid);
    });
  }

  /** Claude's PermissionRequest hook: hold the tool call while the person decides; after the hold, deny and park. */
  async permission(botId: string, payload: Row, why?: string): Promise<{ behavior: 'allow' | 'deny'; message?: string }> {
    const task = this.activeTask(botId);
    const input = payload.tool_input ?? {};
    const summary = (why ?? String(input.command ?? input.file_path ?? input.url ?? JSON.stringify(input))).slice(0, 300);
    const key = `${botId}\n${payload.tool_name}\n${summary}`;
    if (this.granted.delete(key)) return { behavior: 'allow' }; // answered "allow" after the hold expired
    // Standing answers: "For this task" and "Always for <bot>". crewd decides, not the bot's own words.
    // Money and the browser's own asks-first rules reach the person every time.
    const spends = disk.mustAsk(this.cfg, botId, payload.tool_name, input);
    const { rule, covers } = disk.permissionRule(payload.tool_name, input);
    const standing = [...(task && this.taskGrants.get(task.id) || []), ...(disk.botConfig(this.cfg, botId).allow ?? [])];
    const by = !spends && !why && standing.find((r) => disk.ruleAllows(r, payload.tool_name, input));
    if (by) {
      this.db.event('run.allowed', botId, { task: task?.id, tool: payload.tool_name, summary, rule: by });
      return { behavior: 'allow' };
    }
    const b = this.bot(botId)!;
    const askId = this.openAsk(botId, task, 'permission', `${b.display} would like to ${PLAIN_TOOL[payload.tool_name] ?? (payload.tool_name.startsWith('mcp__browser__') ? 'act in its browser' : `use ${payload.tool_name}`)}`,
      spends ? { tool: payload.tool_name, summary, spends } : why ? { tool: payload.tool_name, summary } : { tool: payload.tool_name, summary, rule, covers });
    const answer = await new Promise<string | null>((resolve) => {
      const t = setTimeout(() => { this.holds.delete(askId); resolve(null); }, HOLD_MS);
      this.holds.set(askId, (a) => { clearTimeout(t); resolve(a); });
    });
    if (answer === null) {
      this.db.event('ask.parked', botId, { ask: askId, task: task?.id });
      return { behavior: 'deny', message: "The owner hasn't answered yet; stop here and wait. You'll be told when they answer." };
    }
    if (task) this.setTask(this.db.get('SELECT * FROM tasks WHERE id = ?', task.id)!, 'working');
    return answer === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'The person said no. Continue without it, or explain what you need.' };
  }

  async answer(askId: number, body: { answer?: string; scope?: string; keys?: string[]; text?: string }) {
    const ask = this.db.get("SELECT * FROM asks WHERE id = ? AND state = 'open'", askId);
    if (!ask) throw Object.assign(new Error('that question is already settled'), { status: 409 });
    const detail = JSON.parse(ask.detail || '{}');
    const scope = body.answer === 'allow' ? body.scope ?? 'once' : 'once';
    if (!['once', 'task', 'always'].includes(scope) || (scope !== 'once' && (ask.kind !== 'permission' || !detail.rule)) || (scope === 'task' && !ask.task_id)) {
      throw Object.assign(new Error('allow once, for this task, or always'), { status: 400 });
    }
    const who = this.bot(ask.bot)?.display ?? ask.bot;
    const shown = scope === 'task' ? 'allowed for this task' : scope === 'always' ? `always allowed for ${who}` : body.answer ?? body.text ?? body.keys?.join(' ') ?? '';
    const held = this.holds.get(askId);
    this.answeredAt.set(ask.bot, Date.now());
    if (ask.kind === 'permission' || ask.kind === 'trust') {
      if (!['allow', 'deny'].includes(body.answer ?? '')) throw Object.assign(new Error('answer allow or deny'), { status: 400 });
    }
    if (ask.kind === 'trust') {
      if (body.answer === 'allow') await this.runner.keys(ask.bot, ['enter']);
    } else if (ask.kind !== 'permission') {
      if (body.text) await this.runner.text(ask.bot, body.text);
      else if (body.keys?.length) await this.runner.keys(ask.bot, body.keys);
      else throw Object.assign(new Error('nothing to send'), { status: 400 });
    }
    this.db.tx(() => {
      this.db.run("UPDATE asks SET state = 'answered', answer = ?, answered_at = ? WHERE id = ?", shown, Date.now(), askId);
      this.db.event('ask.answered', ask.bot, { ask: askId, task: ask.task_id, answer: shown });
      if (scope === 'task') this.taskGrants.set(ask.task_id, [...(this.taskGrants.get(ask.task_id) ?? []), detail.rule]);
      if (scope === 'always') {
        disk.setSettings(this.cfg, ask.bot, { allow: [...(disk.botConfig(this.cfg, ask.bot).allow ?? []), detail.rule] });
        this.db.event('bot.allowed', ask.bot, { rule: detail.rule, covers: detail.covers });
      }
      const task = ask.task_id && this.db.get("SELECT * FROM tasks WHERE id = ? AND state = 'needs_you'", ask.task_id);
      if (task && !held && !(ask.kind === 'trust' && body.answer === 'deny')) this.setTask(task, 'working');
    });
    if (held) { held(body.answer!); this.holds.delete(askId); return; }
    if (ask.kind === 'trust' && body.answer === 'deny') return this.resetBot(ask.bot, 'You chose not to trust the folder.');
    if (ask.kind === 'permission' && ask.task_id) {
      // Parked: the turn already ended with a "wait" denial, so the answer is the next prompt into the same session.
      if (body.answer === 'allow') this.granted.add(`${ask.bot}\n${detail.tool}\n${detail.summary}`);
      const task = this.db.get('SELECT * FROM tasks WHERE id = ?', ask.task_id)!;
      await this.submit(task, `[Crewhouse] ${this.person().address || 'The person'} has answered your request to use ${detail.tool} (${detail.summary}): ` +
        (body.answer === 'allow' ? 'allowed. Go ahead and continue the task.' : 'not allowed. Continue without it, or explain what you need.'));
    }
  }

  // ---- other hook facts ----
  hookSession(botId: string, payload: Row) {
    if (payload.session_id) this.db.run('UPDATE bots SET session = ? WHERE id = ?', String(payload.session_id), botId);
  }

  /** PreToolUse for the browser: act on a signed-in site or a payment page only after the person says yes. */
  async browserGate(botId: string, payload: Row) {
    const tool = String(payload.tool_name ?? '').replace(/^mcp__browser__/, '');
    const url = this.pages.get(botId) ?? '';
    const why = browserAsk(tool, url, disk.botConfig(this.cfg, botId).signedIn ?? []);
    if (!why) return {};
    const d = await this.permission(botId, payload, `${tool.replace('browser_', '')} on ${why}: ${url}`);
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.behavior, permissionDecisionReason: d.message ?? 'The person allowed it.' } };
  }

  hookTool(botId: string, payload: Row) {
    const i = payload.tool_input ?? {};
    if (String(payload.tool_name).startsWith('mcp__browser__')) {
      const page = /Page URL: (\S+?)(?:\\n|\s|"|$)/.exec(JSON.stringify(payload.tool_response ?? ''))?.[1] ?? i.url;
      if (page) this.pages.set(botId, page);
    }
    const summary = String(i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.query ?? '').split('\n')[0].slice(0, 120);
    this.db.event('run.tool', botId, { task: this.activeTask(botId)?.id, tool: payload.tool_name, summary });
  }

  /** Claude's statusline carries the account's usage windows on every refresh; record them when they move. */
  hookStatus(botId: string, payload: Row) {
    const rl = payload.rate_limits ?? {};
    const pick = (w: Row | undefined) => w && { used: Math.round(Number(w.used_percentage ?? w.utilization ?? 0)), resetsAt: w.resets_at ?? w.resetsAt ?? null };
    const now = { fiveHour: pick(rl.five_hour), sevenDay: pick(rl.seven_day), at: Date.now() };
    const prev = this.limits.get('claude');
    if (now.fiveHour || now.sevenDay) {
      if (JSON.stringify([prev?.fiveHour, prev?.sevenDay]) !== JSON.stringify([now.fiveHour, now.sevenDay])) this.db.event('account.limit', botId, { runtime: 'claude', ...now });
      this.limits.set('claude', { ...prev, ...now });
    }
    const b = this.bot(botId)!;
    return `Crewhouse · ${b.display}${now.fiveHour ? ` · 5h ${now.fiveHour.used}%` : ''}`;
  }

  setAddress(address: string) {
    const a = address.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!a) throw Object.assign(new Error('say how to address them'), { status: 400 });
    this.db.run('UPDATE people SET address = ?, onboarded = 1 WHERE id = 1', a);
    this.db.event('person.onboarded', null, { address: a });
    for (const b of this.bots()) disk.writePerson(this.cfg, b.id, a);
  }

  screen(botId: string) { return this.runner.screen(botId); }

  /** Take over: the person types into the bot's terminal, or presses a key such as Esc. */
  async type(botId: string, body: { text?: string; keys?: string[] }) {
    if (!this.bot(botId)) throw Object.assign(new Error('no such bot'), { status: 404 });
    if (body.text?.trim()) await this.runner.text(botId, body.text);
    else if (body.keys?.length) await this.runner.keys(botId, body.keys);
    else throw Object.assign(new Error('nothing to send'), { status: 400 });
    this.db.event('run.typed', botId, { task: this.activeTask(botId)?.id, what: body.text ? 'text' : body.keys!.join(' ') });
  }

  // ---- the watch loop: Herdr's lifecycle is the fallback truth when no hook speaks ----
  private ticking = false;
  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const task of this.db.all("SELECT * FROM tasks WHERE state IN ('working', 'needs_you')")) {
        if (this.starting.has(task.bot) || this.held.has(task.bot)) continue;
        const st = await this.runner.state(task.bot).catch(() => 'unknown' as RunState);
        const l = this.live.get(task.bot) ?? { state: st, promptedAt: Date.now(), sawWorking: false, settledAt: 0, prompted: true };
        if (st !== l.state) this.db.event('run.state', task.bot, { state: st, task: task.id });
        l.state = st;
        this.live.set(task.bot, l);
        if (st === 'working' || st === 'blocked') { l.sawWorking = true; l.settledAt = 0; }
        const settling = Date.now() - (this.answeredAt.get(task.bot) ?? 0) < 4000;
        if (st === 'blocked' && !settling && !this.db.get("SELECT 1 FROM asks WHERE bot = ? AND state = 'open'", task.bot)) {
          const pane = (await this.runner.read(task.bot, 40).catch(() => '')).split('\n').slice(-30).join('\n');
          const limit = this.limitInPane(l, pane);
          if (limit) { await this.failover(task.bot, 'rate_limit', limit.until); continue; }
          const b = this.bot(task.bot)!;
          // Before the first prompt, a blocked CLI is showing a first-run dialog: the person decides, crewd sends the key.
          if (!l.prompted && /trust/i.test(pane)) this.openAsk(task.bot, task, 'trust', `Trust ${b.display}'s folder?`, { pane, note: `${b.display}'s ${b.runtime} asks whether to trust its own folder, ${disk.botDir(this.cfg, b.id)}.` });
          else this.openAsk(task.bot, task, 'blocked', `${b.display} is waiting on a question in its terminal`, { pane });
        }
        if (st === 'idle' || st === 'done') {
          this.db.run("UPDATE asks SET state = 'withdrawn' WHERE bot = ? AND state = 'open' AND kind IN ('blocked', 'trust')", task.bot);
          if (!l.prompted) { if (task.state === 'needs_you') this.setTask(task, 'working'); await this.submit(task, l.text ?? this.prompt(task)); continue; }
          if (!l.settledAt) l.settledAt = Date.now();
          const parked = this.db.get("SELECT 1 FROM asks WHERE task_id = ? AND state = 'open'", task.id);
          if (l.sawWorking && !parked && Date.now() - l.settledAt > FALLBACK_MS) {
            const pane = await this.runner.read(task.bot, 60).catch(() => '');
            const limit = this.limitInPane(l, pane);
            if (limit) { await this.failover(task.bot, 'rate_limit', limit.until); continue; }
            this.finish(task.bot, `(read from the terminal)\n${pane.trim().split('\n').slice(-25).join('\n')}`);
          }
        }
        if (st === 'off' && Date.now() - l.promptedAt > 5000) {
          this.setTask(task, 'failed', 'The CLI exited. Try again.');
          this.db.run("UPDATE bots SET state = 'off' WHERE id = ?", task.bot);
        }
        if (Date.now() - task.created_at > TASK_TIMEOUT_MS) {
          await this.runner.interrupt(task.bot).catch(() => {});
          this.setTask(task, 'failed', 'Took longer than an hour, so I stopped it.');
        }
      }
      this.desktops.sweep((bot) => !!this.activeTask(bot) || this.held.has(bot));
    } finally {
      this.ticking = false;
    }
    this.dispatch();
  }

  // ---- the bot's screen: watch, take over, give back ----
  /** One signaling request from a watching screen. Watching starts the bot's desktop if it is resting. */
  async desktopSignal(botId: string, watcher: Watcher, method: string, params: Row) {
    const bot = this.bot(botId);
    if (!bot) throw Object.assign(new Error('no such bot'), { status: 404 });
    if (method === 'session.open') {
      if (!disk.canUse(this.cfg, botId, 'computer')) throw Object.assign(new Error(`${bot.display} has no computer; grant it on the Tools tab`), { code: 'no-screen' });
      await this.desktops.ensure(botId, bot.n, disk.botDir(this.cfg, botId));
    }
    return this.desktops.signal(botId, watcher, method, params, this.held.has(botId));
  }

  /** The person takes the controls: the bot stops where it is, and its tool calls are refused until Give back. */
  async takeOver(botId: string) {
    const bot = this.bot(botId);
    if (!bot) throw Object.assign(new Error('no such bot'), { status: 404 });
    if (this.held.has(botId)) return;
    this.held.add(botId);
    const task = this.activeTask(botId);
    this.db.tx(() => {
      this.db.event('desktop.takeover', botId, { task: task?.id ?? null });
      if (task) this.say(botId, 'system', `You have the controls. ${bot.display} is paused until you give them back.`, task.id);
    });
    if ((await this.runner.state(botId).catch(() => 'off')) === 'working') await this.runner.interrupt(botId).catch(() => {});
  }

  /** The person hands the controls back; the bot resumes its task with a note of what they did. */
  async giveBack(botId: string, note = '') {
    const bot = this.bot(botId);
    if (!bot) throw Object.assign(new Error('no such bot'), { status: 404 });
    if (!this.held.delete(botId)) throw Object.assign(new Error(`${bot.display} already has the controls`), { status: 409 });
    await this.desktops.revokeControl(botId);
    const did = note.replace(/\s+/g, ' ').trim().slice(0, 500);
    const task = this.activeTask(botId);
    this.db.tx(() => {
      this.db.event('desktop.giveback', botId, { task: task?.id ?? null, note: did });
      if (task) this.say(botId, 'system', `You gave the controls back${did ? `: ${did}` : '.'}`, task.id);
    });
    if (task && this.live.has(botId)) {
      const who = this.person().address || 'The person';
      await this.submit(task, `[Crewhouse] ${who} took the controls of your screen and has given them back. ` +
        `${did ? `What they did: ${did}. ` : 'They left no note. '}Look at your screen again before you carry on with task #${task.id}.`);
    } else this.dispatch();
  }

  /** Claude's PreToolUse hook: nothing while the person drives the bot's screen; then the browser's asks-first rules. */
  async preTool(botId: string, payload: Row = {}) {
    if (!this.held.has(botId)) return String(payload.tool_name ?? '').startsWith('mcp__browser__') ? this.browserGate(botId, payload) : {};
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'The owner has the controls of your screen; wait. You will be told when they give them back.' } };
  }

  async resetBot(id: string, why = 'Stopped by you.') {
    this.held.delete(id);
    await this.desktops.revokeControl(id);
    await this.runner.stop(id);
    this.live.delete(id);
    this.db.tx(() => {
      for (const t of this.db.all("SELECT * FROM tasks WHERE bot = ? AND state IN ('working', 'needs_you')", id)) this.setTask(t, 'failed', why);
      this.db.run("UPDATE asks SET state = 'withdrawn' WHERE bot = ? AND state = 'open'", id);
      this.db.run("UPDATE bots SET state = 'off' WHERE id = ?", id);
    });
  }
}
