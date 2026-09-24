import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { CHIEF, type Config } from './config.ts';
import type { Row, Store } from './db.ts';
import type { RunState, Runner } from './runner.ts';
import * as disk from './bots.ts';

const HOLD_MS = Number(process.env.CREWHOUSE_HOLD_MS || 180_000); // how long a CLI's permission hook waits for an answer before its own dialog shows
const FALLBACK_MS = 12_000; // settled with no Stop hook this long: take the reply from the terminal instead
const TASK_TIMEOUT_MS = 60 * 60_000;

const partOfDay = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'afternoon' : 'evening'; };
/** Chief's first words (plan 3, section 3.13). Deterministic: no model call before we know how to address the person. */
export const chiefGreeting = () =>
  `Good ${partOfDay()}. I am Chief, of the Crewhouse, and I'm at your service. ` +
  'Before we begin, how would you like me to address you? "Sir", "ma\'am", or by name, as you prefer.';

/** The deterministic half: people, bots, tasks, the per-bot queue, asks. Models only ever see prompts. */
export class Crew {
  private live = new Map<string, { state: RunState; promptedAt: number; sawWorking: boolean; settledAt: number; prompted: boolean }>();
  private holds = new Map<number, (answer: string) => void>();
  /** One-time grants from answers that arrived after the hold: the retried tool call is let through once. */
  private granted = new Set<string>();
  private limits = new Map<string, Row>();
  private starting = new Set<string>();
  private timer?: NodeJS.Timeout;

  private cfg: Config;
  private db: Store;
  private runner: Runner;
  private url: string;

  constructor(cfg: Config, db: Store, runner: Runner, url: string) {
    this.cfg = cfg; this.db = db; this.runner = runner; this.url = url;
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

  stop() { clearInterval(this.timer); }

  // ---- reads ----
  person(): Row { return this.db.get('SELECT * FROM people WHERE id = 1')!; }
  bot(id: string) { return this.db.get('SELECT * FROM bots WHERE id = ?', id); }
  bots() { return this.db.all('SELECT * FROM bots ORDER BY created_at'); }
  byToken(token: string | undefined) {
    const b = token && this.db.get('SELECT * FROM bots WHERE token = ?', token);
    if (!b) throw Object.assign(new Error('unknown bot token'), { status: 401 });
    return b;
  }
  activeTask(bot: string) { return this.db.get("SELECT * FROM tasks WHERE bot = ? AND state IN ('working', 'needs_you') ORDER BY id LIMIT 1", bot); }

  snapshot() {
    const pub = ({ token, ...b }: Row) => ({ ...b, live: this.live.get(b.id)?.state ?? 'off', task: this.activeTask(b.id) ?? null,
      queued: this.db.get("SELECT COUNT(*) AS n FROM tasks WHERE bot = ? AND state = 'queued'", b.id)!.n });
    return {
      person: this.person(),
      bots: this.bots().map(pub),
      templates: disk.listTemplates(this.cfg),
      tasks: this.db.all('SELECT * FROM tasks WHERE bot != ? ORDER BY id DESC LIMIT 50', CHIEF),
      asks: this.db.all("SELECT * FROM asks WHERE state = 'open' ORDER BY id").map((a) => ({ ...a, detail: JSON.parse(a.detail || '{}') })),
      events: this.db.events(0, 80),
      limits: Object.fromEntries(this.limits),
      computer: { status: 'not-connected', note: 'Each bot gets its own desktop via desklink once @desklink/host is published as a standalone package.' },
    };
  }

  botPage(id: string) {
    const b = this.bot(id);
    if (!b) throw Object.assign(new Error('no such bot'), { status: 404 });
    const { token, ...bot } = b;
    return {
      bot: { ...bot, live: this.live.get(id)?.state ?? 'off' },
      messages: this.db.all('SELECT * FROM (SELECT * FROM messages WHERE bot = ? ORDER BY id DESC LIMIT 200) ORDER BY id', id),
      tasks: this.db.all('SELECT * FROM tasks WHERE bot = ? ORDER BY id DESC LIMIT 50', id),
      notes: disk.readNotes(this.cfg, id),
      notesCap: disk.NOTES_CAP,
      skills: disk.listSkills(this.cfg, id),
      tools: disk.botTools(this.cfg, id),
      files: disk.listFiles(this.cfg, id),
      folder: disk.botDir(this.cfg, id),
    };
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
  post(botId: string, text: string) {
    const bot = this.bot(botId);
    if (!bot) throw Object.assign(new Error('no such bot'), { status: 404 });
    if (!text.trim()) throw Object.assign(new Error('empty message'), { status: 400 });
    if (botId === CHIEF && !this.person().onboarded) return this.onboard(text);
    return this.addTask(botId, text.trim(), 'person');
  }

  assign(botId: string, text: string, by: string) {
    if (!this.bot(botId)) throw Object.assign(new Error(`no bot called ${botId}; see crew roster`), { status: 404 });
    if (botId === CHIEF) throw Object.assign(new Error('Chief cannot assign to himself'), { status: 400 });
    return this.addTask(botId, text.trim(), by);
  }

  private addTask(bot: string, body: string, origin: string) {
    const id = this.db.tx(() => {
      const now = Date.now();
      const r = this.db.run('INSERT INTO tasks (bot, title, body, origin, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        bot, body.split('\n')[0].slice(0, 80), body, origin, 'queued', now, now);
      const id = Number(r.lastInsertRowid);
      this.say(bot, origin === 'person' ? 'person' : origin, body, id);
      this.db.event('task.created', bot, { task: id, origin, title: body.slice(0, 80) });
      return id;
    });
    queueMicrotask(() => this.dispatch());
    return { task: id };
  }

  private setTask(task: Row, state: string, result?: string) {
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
    const busy = this.db.get("SELECT COUNT(DISTINCT bot) AS n FROM tasks WHERE state IN ('working', 'needs_you')")!.n + this.starting.size;
    let free = this.cfg.maxConcurrent - busy;
    for (const t of this.db.all("SELECT * FROM tasks WHERE state = 'queued' ORDER BY id")) {
      if (free <= 0) break;
      if (this.activeTask(t.bot) || this.starting.has(t.bot)) continue;
      free--;
      this.run(t);
    }
  }

  private async run(task: Row) {
    const bot = this.bot(task.bot)!;
    this.starting.add(bot.id);
    try {
      this.setTask(task, 'working');
      await this.runner.start(disk.launchSpec(this.cfg, bot as any, this.url));
      this.db.run("UPDATE bots SET state = 'on' WHERE id = ?", bot.id);
      const st = await this.runner.state(bot.id);
      this.live.set(bot.id, { state: st, promptedAt: Date.now(), sawWorking: false, settledAt: 0, prompted: false });
      // A CLI stuck at a first-run dialog is prompted later, once the person has answered it (see tick).
      if (st === 'idle' || st === 'done') await this.submit(task);
    } catch (e: any) {
      this.setTask(task, 'failed', `Could not start ${bot.display}: ${e.message}`);
      this.say(bot.id, 'system', `I couldn't start ${bot.display}'s ${bot.runtime}: ${e.message}`, task.id);
    } finally {
      this.starting.delete(bot.id);
      this.dispatch();
    }
  }

  private async submit(task: Row, text = this.prompt(task)) {
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
      if (!task || parked) return;
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
      this.db.event('ask.opened', bot, { ask: Number(r.lastInsertRowid), kind, ...detail, pane: undefined });
      return Number(r.lastInsertRowid);
    });
  }

  /** Claude's PermissionRequest hook: hold the tool call while the person decides; after the hold, deny and park. */
  async permission(botId: string, payload: Row): Promise<{ behavior: 'allow' | 'deny'; message?: string }> {
    const task = this.activeTask(botId);
    const input = payload.tool_input ?? {};
    const summary = String(input.command ?? input.file_path ?? input.url ?? JSON.stringify(input)).slice(0, 300);
    const key = `${botId}\n${payload.tool_name}\n${summary}`;
    if (this.granted.delete(key)) return { behavior: 'allow' }; // answered "allow" after the hold expired
    const askId = this.openAsk(botId, task, 'permission', `${this.bot(botId)!.display} would like to use ${payload.tool_name}`, { tool: payload.tool_name, summary });
    const answer = await new Promise<string | null>((resolve) => {
      const t = setTimeout(() => { this.holds.delete(askId); resolve(null); }, HOLD_MS);
      this.holds.set(askId, (a) => { clearTimeout(t); resolve(a); });
    });
    if (answer === null) {
      this.db.event('ask.parked', botId, { ask: askId });
      return { behavior: 'deny', message: "The owner hasn't answered yet; stop here and wait. You'll be told when they answer." };
    }
    if (task) this.setTask(this.db.get('SELECT * FROM tasks WHERE id = ?', task.id)!, 'working');
    return answer === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'The person said no. Continue without it, or explain what you need.' };
  }

  async answer(askId: number, body: { answer?: string; keys?: string[]; text?: string }) {
    const ask = this.db.get("SELECT * FROM asks WHERE id = ? AND state = 'open'", askId);
    if (!ask) throw Object.assign(new Error('that question is already settled'), { status: 409 });
    const shown = body.answer ?? body.text ?? body.keys?.join(' ') ?? '';
    const detail = JSON.parse(ask.detail || '{}');
    const held = this.holds.get(askId);
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
      this.db.event('ask.answered', ask.bot, { ask: askId, answer: shown });
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

  hookTool(botId: string, payload: Row) {
    const i = payload.tool_input ?? {};
    const summary = String(i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.query ?? '').split('\n')[0].slice(0, 120);
    this.db.event('run.tool', botId, { tool: payload.tool_name, summary });
  }

  /** Claude's statusline carries the account's usage windows on every refresh; record them when they move. */
  hookStatus(botId: string, payload: Row) {
    const rl = payload.rate_limits ?? {};
    const pick = (w: Row | undefined) => w && { used: Math.round(Number(w.used_percentage ?? w.utilization ?? 0)), resetsAt: w.resets_at ?? w.resetsAt ?? null };
    const now = { fiveHour: pick(rl.five_hour), sevenDay: pick(rl.seven_day), at: Date.now() };
    const prev = this.limits.get('claude');
    if (now.fiveHour || now.sevenDay) {
      if (JSON.stringify([prev?.fiveHour, prev?.sevenDay]) !== JSON.stringify([now.fiveHour, now.sevenDay])) this.db.event('account.limit', botId, { runtime: 'claude', ...now });
      this.limits.set('claude', now);
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

  // ---- the watch loop: Herdr's lifecycle is the fallback truth when no hook speaks ----
  private ticking = false;
  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const task of this.db.all("SELECT * FROM tasks WHERE state IN ('working', 'needs_you')")) {
        if (this.starting.has(task.bot)) continue;
        const st = await this.runner.state(task.bot).catch(() => 'unknown' as RunState);
        const l = this.live.get(task.bot) ?? { state: st, promptedAt: Date.now(), sawWorking: false, settledAt: 0, prompted: true };
        if (st !== l.state) this.db.event('run.state', task.bot, { state: st, task: task.id });
        l.state = st;
        this.live.set(task.bot, l);
        if (st === 'working' || st === 'blocked') { l.sawWorking = true; l.settledAt = 0; }
        if (st === 'blocked' && !this.db.get("SELECT 1 FROM asks WHERE bot = ? AND state = 'open'", task.bot)) {
          const pane = (await this.runner.read(task.bot, 40).catch(() => '')).split('\n').slice(-30).join('\n');
          const b = this.bot(task.bot)!;
          // Before the first prompt, a blocked CLI is showing a first-run dialog: the person decides, crewd sends the key.
          if (!l.prompted && /trust/i.test(pane)) this.openAsk(task.bot, task, 'trust', `Trust ${b.display}'s folder?`, { pane, note: `${b.display}'s ${b.runtime} asks whether to trust its own folder, ${disk.botDir(this.cfg, b.id)}.` });
          else this.openAsk(task.bot, task, 'blocked', `${b.display} is waiting on a question in its terminal`, { pane });
        }
        if (st === 'idle' || st === 'done') {
          this.db.run("UPDATE asks SET state = 'withdrawn' WHERE bot = ? AND state = 'open' AND kind IN ('blocked', 'trust')", task.bot);
          if (!l.prompted) { if (task.state === 'needs_you') this.setTask(task, 'working'); await this.submit(task); continue; }
          if (!l.settledAt) l.settledAt = Date.now();
          const parked = this.db.get("SELECT 1 FROM asks WHERE task_id = ? AND state = 'open'", task.id);
          if (l.sawWorking && !parked && Date.now() - l.settledAt > FALLBACK_MS) {
            const pane = await this.runner.read(task.bot, 60).catch(() => '');
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
    } finally {
      this.ticking = false;
    }
    this.dispatch();
  }

  async resetBot(id: string, why = 'Stopped by you.') {
    await this.runner.stop(id);
    this.live.delete(id);
    this.db.tx(() => {
      for (const t of this.db.all("SELECT * FROM tasks WHERE bot = ? AND state IN ('working', 'needs_you')", id)) this.setTask(t, 'failed', why);
      this.db.run("UPDATE asks SET state = 'withdrawn' WHERE bot = ? AND state = 'open'", id);
      this.db.run("UPDATE bots SET state = 'off' WHERE id = ?", id);
    });
  }
}
