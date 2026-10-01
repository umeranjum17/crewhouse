import { createHash, randomBytes } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, constants, copyFileSync, existsSync, fstatSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Type } from 'typebox';
import { CHIEF, type Config } from './config.ts';
import type { Row, Store } from './db.ts';
import * as disk from './bots.ts';
import { Desktops, browserBin, missing as desktopMissing, type Watcher } from './desktop.ts';
import { Accounts, PROVIDERS, clock } from './accounts.ts';
import { Connections, type AppTool, APPS } from './connections.ts';
import { bashTool, readPage, runAxi, runSandboxed, q, sandboxReady, said, tool, webTools, type CrewTool } from './engine.ts';
import { allowed, proxy } from './net.ts';
import type { Server } from 'node:net';
import { acts, claimOf, coversOf, effectOf, orderOf, pressOf, toolWords, type Effect } from './policy.ts';
import { axiEnv, registry, resolveGrants, toolBin, which } from './tools.ts';
import { describe, describeTrigger, nextRun, parseSchedule, parseTrigger } from './routines.ts';
import { buildWorkbook, readWorkbook } from './workbooks.ts';
import { MAX_ITEMS, MAX_PARALLEL, subMessage, type BatchAnswer } from './batch.ts';
import { buildDocument, readDocument } from './documents.ts';
import { route, chiefWork, type Helper } from './route.ts';
import type { Link } from './link.ts';
import type { AgentRuntime, RunEnd, RunEvent, RunRef, RunSpec, ToolHost } from './runtime.ts';
import { OpenClawRuntime } from './openclaw/runtime.ts';
import { StubRuntime } from './stub-runtime.ts';
import { fileTool } from './files.ts';

/** Phone pairing stays with Chief, including 'pair my computer with you' said on the home computer. */
export const asksForPhone = (text: string) => /\b(pair|connect|link|add|use|install)\b[\s\S]{0,65}\b(phone|mobile|computer|crewhouse app)\b|\b(phone|mobile|computer)\b[\s\S]{0,35}\b(pair|connect|link)\b/i.test(text);
export const inlineHowTo = (text: string): 'signin' | 'app' | 'routine' | null =>
  /\b(sign[ -]?in|log[ -]?in)\b/i.test(text) && /\b(chatgpt|ai account|crewhouse)\b/i.test(text) ? 'signin' :
  /\b(connect|link|add)\b[\s\S]{0,45}\b(google calendar|calendar|gmail|drive|notion|canva)\b/i.test(text) ? 'app' :
  /\b(every|each|weekday|routine|schedule|when a file arrives|wakes up)\b/i.test(text) ? 'routine' : null;

const HOLD_MS = Number(process.env.CREWHOUSE_HOLD_MS || 180_000); // how long a tool call waits for an answer before the turn parks
const TASK_TIMEOUT_MS = 60 * 60_000;
const taskTokenCap = () => Number(process.env.CREWHOUSE_TASK_TOKENS || 500_000); // ponytail: one house number, not per template; per-template bot.json field if Scribe and Reel diverge.

/** OpenClaw's own tools crewhouse adopts once their policy effects are reviewed: reads, recall and media on the
 *  person's own sign-in. Any future native tool not reviewed here fails closed until a bump reviews it. */
const NATIVE_TOOLS = new Set(['web_search', 'web_fetch', 'memory_search', 'memory_get', 'view_image', 'pdf', 'image_generate']);

/** At most n characters, cut at a word boundary with an ellipsis: titles on cards and in the digest. */
export const short = (s: string, n: number) => (s = s.trim(), s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);

/** How much of the person's AI the crew may use in a day: a share of `dayBudget`, as the person picks it in plain words. */
export const SHARES: Record<string, number> = { light: 0.25, normal: 0.6, full: Infinity };
/** ponytail: one fixed guess at a day of a ChatGPT plan, weighted like its limits (cached reading is cheap); the vendors
 *  publish no allowance to read, so tune this, or read the plan's own when one is published. */
const dayBudget = () => Number(process.env.CREWHOUSE_DAY_TOKENS || 2_000_000);
/** A job the person stopped: they know, so it gets no failure line. */
const STOPPED = 'Stopped by you.';
/** How crewd starts the line for a job that acted but couldn't confirm it worked; the app shows it apart from the rest. */
const UNSURE = 'Not sure it worked:';
const MONEY_CAP = 20; // dollars a month, until the owner changes it
/** Local calendar day and month: the share resets at midnight here, the money cap on the 1st. */
const dayOf = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA');
const monthOf = (t = Date.now()) => dayOf(t).slice(0, 7);
/** The shortest a routine may repeat: faster checks would use up the person's AI. */
export const MIN_EVERY = 15;

/** crewd's tick is 1.5 s; a gap this long means the computer was asleep. */
const SLEPT_MS = 60_000;
const STUCK_MS = Number(process.env.CREWHOUSE_STUCK_MS || 180_000); // working with no news this long: show "stuck?"
/** Events that make up a bot's plain "what I did" trail. */
/** A quiet check-in's reply when nothing needs the person, and how its run is recorded. */
const ALL_CLEAR = 'ALL-CLEAR';
const ALL_CLEAR_RESULT = 'All clear';
const TRAIL = ['task.created', 'task.working', 'task.done', 'task.failed', 'task.unsure', 'task.progress', 'run.tool', 'run.allowed', 'run.typed',
  'ask.opened', 'ask.answered', 'ask.parked', 'file.delivered', 'memory.learned', 'memory.undone', 'bot.recruited', 'bot.allowed', 'run.resumed',
  'skill.learned', 'skill.removed', 'soul.changed'];

/** Whether the person's quiet hours ("22:00-07:00", may wrap past midnight) cover this moment. */
export function quietNow(quiet: string | null | undefined, at = new Date()) {
  const m = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(quiet ?? '');
  if (!m) return false;
  const t = at.getHours() * 60 + at.getMinutes(), from = +m[1] * 60 + +m[2], to = +m[3] * 60 + +m[4];
  return from <= to ? t >= from && t < to : t >= from || t < to;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** A draft in the person's name fits on its card whole, so what they approve (or change) is all of it. */
const DRAFT_CAP = 20_000;
const clean = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** What each batch item hears: its one item and the shared question. The parent's own prompt stays out of it,
 *  so eight parallel items don't each pay for the whole conversation. */
const BATCH_SYSTEM = 'You research one item on the web and report back briefly. Read the web; never sign in, post, buy or submit forms. Every claim that matters gets its source.';
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
/** Person's words, trimmed to `n`: every name and address goes through here, or the card has nothing to show. */
const needText = (v: unknown, n: number, msg: string) => { const s = clean(v, n); if (!s) throw fail(msg); return s; }
/** A URL is context for a job, never its name. */
export function taskTitle(body: string) {
  const first = body.split('\n')[0].trim();
  if (!/^https?:\/\/\S+$/i.test(first)) return short(first, 80);
  try { return `Work on ${new URL(first).hostname.replace(/^www\./, '')}`; } catch { return 'Work on the site'; }
}
/** The engine's reply-routing control markers (like [[reply_to_current]]) are never person-visible: stripped
 *  before a reply is kept or shown, on write and on read for older rows. Plain prose passes through untouched. */
export function cleanReply(text: string) {
  return String(text ?? '').replace(/\[\[\s*reply[^\[\]]*\]\] ?/gi, '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]*\n(?:[ \t]*\n)*/g, '\n\n').trim();
}

/** A relay is the answer, not a quoted chunk of the helper's raw markdown. Clauses about work still under
 *  way (a handoff note like "Scribe is preparing…" written before the next helper finished) are stale by the
 *  time the final wrap states the outcome, so they are never relayed. */
const STALE_PROGRESS = /\b(is|are)\s+(preparing|on it\b|working on|looking into|checking|getting|putting together|writing|finishing)|\bwill\s+(prepare|write|check|finish|share|send|follow up)\b/i;
export function relayResult(reply: string, note = '') {
  const tidy = (s: string) => s.replace(/^A document in \d+ sections?:\s*(.+)$/i, 'The $1 is ready.')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1').replace(/\*\*|^\s*[-*]\s*/gm, '')
    .replace(/\b(sir|ma'am)\b[,.]?\s*/gi, '').replace(/^\w+:\s*/, '').replace(/https?:\/\/\S+/g, '').trim();
  // Only complete sentences fit for a headline; never apply short(), which adds a cut-off ellipsis.
  // A semicolon joins what are really two headlines, so split there too: the stale half must not ride along.
  for (const source of [note.length < 140 ? note : '', reply]) {
    const sentences = tidy(source).match(/[^.!?;]+[.!?;][”"']?(?=\s|$)/g) ?? [];
    const full = sentences.map((s) => s.trim()).find((s) => s.length <= 160 && !/(?:…|\.{2,})[”"']?$/.test(s) && !STALE_PROGRESS.test(s));
    if (full) return `${full.replace(/[.!?;][”"']?$/, '').trim()}.`;
  }
  return 'The result is ready.';
}

export function chiefFirst(body: string) {
  const url = /https?:\/\/[^\s]+/i.exec(body)?.[0];
  if (url) { try { return `Looking at ${new URL(url).hostname.replace(/^www\./, '')} now.`; } catch { /* malformed address */ } }
  if (/\b(market|marketing|promote|launch)\b/i.test(body)) return "I'll work out the next step for your app.";
  if (/\b(dinner|meal)\b/i.test(body)) return "I'll put together a dinner plan.";
  if (/\b(remind|reminder)\b/i.test(body)) return "I'll work out the reminder and when it should run.";
  if (/\b(research|look into|find out|what do people say)\b/i.test(body)) return "I'll check the question and what evidence would help.";
  if (/\b(calendar|meetings?|inbox|emails?|mail)\b/i.test(body)) return /\b(calendar|meetings?)\b/i.test(body) ? 'Checking your calendar.' : 'Checking your email.';
  return "I'll look into that now.";
}

const partOfDay = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'afternoon' : 'evening'; };
/** Chief's first words (plan 3, section 3.13). Deterministic: no model call before we know how to address the person. */
export const chiefGreeting = () =>
  `Good ${partOfDay()}. I am Chief, of the Crewhouse. I help get things done with your crew.\n\n` +
  '- The crew works on this computer and pauses when it sleeps.\n' +
  '- We stop and ask you first before sending anything, spending money or touching your own files.\n' +
  '- Your AI account does the thinking; your sign-ins stay yours.\n\n' +
  'What should I call you?';

/** A sign-in that stopped working (a password change, usually), and what happens next. */
const signedOutWords = (name: string) => `${name} signed you out. That happens after a password change. Sign in again and the crew picks up where it left off.`;

/** What changed between two readings of a page: the differing middle, with a little of what surrounds it, capped. */
export function changed(before: string, now: string, cap = 1500) {
  let a = 0;
  while (a < before.length && a < now.length && before[a] === now[a]) a++;
  let z = 0;
  while (z < before.length - a && z < now.length - a && before[before.length - 1 - z] === now[now.length - 1 - z]) z++;
  const around = (s: string) => { const from = Math.max(0, a - 200), to = Math.min(s.length, s.length - z + 200); return `${from ? '…' : ''}${s.slice(from, to).slice(0, cap)}${to < s.length ? '…' : ''}`; };
  return `Before: ${around(before)}\nNow: ${around(now)}`;
}

/** A photo sent with a message: its bytes and file ending, checked at the edge. */
export type Photo = { bytes: Buffer; ext: string; mime: string };
const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
/** At most four photos of 5 MB each, JPEG, PNG or WebP: anything else is refused in plain words. */
export function checkPhotos(photos: unknown): Photo[] {
  if (photos === undefined || photos === null) return [];
  if (!Array.isArray(photos) || photos.length > 4) throw fail('send up to four photos at a time');
  return photos.map((p: any) => {
    const ext = PHOTO_TYPES[String(p?.type ?? '')];
    const bytes = typeof p?.data === 'string' ? Buffer.from(p.data, 'base64') : Buffer.alloc(0);
    if (!ext || !bytes.length) throw fail('that photo could not be read; try a JPEG or PNG');
    if (bytes.length > 5 << 20) throw fail('that photo is too big; try a smaller one');
    return { bytes, ext, mime: String(p.type) };
  });
}

/** No routine faster than every MIN_EVERY minutes: a check each minute would use up the person's AI in an afternoon. */
function paced(when: ReturnType<typeof parseSchedule>) {
  if ('every' in when && when.every < MIN_EVERY) throw fail(`A routine runs at most every ${MIN_EVERY} minutes, so your AI stays free for you. Try “every ${MIN_EVERY} minutes”.`);
  return when;
}

/** Holds an idle-sleep inhibitor while on: systemd-inhibit on Linux, caffeinate on macOS. Nothing where neither exists. */
function inhibitor() {
  let child: ChildProcess | undefined;
  // Both let go by themselves if crewd dies without saying so: they only live as long as its pid.
  const pid = String(process.pid);
  const cmd = process.platform === 'darwin' ? ['caffeinate', '-i', '-w', pid]
    : ['systemd-inhibit', '--what=idle:sleep', '--who=Crewhouse', '--why=A helper is working', '--mode=block', 'tail', `--pid=${pid}`, '-f', '/dev/null'];
  return (on: boolean) => {
    if (!on) { child?.kill(); child = undefined; return; }
    if (child) return;
    const c = child = spawn(cmd[0], cmd.slice(1), { stdio: 'ignore' });
    const gone = () => { if (child === c) child = undefined; };
    c.on('error', gone); // not installed: the computer's own sleep settings apply
    c.on('exit', gone);
  };
}

/** The bot's browser while a task runs: its AXI; letting go of the browser when the task ends, or for a while (`release`:
 *  the person takes the wheel, and the recorder may need the browser's one DevTools connection; the next call re-attaches). */
interface Browser { run: (args: string[], signal?: AbortSignal) => Promise<string>; end: () => void; release: () => void }

/** A run's place in the crew: which task, account and session key, and the browser if it has one. */
interface Live { key: string; task: number; account: string; model?: string; grants: string[]; browser?: Browser; page?: string; snapshot?: string; apps?: Record<string, AppTool>;
  /** The tools crewd runs for this run: the sandboxed shell, the browser AXI, the person's connected apps'. */
  shell?: CrewTool; browserTool?: CrewTool; appTools?: Map<string, CrewTool>;
  /** Lines the helper typed on this page that no card has shown yet (an unsigned register's claim form). */
  fills?: { label: string; value: string }[] }

/** The deterministic half: people, bots, tasks, the per-bot queue, asks. Models only ever see prompts. */
export class Crew {
  private live = new Map<string, Live>();
  /** Tasks to pick up in their own session: after a restart, or on the next AI account after a limit. */
  private handoffs = new Map<number, string>();
  /** Tasks resuming because the person just connected an app they asked for. */
  private connected = new Set<number>();
  private holds = new Map<number, (answer: string) => void>();
  /** One-time grants from answers that arrived after the hold: the retried tool call is let through once. */
  private granted = new Set<string>();
  /** "For this task" answers: the gate's keys a task's later calls go through on. */
  private taskGrants = new Map<number, string[]>();
  private starting = new Set<string>();
  private timer?: NodeJS.Timeout;
  /** Bots with a run in flight (the engine is working). */
  readonly busy = new Set<string>();
  /** Applied learning the person has already been told about, keyed by skill id. */
  private seenLearned = new Set<string>();
  /** When to next check the engine's collection-review job (the weekly tidy, run on crewhouse's own boundary). */
  private curationAt = 0;
  private curationBusy = false;
  /** Bots whose screen the person is driving: the bot is paused until they give the controls back. */
  private held = new Set<string>();
  readonly desktops: Desktops;
  readonly accounts: Accounts;
  readonly connections: Connections;
  phoneLink?: Pick<Link, 'offer' | 'status'>;
  private freshAt = 0;
  private lastTick = 0;
  /** Keeps idle sleep away while a helper is working, and only then. Never the lid. Tests replace it. */
  keepAwake: (on: boolean) => void;
  private awake = false;
  /** Watches reading their page right now: a slow page is never read twice at once. */
  private checking = new Set<number>();
  /** Each fenced helper's allowlisting proxy (src/net.ts), started the first time it is needed. */
  private nets = new Map<string, Server>();
  /** A checkout the person said yes to: that task's clicks on that page go through while its total stays the same. */
  private checkouts = new Map<string, { task: number; page: string; total: number | null }>();
  private stopped = false;

  private cfg: Config;
  private db: Store;
  /** The replaceable agent process: the real engine, or the scripted stub the tests run on. */
  readonly runtime: AgentRuntime;

  constructor(cfg: Config, db: Store) {
    this.cfg = cfg; this.db = db;
    this.desktops = new Desktops(cfg.stateDir);
    this.keepAwake = cfg.engine === 'stub' ? () => {} : inhibitor();
    this.runtime = cfg.engine === 'stub' ? new StubRuntime() : new OpenClawRuntime(cfg.stateDir, cfg.crewDir);
    this.accounts = new Accounts(this.runtime);
    // A scripted/custom model provider stands in for the person's own ChatGPT, exactly as the stub model always did.
    if (cfg.engineProvider) this.accounts.ready.set('chatgpt', true);
    this.accounts.onSignedIn = () => this.wake(`You're signed in. I'll start now.`);
    this.connections = new Connections(cfg, `http://${cfg.host}:${cfg.port}/connect/callback`);
    this.connections.onChange = (app) => this.db.event('app.changed', null, { app });
    this.connections.onExpired = (app) => this.say(CHIEF, 'system', `Your ${this.connections.apps[app].name} connection has run out. Connect it again under Settings, Connections, whenever you like.`, null);
  }

  init() {
    this.db.tx(() => {
      if (!this.db.get('SELECT 1 FROM people WHERE id = 1')) this.db.run('INSERT INTO people (id, name, created_at) VALUES (1, ?, ?)', 'Owner', Date.now());
      if (!this.bot(CHIEF)) this.addBot(disk.loadTemplate(this.cfg, 'chief'), 'Chief', CHIEF, 'system');
      // Questions whose task is over have no one left to answer them.
      // A suggestion (a skill to keep, a new personality) belongs to no running task, so it waits for its answer across restarts.
      this.db.run("UPDATE asks SET state = 'withdrawn' WHERE state = 'open' AND kind != 'propose' AND (task_id IS NULL OR task_id NOT IN (SELECT id FROM tasks WHERE state IN ('working', 'needs_you')))");
      this.db.run("UPDATE bots SET state = 'off'");
      this.db.event('system.started', null, {});
      // Chats were unread-less before: an existing install starts with everything already seen.
      if (!this.db.get('SELECT 1 FROM reads')) this.db.run('INSERT INTO reads (member, bot, seen) SELECT 1, b.id, COALESCE((SELECT MAX(id) FROM messages), 0) FROM bots b');
      this.ensureDigest();
    });
    for (const b of this.bots()) {
      let tpl: disk.Template | null = null;
      try { tpl = disk.loadTemplate(this.cfg, b.template); } catch { /* a template since removed: its bot keeps its folder as is */ }
      disk.upgradeFolder(this.cfg, b.id, tpl, b.display);
    }
    if (!this.person().onboarded && !this.db.get('SELECT 1 FROM messages WHERE bot = ?', CHIEF)) this.say(CHIEF, 'bot', chiefGreeting(), null);
    this.timer = setInterval(() => this.tick(), 1500);
    this.recover();
    // A cold boot replays the sleep line: the last tick survived in settings, so a gap still names the
    // missed routines once and starts wake chores, on this computer or a cloud one.
    const last = Number(this.db.get("SELECT value FROM settings WHERE key = 'crew.lastTick'")?.value ?? 0);
    if (last) this.lastTick = last;
    if (last && Date.now() - last > SLEPT_MS) this.slept(last, Date.now());
    void this.eachLegacy('migrate').then(async () => {
      if (this.stopped) return; // crewd stopped before the engine came up
      // The engine comes up in the background: a first install can take minutes, and crewd boots without it.
      const up = await this.runtime.start(this.toolHost()).then(() => true).catch((e) => {
        console.error('engine start:', e);
        this.db.event('system.engine', null);
        return false;
      });
      // The gateway is the witness: only a sign-in it reports retires crewhouse's staged copy.
      if (up && !this.stopped) await this.eachLegacy('confirm');
      if (this.cfg.engineProvider && this.runtime.configureModelProvider)
        await this.runtime.configureModelProvider(this.cfg.engineProvider.baseUrl, this.cfg.engineProvider.apiKey).catch((e: unknown) => console.error('engine provider:', e));
      if (this.stopped) return;
      await this.runtime.setLearning?.(this.learningOn()).catch((e: unknown) => console.error('learning:', e));
      if (this.learningOn()) this.curationAt = Date.now() + 60_000; // first look a minute after the engine is up, then weekly from the job
    });
    this.dispatch();
  }

  /** Stage the person's old sign-in offline; retire it only after the gateway witnesses the import. */
  private async eachLegacy(method: 'migrate' | 'confirm') {
    const fn = (this.runtime as { migrate?: (path: string) => Promise<boolean>; confirm?: (path: string) => Promise<boolean> })[method];
    const legacy = join(this.cfg.stateDir, 'people', '1', 'engine', 'auth.json');
    if (!fn || (!existsSync(legacy) && !existsSync(`${legacy}.moved-to-engine`) && !existsSync(`${legacy}.moved-to-engine.sealed`))) return;
    try { await fn.call(this.runtime, legacy); }
    catch (e) { console.error('engine migration:', e); }
  }

  /** The "Learn from how I work" switch: the person's choice, kept in crewhouse's own db (default on), applied to
   *  the engine's learning mode whenever the engine comes up. */
  learningOn() { try { return this.db.get("SELECT value FROM settings WHERE key = 'learning'")?.value !== 'off'; } catch { return true; } }
  async setLearning(on: boolean) {
    this.db.run("INSERT INTO settings (key, value) VALUES ('learning', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", on ? 'on' : 'off');
    await this.runtime.setLearning?.(on);
  }

  /** The weekly tidy of what was learned, on crewhouse's own boundary: capture first — refusing the whole review if
   *  the capture cannot be verified — then the engine's review inside the armed window, then the plain-words record.
   *  Every review goes through this one pre-change step. */
  private async weeklyCuration() {
    this.curationAt = Date.now() + 7 * 86_400_000;
    const runtime = this.runtime as { runCollectionReview?: () => Promise<{ capture: string; kept: string[]; written: string[]; dropped: string[] }> };
    if (!runtime.runCollectionReview) return;
    try {
      const outcome = await runtime.runCollectionReview();
      const parts = [outcome.written.length ? `rewrote ${outcome.written.join(', ')}` : '',
        outcome.dropped.length ? `set aside ${outcome.dropped.join(', ')}` : '',
        !outcome.written.length && !outcome.dropped.length ? 'nothing needed changing' : ''].filter(Boolean);
      this.db.tx(() => {
        this.say(CHIEF, 'bot', `Tidied what your crew learned: ${parts.join('; ')}. Set-aside skills can come back.`, null);
        this.db.event('learn.curated', CHIEF, { capture: outcome.capture, kept: outcome.kept, written: outcome.written, dropped: outcome.dropped });
      });
    } catch (e) {
      // Refused (usually the capture): the data stays exactly as it was, and the person hears why — unless
      // the person has no learned skills yet, where there is nothing to leave untouched.
      console.error('curation:', e);
      const learned = await this.runtime.learned().catch(() => []);
      this.db.tx(() => {
        this.db.event('learn.curated', CHIEF, { refused: String(e).slice(0, 200) });
        if (learned.length) this.say(CHIEF, 'system', `I left your learned skills untouched this week — tidying them didn't feel safe just now.`, null);
      });
    }
  }

  /** A restart is a non-event: every task that was running continues in its own session, from its session file.
   *  A parked question stays open and answerable; the bot asks the same thing again and finds it. */
  private recover() {
    const tasks = this.db.all("SELECT * FROM tasks WHERE state IN ('working', 'needs_you')");
    for (const t of tasks) {
      this.handoffs.set(t.id, 'Crewhouse restarted');
      // An acted call may have landed out in the world: the resumed job asks again, even under always.
      if (t.acted) this.db.run('UPDATE tasks SET reask = 1 WHERE id = ?', t.id);
      this.setTask(t, 'queued');
    }
    if (tasks.length) this.db.event('system.recovered', null, { resumed: tasks.length });
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    if (this.awake) this.keepAwake(false);
    for (const [id, l] of this.live) { this.live.delete(id); l.browser?.end(); }
    for (const n of this.nets.values()) n.close();
    this.accounts.stop();
    return Promise.all([this.runtime.stop(), this.desktops.stopAll(), this.connections.stop()]);
  }

  // ---- reads ----
  person(): Row {
    const m = this.db.get('SELECT * FROM people WHERE id = 1');
    if (!m) throw Object.assign(new Error('no such person'), { status: 404 });
    return m;
  }
  /** "sir", "Sam", or "the person": how the person is named in prompts. */
  private called() { return this.person().name || 'the person'; }
  bot(id: string) { return this.db.get('SELECT rowid + 100 AS n, * FROM bots WHERE id = ?', id); }
  bots() { return this.db.all('SELECT * FROM bots ORDER BY created_at'); }
  activeTask(bot: string) { return this.db.get("SELECT * FROM tasks WHERE bot = ? AND state IN ('working', 'needs_you') ORDER BY id LIMIT 1", bot); }

  /** 0 when the person's account is available; otherwise when it stops resting. */
  restingUntil(account: string) { return this.accounts.restingUntil(account); }

  /** The accounts a task may run on, in order: its own choice, the bot's fallback order, then any other account its
   *  person has signed in to (someone who only has Grok still gets a working crew). */
  choices(task: Row) {
    return disk.dedupe([...(task.brain ? [disk.parseBrain(task.brain)] : []), ...disk.brains(this.cfg, task.bot), ...Object.keys(PROVIDERS).map((provider) => ({ provider }))]);
  }

  /** What the bot page and crew cards show: "Thinks with ChatGPT, then Grok". Account names only, never model ids. */
  thinks(id: string) {
    try {
      return disk.dedupe(disk.brains(this.cfg, id).map((b) => ({ provider: b.provider }))).map((b) => ({ key: b.provider, name: disk.brainName(b), restingUntil: this.restingUntil(b.provider) }));
    } catch { return []; } // a hand-edited bot.json with a bad model must not take the whole app down
  }

  /** A working bot's latest step and how long it has been quiet; quiet past STUCK_MS reads as "stuck?". */
  private progress(bot: string, task: Row | undefined) {
    if (!task) return { step: null, quietSince: null, stuck: false };
    const step = this.db.get(`SELECT seq, at, kind, data FROM events WHERE bot = ? AND kind IN ('run.tool', 'task.progress', 'file.delivered') AND json_extract(data, '$.task') = ? ORDER BY seq DESC LIMIT 1`, bot, task.id);
    const quietSince = this.db.get("SELECT MAX(at) AS at FROM events WHERE bot = ? AND json_extract(data, '$.task') = ?", bot, task.id)?.at ?? task.updated_at ?? null;
    return { step: step ? { ...step, data: JSON.parse(step.data) } : null, quietSince, stuck: task.state === 'working' && Date.now() - quietSince > STUCK_MS };
  }

  /** Ideas are promises a hired bot can keep (tools granted and ready here, apps connected), shown with what they wait on;
   *  unhired templates offer up to 3 goal rows needing nothing, tagged with the template to hire (docs/ui-contract.md). */
  private ideas() {
    const on = new Set(this.connections.on());
    const house = this.connections.houseGoogle();
    const hired = new Set(this.bots().filter((b) => b.id !== CHIEF).map((b) => b.template));
    const rows = this.bots().filter((b) => b.id !== CHIEF).flatMap((b) => {
      const ready = new Set(disk.botTools(this.cfg, b.id).filter((t) => t.granted && t.ready).map((t) => t.id));
      // A tool the bot does not have: the promise is not made. An app they haven't connected: it is, with what's missing.
      return (disk.botConfig(this.cfg, b.id).ideas ?? []).filter((i) => i.needs.every((n) => ready.has(n) || APPS[n]))
        .map((i) => ({ bot: b.id, promise: i.promise, ask: i.ask, group: i.group ?? 'life',
          // Two of the household's Google apps name one thing: the row says "Google", not "Google and Google".
          needs: [...new Set(i.needs.filter((n) => !ready.has(n) && !on.has(n)).map((n) => (APPS[n] ? (APPS[n].google && !house ? 'Google' : APPS[n].name) : '')))] }));
    });
    const hire = disk.listTemplates(this.cfg).filter((t) => !hired.has(t.id)).flatMap((t) => (t.ideas ?? []).filter((i) => !(i.needs ?? []).length).map((i) => ({ bot: t.id, promise: i.promise, ask: i.ask, group: i.group ?? 'life', needs: [], hire: t.id }))).sort((a, b) => Number(b.group === 'goal') - Number(a.group === 'goal')).slice(0, 3);
    // The six-row cap counts the jobs they can hand over now, hired or to hire; waiting rows ride along uncapped (ponytail: no template set has more than a screenful; cap them when one does).
    return [...rows.filter((r) => !r.needs.length).concat(hire).slice(0, 6), ...rows.filter((r) => r.needs.length)];
  }

  /** A bot as the app sees it: no token, no model, nothing technical. */
  private pub(b: Row) {
    const task = this.db.get("SELECT * FROM tasks WHERE bot = ? AND state IN ('working', 'needs_you') ORDER BY id LIMIT 1", b.id);
    return { id: b.id, display: b.display, role: b.role, template: b.template, color: b.color, state: b.state, created_at: b.created_at,
      thinks: this.thinks(b.id), ...this.screenOf(b.id), live: this.liveState(b.id), task: task ? { ...this.task(task), files: this.activeFiles(task.id) } : null, ...this.progress(b.id, task),
      queued: this.db.get("SELECT COUNT(*) AS n FROM tasks WHERE bot = ? AND state = 'queued'", b.id)!.n,
      pausedUntil: this.db.get("SELECT MIN(wake_at) AS w FROM tasks WHERE bot = ? AND state = 'paused'", b.id)!.w };
  }

  private liveState(id: string) { return !this.live.get(id) ? 'off' : this.busy.has(id) ? 'working' : 'idle'; }

  /** A task for the app: its words and state, not the AI it asked for or its session file. */
  private task({ brain, session, tokens: _, ...t }: Row) {
    return { ...t, ...(t.result == null ? {} : { result: cleanReply(t.result) }), thinks: brain ? disk.brainName(disk.parseBrain(brain)) : null };
  }

  /** An open question for the app: the plain sentence and what "For this task" or "Always" would cover. The gate's key stays here.
   *  A checkout adds the order's plain facts for the review sheet — what the page charges and whether crewd could read it,
   *  in the page's own currency; never the page's address. */
  private askView({ detail, ...a }: Row): Row {
    const d = JSON.parse(detail || '{}');
    const covers = d.key ? coversOf(d.key) : null;
    if (a.kind === 'connect') return { ...a, detail: { app: d.app, words: d.words } };
    if (a.kind === 'propose') return { ...a, detail: { words: a.title, preview: d.preview, ...(d.create ? { yes: `Yes, take ${d.create.name} on` } : d.draft ? { yes: 'Approve' } : {}), ...(d.draft ? { draft: d.draft } : {}), ...(d.job ? { job: d.job } : {}), ...(d.pass ? { pass: { root: d.pass.root, files: d.pass.files.map((f: string) => basename(f)) } } : {}), ...(d.routine ? { routine: d.routine } : {}), ...(d.plan ? { plan: { bot: d.plan.bot, steps: d.plan.steps } } : {}) } };
    return { ...a, detail: { effect: d.effect, words: a.title, spends: d.effect === 'spend', covers, ...(covers ? { always: covers } : {}), ...(d.preview ? { preview: d.preview } : {}), ...(d.press ? { press: true } : {}), ...(d.fill ? { fill: true } : {}),
      ...(d.checkout ? { order: { shown: d.checkout.shown ?? '', known: Number.isFinite(d.checkout.total), dollars: d.checkout.currency === '$' } } : {}) } };
  }

  /** A delivered file handed over from another helper is that task's input, never its result. New rows carry
   *  input:true; rows recorded before that tag still read as input by their handoff-copy path (files/from-<helper>/). */
  private isInput(d: Row): boolean {
    return !!d.input || String(d.path ?? '').startsWith('files/from-');
  }

  /** A task's delivered files, its own output first, so Things previews and opens what the task itself made. */
  private taskFiles(task: number): Row[] {
    const rows = this.db.all(`SELECT at, data FROM events WHERE kind = 'file.delivered' AND json_extract(data, '$.task') = ? ORDER BY seq`, task)
      .map((e) => ({ ...JSON.parse(e.data), at: e.at }));
    return [...rows.filter((d) => !this.isInput(d)), ...rows.filter((d) => this.isInput(d))];
  }

  /** The active task carries its delivered files for the office desk: path, the helper's note and when
   *  it landed, own output first, handed-over inputs marked. Photos ride along for the chat, not the desk. */
  private activeFiles(task: number) {
    return this.taskFiles(task).map((d) => ({ path: d.path, note: d.note ?? '', at: d.at,
      ...(d.photo ? { photo: true } : {}), ...(this.isInput(d) ? { input: true } : {}) }));
  }

  snapshot() {
    const files = (task: number) => this.taskFiles(task).map((d) => d.path);
    const person: Row = this.person();
    person.quietNow = quietNow(person.quiet);
    return {
      person,
      bots: this.bots().map((b) => ({ ...this.pub(b), ...this.chat(b.id) })),
      templates: disk.listTemplates(this.cfg).map((t) => ({ id: t.id, display: t.display, role: t.role, color: t.color, kit: disk.templateKit(this.cfg, t) })),
      tasks: this.db.all('SELECT * FROM tasks WHERE bot != ? ORDER BY id DESC LIMIT 50', CHIEF).map((t) => ({ ...this.task(t), files: t.state === 'done' ? files(t.id) : [] })),
      ideas: this.ideas(),
      room: (() => { const r = this.room(); return { last: r.lines.at(-1) ?? null, busy: r.busy }; })(),
      asks: this.db.all("SELECT * FROM asks WHERE state = 'open' ORDER BY id").map((a) => this.askView(a)),
      events: this.db.events(0, 80),
      /** The person's AI accounts that are resting now, and until when (docs/ui-contract.md). */
      resting: Object.fromEntries(Object.keys(PROVIDERS).map((k) => [k, this.restingUntil(k)]).filter(([, t]) => t)),
      /** The apps the person has connected, by the app screen's own names. */
      connections: this.connections.on(),
      /** Whether Google is switched on (Calendar, Gmail and Drive need it), and its four steps as
       *  far as Google's own answers show: checked, missing, or only said done. */
      house: { google: this.connections.houseGoogle(), steps: this.connections.houseSteps() },
      desktops: { ready: desktopMissing().length === 0 },
      routines: this.routines(),
      /** The person's pick for the crew's share of their AI, and whether today's is used up. Never a number. */
      share: { choice: person.share ?? 'light', used: this.overShare(), week: this.week() },
      money: { cap: this.moneyCap(), spent: this.spentThisMonth() },
    };
  }

  /** Only jobs started in the room or involving a helper-to-helper pass belong here. */
  room(before?: number) {
    const roots = `SELECT root FROM tasks GROUP BY root HAVING MAX(room) = 1 OR SUM(CASE WHEN parent IS NOT NULL AND origin != '${CHIEF}' THEN 1 ELSE 0 END) > 0 OR EXISTS (SELECT 1 FROM asks a WHERE a.state = 'open' AND json_extract(a.detail, '$.pass.root') = tasks.root)`;
    const lines = this.db.all(`SELECT m.*, t.origin, t.parent, t.root FROM messages m JOIN tasks t ON t.id = m.task_id
      WHERE t.root IN (${roots}) AND m.id < ? ORDER BY m.id DESC LIMIT 200`, before ?? Number.MAX_SAFE_INTEGER).reverse();
    return { lines: lines.map((m) => ({ id: m.id, bot: m.bot, author: m.author, to: m.parent && m.author === m.origin ? m.bot : undefined,
      from: m.parent && m.author === m.origin ? m.origin : undefined, text: cleanReply(m.text), at: m.at,
      files: m.parent && m.author === m.origin ? this.taskFiles(m.task_id).map((d) => ({ bot: m.bot, path: d.path })) : [] })),
      busy: this.db.all(`SELECT DISTINCT bot FROM tasks WHERE root IN (${roots}) AND state IN ('queued','working','needs_you','paused')`).map((r) => r.bot),
      asks: this.db.all(`SELECT * FROM asks WHERE state = 'open' AND (json_extract(detail, '$.pass.root') IN (${roots}) OR task_id IN (SELECT id FROM tasks WHERE root IN (${roots})))`).map((a) => this.askView(a)) };
  }

  private wrap(root: number) {
    const tasks = this.db.all('SELECT * FROM tasks WHERE root = ? ORDER BY id', root);
    if (tasks.length < 2 || tasks.some((t) => !['done', 'failed', 'unsure'].includes(t.state)) ||
      this.db.get("SELECT 1 FROM asks WHERE state = 'open' AND json_extract(detail, '$.pass.root') = ?", root) ||
      this.db.get("SELECT 1 FROM events WHERE kind = 'room.wrap' AND json_extract(data, '$.root') = ?", root)) return;
    const parts = tasks.filter((t) => t.bot !== CHIEF).map((t) => t.state === 'done'
      ? `${this.bot(t.bot)?.display ?? t.bot} finished. ${relayResult(t.result || 'Done')}`
      : `${this.bot(t.bot)?.display ?? t.bot} ${t.state === 'unsure' ? "isn't sure it worked" : "couldn't finish"}.`);
    const text = `${tasks.some((t) => t.state !== 'done') ? 'The crew has stopped.' : 'All done.'}\n${parts.join('\n')}`;
    this.say(CHIEF, 'bot', text, root);
    this.db.event('room.wrap', CHIEF, { root });
  }

  // ---- chats: each thread's last line and what the person hasn't seen ----
  /** Lines that make a thread unread: the bot's and Chief's words, anything in Chief's thread, and a helper's delivered files. */
  private static UNSEEN = "author != 'person' AND (author != 'system' OR bot = 'chief' OR text LIKE 'Delivered %')";
  private chat(bot: string) {
    const mine = 'bot = ?';
    const last = this.db.get(`SELECT author, substr(text, 1, 160) AS text, at FROM messages WHERE ${mine} ORDER BY id DESC LIMIT 1`, bot);
    if (last) last.text = cleanReply(last.text);
    const seen = this.db.get('SELECT seen FROM reads WHERE bot = ?', bot)?.seen ?? 0;
    const unread = this.db.get(`SELECT COUNT(*) AS n FROM messages WHERE ${mine} AND id > ? AND ${Crew.UNSEEN}`, bot, seen)!.n as number;
    return { last: last ?? null, unread };
  }

  /** The person has read this thread up to now. */
  read(bot: string) {
    if (!this.bot(bot)) throw fail('no such bot', 404);
    const top = this.db.get('SELECT MAX(id) AS id FROM messages WHERE bot = ?', bot)!.id ?? 0;
    this.db.run('INSERT INTO reads (member, bot, seen) VALUES (1, ?, ?) ON CONFLICT(member, bot) DO UPDATE SET seen = MAX(seen, excluded.seen)', bot, top);
  }

  /** Words across the person's chats and finished work, newest first. Plain LIKE: an install has thousands of lines, not millions. */
  search(q: string) {
    const like = `%${String(q).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    if (like.length < 4) return { messages: [], things: [] };
    return {
      messages: this.db.all("SELECT id, bot, author, substr(text, 1, 200) AS text, at FROM messages WHERE text LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 50", like)
        .map((m: Row) => ({ ...m, text: cleanReply(m.text) })),
      things: this.db.all("SELECT id, bot, title, updated_at AS at FROM tasks WHERE bot != ? AND state = 'done' AND (title LIKE ? ESCAPE '\\' OR result LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT 20", CHIEF, like, like),
    };
  }

  // ---- the share: what a run used lands on the person's day; each task also stops at its own ceiling (see onEvent) ----

  /** The person's routines and check-ins have had their share of today. Things they ask for directly never wait on it. */
  overShare() {
    const used = this.db.get('SELECT tokens FROM usage WHERE day = ?', dayOf())?.tokens ?? 0;
    return used >= dayBudget() * (SHARES[this.person().share ?? 'light'] ?? SHARES.light);
  }

  /** How this week is going against the person's share, in thirds: 'small', 'fair' or 'most'. Null on "as much as it needs". */
  week() {
    const share = SHARES[this.person().share ?? 'light'] ?? SHARES.light;
    if (!Number.isFinite(share)) return null;
    const used = this.db.get('SELECT COALESCE(SUM(tokens), 0) AS n FROM usage WHERE day > ?', dayOf(Date.now() - 7 * 86_400_000))!.n as number;
    const part = used / (dayBudget() * share * 7);
    return part < 1 / 3 ? 'small' : part < 2 / 3 ? 'fair' : 'most';
  }

  /** Over the share, a routine run waits for tomorrow; Chief says so once a day. */
  private waitForTomorrow(task: Row) {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    this.db.tx(() => {
      this.db.run('UPDATE tasks SET wake_at = ? WHERE id = ?', midnight, task.id);
      this.setTask(task, 'paused', 'Waiting for tomorrow: the crew has had its share of your AI today.');
      if (this.db.get("SELECT 1 FROM events WHERE kind = 'share.reached' AND json_extract(data, '$.day') = ?", dayOf())) return;
      this.db.event('share.reached', null, { day: dayOf() });
      this.say(CHIEF, 'bot', `I've stopped the routines and check-ins for today so your ${PROVIDERS.chatgpt.name} stays free for you. ` +
        'They start again tomorrow morning. Anything you ask for yourself still goes ahead.', null);
    });
  }

  moneyCap() { return Number(this.db.get("SELECT value FROM settings WHERE key = 'money.cap'")?.value ?? MONEY_CAP); }
  spentThisMonth() {
    return this.db.get("SELECT COALESCE(SUM(json_extract(data, '$.amount')), 0) AS n FROM events WHERE kind = 'money.spent' AND json_extract(data, '$.month') = ?", monthOf())!.n as number;
  }
  /** Owner only (the server checks): the most the crew may spend in a month, however many times the person says yes. */
  setMoneyCap(cap: unknown) {
    const n = Number(cap);
    if (!Number.isFinite(n) || n < 0 || n > 10_000) throw fail('a monthly limit is between $0 and $10,000');
    this.db.run("INSERT INTO settings (key, value) VALUES ('money.cap', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(Math.round(n)));
    this.db.event('money.cap', null, { cap: Math.round(n) });
  }

  // ---- routines: time-based, deterministic, no model call to decide when ----
  /** The person's routines and morning digest. */
  routines() {
    return this.db.all('SELECT * FROM routines ORDER BY kind, id').map(({ brain, ...r }): Row => ({
      ...r, words: r.schedule ? describe(parseSchedule(r.schedule)) : '',
      on: r.trigger ? describeTrigger(parseTrigger(r.trigger), this.bot(r.bot)?.display ?? r.bot) : '',
      thinks: brain ? disk.brainName(disk.parseBrain(brain)) : null,
      history: this.db.all("SELECT seq, at, kind, data FROM events WHERE kind IN ('routine.fired', 'routine.skipped') AND json_extract(data, '$.routine') = ? ORDER BY seq DESC LIMIT 8", r.id)
        .map((e) => {
          const d = JSON.parse(e.data);
          const t = d.task ? this.db.get('SELECT state, result FROM tasks WHERE id = ?', d.task) : undefined;
          const line = d.task ? this.db.get("SELECT id FROM messages WHERE task_id = ? AND author = 'bot' ORDER BY id DESC LIMIT 1", d.task) : undefined;
          const made = d.task && this.db.get("SELECT 1 FROM events WHERE kind = 'file.delivered' AND json_extract(data, '$.task') = ? AND json_extract(data, '$.input') IS NULL AND json_extract(data, '$.path') NOT LIKE 'files/from-%'", d.task);
          return { at: e.at, kind: e.kind, ...d, state: t?.state,
            ...(t?.state === 'paused' || t?.state === 'failed' || t?.state === 'unsure' ? { reason: t.result } : {}),
            ...(t?.result === ALL_CLEAR_RESULT ? { clear: true } : {}),
            ...(t?.state === 'done' && made ? { thing: d.task } : {}), ...(t?.state === 'done' && line ? { msg: line.id } : {}) };
        }),
    }));
  }

  private routine(id: number) {
    const r = this.db.get('SELECT * FROM routines WHERE id = ?', id);
    if (!r) throw Object.assign(new Error('no such routine'), { status: 404 });
    return r;
  }

  /** The morning digest is on from the start; the person can move or pause it, not delete it. */
  private ensureDigest() {
    if (this.db.get("SELECT 1 FROM routines WHERE kind = 'digest'")) return;
    this.db.run("INSERT INTO routines (bot, name, schedule, kind, next_at, created_at) VALUES (?, 'Morning digest', 'every day 8:00', 'digest', ?, ?)",
      CHIEF, nextRun(parseSchedule('every day 8:00'), Date.now()), Date.now());
  }

  /** Check a routine request and fill in its defaults — the one plan behind Chief's confirmation card and the person's own add.
   *  A routine starts on its schedule, on its local event (`on`), or either when both are given; a trigger-only
   *  routine keeps no time at all. Nothing runs until the person says yes on the card. */
  private planRoutine(b: { bot?: string; schedule?: string; on?: string; task?: string; model?: string; name?: string; quiet?: boolean; watch?: string }) {
    const bot = this.bot(String(b.bot ?? '').toLowerCase());
    if (!bot || bot.id === CHIEF) throw Object.assign(new Error(`no bot called ${b.bot}; a routine hands a task to one of the crew`), { status: 404 });
    // A watch: crewd reads the page on schedule and wakes the helper only when it changed.
    const watch = b.watch ? String(b.watch).trim() : null;
    if (watch && !/^https?:$/.test(URL.canParse(watch) ? new URL(watch).protocol : '')) throw fail('a page to watch starts with https://');
    const on = b.on ? String(b.on).trim() : null;
    if (on) parseTrigger(on); // plain words back when it can't be read as a local event
    const body = String(b.task ?? '').trim() || (watch ? 'Tell the person what changed on the page, in one or two lines.' : '');
    if (!body) throw Object.assign(new Error('say what the routine should do'), { status: 400 });
    const schedule = String(b.schedule ?? '').trim();
    if (!schedule && !on) throw Object.assign(new Error('say when it should run, or what should start it'), { status: 400 });
    const when = schedule ? paced(parseSchedule(schedule)) : null;
    const brain = b.model ? disk.brainKey(disk.parseBrain(b.model)) : null;
    const first = body.split(/\n|(?<=[.!?])\s/)[0].replace(/[.!?]$/, '');
    const name = String(b.name ?? '').trim().slice(0, 60) || (watch && !b.task ? new URL(watch).hostname.replace(/^www\./, '') : short(first, 60));
    return { bot, watch, body, when, on, brain, first, name, quiet: b.quiet === true || !!watch };
  }

  /** A routine added by the person or Chief runs on the person's accounts. */
  addRoutine(b: { bot?: string; schedule?: string; on?: string; task?: string; model?: string; name?: string; quiet?: boolean; watch?: string }, by: string) {
    const plan = this.planRoutine(b);
    const words = [plan.when ? describe(plan.when) : '', plan.on ? describeTrigger(parseTrigger(plan.on), plan.bot.display) : ''].filter(Boolean).join('; ');
    return this.db.tx(() => {
      const r = this.db.run('INSERT INTO routines (bot, name, schedule, body, brain, quiet, watch, trigger, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        plan.bot.id, plan.name, String(b.schedule ?? '').trim(), plan.body, plan.brain, plan.quiet ? 1 : 0, plan.watch, plan.on, plan.when ? nextRun(plan.when, Date.now()) : null, Date.now());
      const row = this.routine(Number(r.lastInsertRowid));
      if (plan.on) mkdirSync(this.inbox(plan.bot.id), { recursive: true });
      this.db.event('routine.created', plan.bot.id, { routine: row.id, name: plan.name, words, by });
      if (by === CHIEF) this.say(CHIEF, 'system', `Routine added: “${plan.name}” for ${plan.bot.display}, ${words}.${plan.when ? ` First run ${clock(row.next_at)}.` : ''}`, null);
      return row;
    });
  }

  /** Chief's offer, in the person's plain words: cadence, what happens, quiet behaviour, first run. The routine is made
   *  only when the person says yes (`adopt`); `answer` applies a changed time first. A helper offers its own check-ins
   *  the same way, for the person. */
  private offerRoutine(p: Parameters<Crew['planRoutine']>[0]) {
    const plan = this.planRoutine(p);
    const host = plan.watch ? new URL(plan.watch).hostname.replace(/^www\./, '') : '';
    const what = plan.watch ? `Keeps an eye on ${host}` : `${plan.bot.display} will ${plan.first.charAt(0).toLowerCase()}${plan.first.slice(1)}`;
    const start = [plan.when ? describe(plan.when) : '', plan.on ? describeTrigger(parseTrigger(plan.on), plan.bot.display) : ''].filter(Boolean);
    const lines = [...start, what,
      plan.watch ? 'Tells you only when the page changes' : plan.quiet ? 'Tells you only when something changed' : 'Tells you each time it runs',
      ...(plan.when ? [`First time: ${clock(nextRun(plan.when, Date.now()))}`] : [])];
    const words = `${start.join('; ')}, ${what}.`;
    return this.propose(CHIEF, words, {
      routine: { bot: plan.bot.id, schedule: String(p.schedule ?? '').trim(), on: plan.on, task: p.task, name: p.name, model: p.model, quiet: p.quiet, watch: p.watch },
      preview: { head: 'A new routine', body: lines.join('\n') },
    });
  }

  /** Pause, resume or move a routine, or make it a quiet check-in. Resuming counts from now: a paused routine never catches up. */
  updateRoutine(id: number, b: { state?: string; schedule?: string; quiet?: boolean }) {
    const r = this.routine(id);
    if (b.quiet !== undefined) {
      if (typeof b.quiet !== 'boolean' || r.kind === 'digest') throw Object.assign(new Error('only a helper\'s routine can be a quiet check-in'), { status: 400 });
      this.db.run('UPDATE routines SET quiet = ? WHERE id = ?', b.quiet ? 1 : 0, id);
      if (b.state === undefined && b.schedule === undefined) return;
    }
    const state = b.state ?? r.state;
    if (!['on', 'paused'].includes(state)) throw Object.assign(new Error('a routine is on or paused'), { status: 400 });
    const schedule = b.schedule?.trim() || r.schedule;
    const next = schedule ? nextRun(paced(parseSchedule(schedule)), Date.now()) : null;
    this.db.tx(() => {
      this.db.run('UPDATE routines SET state = ?, schedule = ?, next_at = ? WHERE id = ?', state, schedule, next, id);
      this.db.event(state !== r.state ? `routine.${state === 'on' ? 'resumed' : 'paused'}` : 'routine.changed', r.bot, { routine: id, name: r.name,
        words: [schedule ? describe(parseSchedule(schedule)) : '', r.trigger ? describeTrigger(parseTrigger(r.trigger), this.bot(r.bot)?.display ?? r.bot) : ''].filter(Boolean).join('; ') });
    });
  }

  deleteRoutine(id: number) {
    const r = this.routine(id);
    if (r.kind === 'digest') throw Object.assign(new Error('the morning digest can be paused, not removed'), { status: 400 });
    this.db.tx(() => { this.db.run('DELETE FROM routines WHERE id = ?', id); this.db.event('routine.deleted', r.bot, { routine: id, name: r.name }); });
  }

  runRoutine(id: number) { this.fire(this.routine(id), 'now'); }

  /** Fire every routine that is due, and notice files arriving for event-started chores: one query, no AI until
   *  something actually starts. A machine that slept through runs catches up once (latest only), then moves on. */
  schedule(now = Date.now()) {
    for (const r of this.db.all("SELECT * FROM routines WHERE state = 'on' AND (next_at <= ? OR trigger IS NOT NULL)", now)) {
      if (r.trigger) { try { if ('file' in parseTrigger(r.trigger)) this.checkInbox(r); } catch (e) { console.error('trigger', r.id, e); } }
      if ((!r.schedule && r.kind !== 'once') || r.next_at > now) continue; // trigger-only: no time; wake triggers fire from slept(); a once reminder carries its time in next_at
      if (r.kind === 'once') this.db.run('DELETE FROM routines WHERE id = ?', r.id); // one-shot: gone as it fires
      else this.db.run('UPDATE routines SET next_at = ? WHERE id = ?', nextRun(parseSchedule(r.schedule), now), r.id);
      try { this.fire(r, now - r.next_at > 60_000 ? 'late' : 'schedule'); } catch (e) { console.error('routine', r.id, e); }
    }
  }

  /** The helper's inbox: the one watched folder a file trigger reads. Fixed per helper, so plain words never carry a path. */
  inbox(botId: string) { return join(disk.botDir(this.cfg, botId), 'files', 'inbox'); }

  /** A file trigger's check: names in the helper's inbox that were not there last tick start the chore once, through
   *  the same fire path as a time — the same task, approvals and share. The first look is the baseline, so files
   *  already sitting there never start it. */
  private checkInbox(r: Row) {
    const dir = this.inbox(r.bot);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const now = existsSync(dir) ? readdirSync(dir).filter((f) => f !== '.DS_Store').sort().slice(0, 500) : []; // ponytail: capped snapshot; an inbox past 500 names needs a real watcher
    const before: string[] | null = JSON.parse(r.cursor ?? 'null');
    this.db.run('UPDATE routines SET cursor = ? WHERE id = ?', JSON.stringify(now), r.id);
    const arrived = before ? now.filter((f) => !before.includes(f)) : [];
    if (arrived.length) this.fire(r, 'file', `New in ${this.bot(r.bot)?.display ?? r.bot}'s inbox: ${arrived.slice(0, 5).join(', ')}${arrived.length > 5 ? `, and ${arrived.length - 5} more` : ''}.`);
  }

  private sendDigest(r: Row, why: string, now: number, day?: { at: number | null; title: string }[]) {
    this.db.tx(() => { this.say(CHIEF, 'bot', this.digest(r.last_at ?? now - 86_400_000, day), null); this.db.run('UPDATE routines SET last_at = ? WHERE id = ?', now, r.id); this.db.event('routine.fired', CHIEF, { routine: r.id, name: r.name, why }); });
  }

  private fire(r: Row, why: 'schedule' | 'late' | 'now' | 'file' | 'wake', note?: string) {
    const now = Date.now();
    if (r.kind === 'digest') {
      // With Calendar connected, crewd reads today's events itself first; the digest still costs no AI.
      if (this.connections.connected('calendar')) {
        return void this.connections.today().catch(() => null).then((day) => this.sendDigest(r, why, now, day ?? undefined));
      }
      return this.sendDigest(r, why, now);
    }
    // Overlap: the last run is still going (or waiting on the person), so this one is skipped, not stacked. A last
    // run parked waiting on sign-in is not under way: it is retried instead, never silently skipped.
    const open = r.last_task && this.db.get("SELECT * FROM tasks WHERE id = ? AND state IN ('queued', 'working', 'needs_you', 'paused')", r.last_task);
    if (open) {
      if (why === 'now' && open.state === 'paused' && open.result === 'Waiting for tomorrow: the crew has had its share of your AI today.') {
        // A manual run is a new run: the one-hour clock restarts, or an hour-old task is killed the moment it starts,
        // told to the person as a false "took longer than an hour". The origin keeps the documented share bypass.
        this.db.run("UPDATE tasks SET origin = 'routine.now', wake_at = NULL, created_at = ? WHERE id = ?", Date.now(), open.id);
        this.setTask(open, 'queued');
        this.dispatch();
        return;
      }
      if (open.state === 'paused' && open.wake_at == null && /^Waiting for (you to sign in with .+|a .+ plan with helpers\.)$/.test(open.result ?? '')) {
        if (why === 'now') return void this.retryPaused(r, open, 'routine.now', why);
        void this.retryPausedWhenSignedIn(r, open, why);
        return;
      }
      this.db.event('routine.skipped', r.bot, { routine: r.id, name: r.name, why: 'overlap', task: r.last_task });
      return;
    }
    if (r.watch) return void this.check(r, why);
    const { task } = this.addTask(r.bot, note ? `${r.body}\n\n[Crewhouse] ${note}` : r.body, why === 'now' ? 'routine.now' : 'routine', r.brain ?? undefined, r);
    this.db.tx(() => {
      this.db.run('UPDATE routines SET last_at = ?, last_task = ? WHERE id = ?', now, task, r.id);
      this.db.event('routine.fired', r.bot, { routine: r.id, name: r.name, why, task });
    });
  }

  /** A manual run retries a sign-in-parked last run: the same task, queued again — never a second stacked task and
   *  never a silent skip. A scheduled tick retries it only once the person signed in since, and stays quiet either way. */
  private retryPaused(r: Row, open: Row, origin: string, why: 'schedule' | 'late' | 'now' | 'file' | 'wake') {
    const now = Date.now();
    this.db.run('UPDATE tasks SET origin = ?, created_at = ? WHERE id = ?', origin, now, open.id);
    this.setTask(open, 'queued');
    this.db.run('UPDATE routines SET last_at = ?, last_task = ? WHERE id = ?', now, open.id, r.id);
    this.db.event('routine.fired', r.bot, { routine: r.id, name: r.name, why, task: open.id });
    this.dispatch();
  }

  private async retryPausedWhenSignedIn(r: Row, open: Row, why: 'schedule' | 'late' | 'file' | 'wake') {
    try { if (!await this.usable(this.choices(open))) return; } catch { return; }
    try {
      const cur = this.db.get('SELECT state, wake_at FROM tasks WHERE id = ?', open.id);
      if (!cur || cur.state !== 'paused' || cur.wake_at != null) return;
      this.retryPaused(r, open, 'routine', why);
    } catch { /* a manual run beat the tick to it */ }
  }

  /** A watch's check: read the page, compare it with last time's, and hand the helper a task only when it changed.
   *  Nothing changed costs no AI at all. ponytail: readable text of a public page; a page behind a sign-in needs the
   *  helper's own browser, and a page whose text changes on every load (a clock, a visitor count) wakes it each time. */
  private async check(r: Row, why: string) {
    if (this.checking.has(r.id)) return;
    this.checking.add(r.id);
    const seen = (watch: string, task?: number) => this.db.tx(() => {
      this.db.run('UPDATE routines SET last_at = ?, last_task = COALESCE(?, last_task) WHERE id = ?', Date.now(), task ?? null, r.id);
      this.db.event('routine.fired', r.bot, { routine: r.id, name: r.name, why, watch, ...(task ? { task } : {}) });
    });
    try {
      let now: string;
      try { const page = await readPage(r.watch); if (page.status >= 400) throw new Error(String(page.status)); now = page.text.trim(); }
      catch { this.outage(r, true); return seen('unreachable'); }
      this.outage(r, false);
      const file = join(disk.botDir(this.cfg, r.bot), 'work', 'watch', `${r.id}.txt`);
      const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, now);
      if (before === null) return seen('started');
      if (before === now) return seen('same');
      const { task } = this.addTask(r.bot, `${r.body}\n\n[Crewhouse] The page you watch (${r.watch}) changed since the last check.\n${changed(before, now)}`,
        why === 'now' ? 'routine.now' : 'routine', r.brain ?? undefined, r);
      seen('changed', task);
    } finally { this.checking.delete(r.id); }
  }

  /** A watched page that won't open: one line on the second failure in a row (one timeout stays quiet), and one when it
   *  opens again. Not one per run. */
  private outage(r: Row, down: boolean) {
    const was = this.db.get('SELECT down FROM routines WHERE id = ?', r.id)?.down ?? 0;
    if (!down && !was) return;
    this.db.run('UPDATE routines SET down = ? WHERE id = ?', down ? was + 1 : 0, r.id);
    const line = down && was + 1 === 2 ? `I couldn't open the page for “${r.name}” twice now. It may be down, or need a sign-in. I'll keep trying, and tell you when it works again.`
      : !down && was >= 2 ? `The page for “${r.name}” opens again. I'm back to keeping an eye on it.` : '';
    if (!line) return;
    this.say(r.bot, 'bot', line, null);
    this.alert();
  }

  /** Chief's "while you were away" for the person: what finished, what needs them, what is coming up. No model call. */
  digest(since: number, day?: { at: number | null; title: string }[]) {
    const address = this.person().address;
    const name = (id: string) => this.bot(id)?.display ?? id;
    const list = (xs: string[]) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join('; ')} and ${xs.at(-1)}`;
    const done = this.db.all("SELECT * FROM tasks WHERE bot != ? AND state = 'done' AND updated_at >= ? AND COALESCE(result, '') != ? ORDER BY id", CHIEF, since, ALL_CLEAR_RESULT);
    const ended = (state: string) => this.db.all('SELECT * FROM tasks WHERE bot != ? AND state = ? AND updated_at >= ? ORDER BY id', CHIEF, state, since);
    const failed = ended('failed'), unsure = ended('unsure');
    const asks = this.db.all("SELECT * FROM asks WHERE state = 'open' ORDER BY id");
    const learned = this.db.all("SELECT bot, data FROM events WHERE kind = 'memory.learned' AND at >= ? ORDER BY seq", since);
    const soon = this.db.all("SELECT * FROM routines WHERE state = 'on' AND kind != 'digest' AND next_at <= ? ORDER BY next_at", Date.now() + 86_400_000);
    const scout = this.bots().find((b) => b.template === 'scout')?.id;
    const goal = scout && (disk.readNotes(this.cfg, { bot: scout }).split('\n').some((l) => l.replace(/^- /, '').startsWith('Goal:')) ||
      this.db.get('SELECT 1 FROM tasks WHERE bot = ?', scout));
    const lines = [`Good ${partOfDay()}${address ? `, ${address}` : ''}. While you were away:`];
    lines.push(done.length ? `- Finished: ${list(done.slice(0, 5).map((t) => `${name(t.bot)}, “${t.title}”`))}${done.length > 5 ? `, and ${done.length - 5} more` : ''}.` : '- Nothing new was finished.');
    if (failed.length) lines.push(`- Did not go well: ${list(failed.slice(0, 3).map((t) => `${name(t.bot)}, “${t.title}” (${String(t.result ?? '').slice(0, 80)})`))}.`);
    if (unsure.length) lines.push(`- Not sure it worked: ${list(unsure.slice(0, 3).map((t) => `${name(t.bot)}, “${t.title}” (${String(t.result ?? '').slice(0, 80)})`))}.`);
    lines.push(asks.length ? `- Needs you: ${list(asks.slice(0, 3).map((a) => a.title))}. It is under Needs you.` : '- Nothing needs you.');
    for (const l of learned.slice(0, 3)) lines.push(`- ${name(l.bot)} learned: ${JSON.parse(l.data).text}`);
    if (day) lines.push(day.length ? `- Today on your calendar: ${list(day.map((e) => e.at ? `${clock(e.at)}, ${e.title}` : `${e.title} (all day)`))}.` : '- Nothing on your calendar today.');
    lines.push(soon.length ? `- Coming up: ${list(soon.map((r) => `“${r.name}” with ${name(r.bot)}, ${clock(r.next_at)}`))}.` : '- Nothing is scheduled for the next day.');
    if (!goal) lines.push('- Want help starting something on the side? Tap to begin.');
    return lines.join('\n');
  }

  botPage(id: string, around?: number) {
    const b = this.needBot(id);
    const undone = new Set(this.db.eventsForBot(id, ['memory.undone'], 10000).map((e) => e.data.seq));
    return {
      bot: this.pub(b),
      job: disk.readJob(this.cfg, id),
      // A search landing on an old line gets a window around it: the newest 200 would miss it entirely.
      phoneOffer: id === CHIEF && !around ? (() => {
        const value = this.db.get("SELECT value FROM settings WHERE key = 'phone.offer.1'")?.value;
        if (!value) return null;
        const offer = JSON.parse(value);
        const waiting = this.phoneLink?.status().asking.find((a) => a.offer === offer.token);
        return { ...offer, waiting };
      })() : null,
      messages: (around
        ? this.db.all(`SELECT * FROM (
            SELECT * FROM (SELECT * FROM messages WHERE bot = ? AND id >= ? ORDER BY id LIMIT 100)
            UNION ALL
            SELECT * FROM (SELECT * FROM messages WHERE bot = ? AND id < ? ORDER BY id DESC LIMIT 99)
          ) ORDER BY id`, id, around, id, around)
        : this.db.all('SELECT * FROM (SELECT * FROM messages WHERE bot = ? ORDER BY id DESC LIMIT 200) ORDER BY id', id))
        .map((m: Row): Row => ({ ...m, text: cleanReply(m.text),
          files: id === CHIEF && m.author === 'bot' && m.task_id
            ? this.db.all("SELECT bot, data FROM events WHERE kind = 'file.delivered' AND json_extract(data, '$.task') IN (SELECT id FROM tasks WHERE root = (SELECT COALESCE(root,id) FROM tasks WHERE id = ?)) AND json_extract(data, '$.input') IS NULL AND json_extract(data, '$.path') NOT LIKE 'files/from-%'", m.task_id)
              .map((e) => ({ bot: e.bot, path: JSON.parse(e.data).path })) : [],
          // Chief's hand-off in a helper's chat collapses to its task's title, with the full words behind Show details.
          ...(id !== CHIEF && m.author === 'chief' && m.task_id ? { title: this.db.get('SELECT title FROM tasks WHERE id = ?', m.task_id)?.title } : {}) })),
      tasks: this.db.all('SELECT * FROM tasks WHERE bot = ? ORDER BY id DESC LIMIT 50', id).map((t) => this.task(t)),
      // What this helper learned about the person.
      notes: disk.readNotes(this.cfg, { bot: id }),
      notesCap: disk.NOTES_CAP,
      soul: disk.readSoul(this.cfg, id),
      soulCap: disk.SOUL_CAP,
      skills: disk.listSkills(this.cfg, id),
      tools: disk.botTools(this.cfg, id),
      files: disk.listFiles(this.cfg, id, new Set(this.db.all(`SELECT json_extract(e.data, '$.path') AS path FROM events e JOIN tasks t ON t.id = json_extract(e.data, '$.task')
        WHERE e.bot = ? AND e.kind = 'file.delivered'`, id).map((e) => String(e.path).replace(/^files\//, '')))),
      trail: this.db.eventsForBot(id, TRAIL).map((e) => ({ ...e, ...(e.kind === 'memory.learned' && undone.has(e.seq) ? { undone: true } : {}) })),
      // Standing answers in plain words; taking one back sends the words back.
      allow: (disk.botConfig(this.cfg, id).allow ?? []).map(coversOf),
      memory: disk.botConfig(this.cfg, id).memory !== false,
      handoff: disk.botConfig(this.cfg, id).handoff ?? 'go',
      // The sites the person signed it in to (bare hosts), shown in Details, each with Forget.
      signedIn: disk.botConfig(this.cfg, id).signedIn ?? [],
    };
  }

  private screenOf(id: string) {
    const d = this.desktops.info(id);
    return { controls: this.held.has(id) ? 'person' : 'bot', desktop: d && { watching: d.watching, control: d.control }, computer: disk.canUse(this.cfg, id, 'computer') };
  }

  // ---- people ----
  /** First meeting: the person tells Chief how to be addressed. Stored per person, used by every bot. */
  onboard(address: string, ask?: string, bot?: string): { task: number } | void {
    const a = needText(address, 40, 'say how Chief should address you');
    const hello = ask?.trim();
    let to = CHIEF;
    if (hello) {
      // A Hello goal tap starts in its helper's thread: hired silently when the person's account runs
      // helpers, or with Chief when it names no template or the plan has none.
      try {
        const t = disk.loadTemplate(this.cfg, bot ?? '');
        const hired = this.bots().find((b) => b.template === t.id)?.id;
        const brains = hired ? disk.brains(this.cfg, hired) : (t.models ?? ['chatgpt']).map(disk.parseBrain);
        if (brains.some((b) => !this.accounts.unready(b.provider) && !this.accounts.notIncluded(b.provider))) to = hired ?? this.recruit(t.id, undefined, 'person').id;
      } catch { /* Chief */ }
    }
    // The address is already stored in people; the Hello screen already greeted her, so the thread starts empty and renders ChiefIdeas.
    this.db.tx(() => {
      this.db.run("DELETE FROM messages WHERE bot = ? AND author = 'bot'", CHIEF);
      this.db.run('UPDATE people SET address = ?, onboarded = 1 WHERE id = 1', a);
      this.db.event('person.onboarded', null, { address: a });
    });
    if (hello) return this.addTask(to, hello, 'person', undefined);
  }

  /** The person's name, how Chief addresses them, quiet hours ("22:00-07:00", or null for none) and the crew's share. */
  updatePerson(body: { name?: unknown; address?: unknown; quiet?: unknown; share?: unknown }) {
    this.person();
    if (body.name !== undefined) {
      const n = needText(body.name, 32, 'give yourself a name');
      this.db.run('UPDATE people SET name = ? WHERE id = 1', n);
    }
    if (body.quiet !== undefined) {
      if (body.quiet !== null && !(typeof body.quiet === 'string' && /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(body.quiet))) {
        throw Object.assign(new Error('quiet hours look like 22:00-07:00'), { status: 400 });
      }
      this.db.run('UPDATE people SET quiet = ? WHERE id = 1', body.quiet);
    }
    if (body.share !== undefined) {
      if (!(typeof body.share === 'string' && body.share in SHARES)) throw fail('the crew\'s share is light, normal or full');
      this.db.run('UPDATE people SET share = ? WHERE id = 1', body.share);
    }
    if (body.address !== undefined) this.setAddress(String(body.address));
    this.db.event('person.updated', null);
    return this.person();
  }

  // ---- crew ----
  private addBot(tpl: disk.Template, display: string, id: string, by: string) {
    disk.createBotFolder(this.cfg, id, tpl, display);
    this.db.run('INSERT INTO bots (id, display, role, template, color, token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, display, tpl.role, tpl.id, tpl.color, randomBytes(16).toString('hex'), Date.now());
    this.db.event('bot.recruited', id, { display, template: tpl.id, by });
  }

  /** The bot, or a 404. */
  private needBot(id: string) {
    const b = this.bot(id);
    if (!b) throw fail('no such bot', 404);
    return b;
  }

  /** The person or Chief can recruit a helper. */
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
  /** A message in the person's thread with a bot. */
  say(bot: string, author: string, text: string, taskId: number | null = null) {
    if (author === 'bot') text = cleanReply(text);
    const id = Number(this.db.run('INSERT INTO messages (bot, author, text, task_id, at) VALUES (?, ?, ?, ?, ?)', bot, author, text, taskId, Date.now()).lastInsertRowid);
    this.db.event('message', bot, { id, author, text: text.slice(0, 280) });
    return id;
  }

  /** A person's message in a bot's thread is a task for that bot; in Chief's thread it goes where `route` says. */
  /** `photos` from the phone or the share sheet: the helper sees them with the words, and they are kept in its files. */
  async post(botId: string, text: string, model?: string, photos?: unknown, room = false, key?: string) {
    const bot = this.bot(botId);
    if (!bot) throw Object.assign(new Error('no such bot'), { status: 404 });
    const pics = checkPhotos(photos);
    if (!text.trim() && !pics.length) throw Object.assign(new Error('empty message'), { status: 400 });
    const words = text.trim() || (pics.length === 1 ? 'Here is a photo.' : 'Here are some photos.');
    if (botId === CHIEF && !this.person().onboarded) { this.say(CHIEF, 'person', words, null); return this.onboard(words); }
    if (botId === CHIEF && !pics.length && (asksForPhone(words) || inlineHowTo(words) === 'signin' || inlineHowTo(words) === 'app')) {
      this.say(CHIEF, 'person', words, null);
      if (asksForPhone(words)) { await this.addPhone(); return; }
      if (inlineHowTo(words) === 'signin') { this.say(CHIEF, 'bot', 'Sign in with ChatGPT.', null); return; }
      const app = /\b(calendar|gmail|drive|notion|canva)\b/i.exec(words)?.[1].toLowerCase() ?? 'calendar';
      this.say(CHIEF, 'bot', `Connect ${this.connections.apps[app].name}.`, null);
      if (!this.connections.connected(app)) this.openAsk(CHIEF, undefined, `Connect ${this.connections.apps[app].name}`, { app, words: `Connect your ${this.connections.apps[app].name}` }, 'connect');
      return;
    }
    if (botId === CHIEF) return this.route(words, model, pics, room, key);
    const latest = room ? this.db.get('SELECT root FROM tasks WHERE room = 1 AND bot = ? ORDER BY id DESC LIMIT 1', botId) : undefined;
    return this.addTask(botId, words, 'person', model, undefined, words, pics, { room, root: latest?.root, key });
  }

  /** One pairing offer, using the same one-use code as Settings. Never give its ticket to a model. */
  private async addPhone() {
    if (!this.phoneLink) throw fail('Phone pairing is not ready yet', 503);
    const token = randomBytes(16).toString('hex');
    const { qr, typed, expires } = await this.phoneLink.offer('control', token);
    const message = this.say(CHIEF, 'bot', 'Open Crewhouse on your phone and scan this, or type the code.', null);
    this.db.run("INSERT INTO settings (key, value) VALUES ('phone.offer.1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ qr, typed, expires, message, token }));
    return { shown: true }; // the model never sees the one-use ticket
  }

  /** Refresh the currently displayed offer; an old card cannot replace a newer one. */
  async refreshPhone(message: number) {
    const old = JSON.parse(this.db.get("SELECT value FROM settings WHERE key = 'phone.offer.1'")?.value ?? 'null');
    if (!old || old.message !== message || old.joined) throw fail('that code is no longer showing', 409);
    if (!this.phoneLink) throw fail('Phone pairing is not ready yet', 503);
    const token = randomBytes(16).toString('hex');
    const { qr, typed, expires } = await this.phoneLink.offer('control', token);
    const offer = { qr, typed, expires, message, token };
    this.db.run("UPDATE settings SET value = ? WHERE key = 'phone.offer.1'", JSON.stringify(offer));
    return offer;
  }

  /** A targeted request that must stay with Chief rather than pass through helper routing. */
  requestChief(text: string, said?: string) {
    if (!text.trim()) throw Object.assign(new Error('empty message'), { status: 400 });
    // The thread shows the person's own words (`said`), never crewd's instruction to the model.
    return this.addTask(CHIEF, text.trim(), 'person', undefined, undefined, said?.trim() ? said.trim() : text.trim());
  }

  /** Plainly addressed helper requests go straight there; unresolved requests become Chief tasks immediately.
   *  Chief can ask or hand off in his task, without a separate model turn delaying the person's first words. */
  private async route(text: string, model: string | undefined, pics: Photo[] = [], room = false, key?: string) {
    const helpers = this.bots().filter((b) => b.id !== CHIEF) as Helper[];
    const lastBot = this.db.get("SELECT text, task_id, at FROM messages WHERE bot = ? AND author = 'bot' ORDER BY id DESC LIMIT 1", CHIEF);
    const replyTo = text.length < 120 && !/\[tool\b/.test(text) && lastBot && lastBot.task_id && lastBot.at > Date.now() - 30 * 60_000 && /\?\s*$/.test(lastBot.text)
      ? this.db.get('SELECT bot, body FROM tasks WHERE id = ?', lastBot.task_id) : undefined;
    if (replyTo?.bot === CHIEF) return this.addTask(CHIEF, text, 'person', model, undefined, text, pics, { room, key });
    // An answer to a helper's question skips routing and Chief: a fresh task carrying the question and its answer.
    if (replyTo && lastBot && replyTo.bot !== CHIEF && this.bot(replyTo.bot)) {
      const r = this.addTask(replyTo.bot, `${replyTo.body}\nAsked: ${lastBot.text}\nAnswer: ${text}`, CHIEF, model, undefined, text, pics, { room, key });
      this.say(CHIEF, 'person', text + r.shown, null);
      return { task: r.task };
    }
    const previous = this.db.get("SELECT text FROM messages WHERE bot = ? AND author = 'person' ORDER BY id DESC LIMIT 1", CHIEF)?.text as string | undefined;
    const earlier: string | undefined = /^https?:\/\/\S+$/i.test(text) && previous && /\b(market|marketing|promote|launch)\b/i.test(previous) ? previous : undefined;
    const body = earlier ? `${earlier}\n${text}` : text;
    const to = await route({ text, earlier }, helpers);
    // A spreadsheet the rules miss goes straight to Scribe, hired silently when the person's account can run helpers.
    const helper = (!to.abstained && helpers.find((b) => b.id === to.answer))
      || (/\b(excel|spreadsheet|xlsx|workbook|tracker)\b/i.test(body) && !chiefWork.test(body)
        && await this.usable(this.choices({ bot: 'scribe' } as Row)) && (this.bots().find((b) => b.template === 'scribe') ?? this.recruit('scribe', undefined, 'person')));
    if (!helper) return this.addTask(CHIEF, body, 'person', model, undefined, text, pics, { room, key });
    const r = this.addTask(helper.id, body, CHIEF, model, undefined, body, pics, { room, key });
    this.say(CHIEF, 'person', text + r.shown, null);
    this.say(CHIEF, 'bot', `${helper.display} is on it.`, null);
    return { task: r.task };
  }

  /** `model` picks the AI account for this one task (a cheap one for bulk steps, a strong one for judgment). */
  assign(botId: string, text: string, by: string, model?: string, title?: string) {
    if (!this.bot(botId)) throw Object.assign(new Error(`no bot called ${botId}; see crew roster`), { status: 404 });
    if (botId === CHIEF) throw Object.assign(new Error('Chief cannot assign to himself'), { status: 400 });
    // Chief's hand-offs run on the person's accounts.
    return this.addTask(botId, text.trim(), by, model, undefined, text.trim(), [], { parent: by === CHIEF ? this.activeTask(CHIEF)?.id : undefined, title });
  }

  /** Chief's job of several `steps` goes on a plan card first and starts on Go; the gate still asks every send, spend or change. */
  private plan(botId: string, text: string, model?: string, title?: string, steps?: unknown) {
    const plan = (Array.isArray(steps) ? steps : typeof steps === 'string' ? steps.split('\n') : [])
      .map((x) => String(x).replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);
    if (plan.length < 2 || !this.bot(botId) || botId === CHIEF) return this.assign(botId, text, CHIEF, model, title);
    if (plan.length > 10 || plan.some((x) => x.length > 300)) throw fail('keep the plan to ten short steps');
    const what = taskTitle(title || text);
    this.propose(CHIEF, `Here’s the plan for “${what}”. ${this.bot(botId)!.display} starts when you say Go.`,
      { plan: { bot: botId, text: text.trim(), model, title: what, steps: plan }, preview: { body: plan.map((x, i) => `${i + 1}. ${x}`).join('\n') } });
    return { asked: true, note: 'The person sees your plan on a card. Nothing starts until they say Go; do not assign it again.' };
  }

  /** `said` is what the thread shows, when it isn't the whole body. */
  private addTask(bot: string, body: string, origin: string, model: string | undefined, routine?: Row, said = body, pics: Photo[] = [], link: { parent?: number; root?: number; room?: boolean; hops?: number; title?: string; key?: string } = {}) {
    const brain = model ? disk.brainKey(disk.parseBrain(model)) : null;
    const title = routine?.name ? short(routine.name, 80) : link.title ? taskTitle(link.title) : taskTitle(body);
    let shown = '';
    // A replayed phone request answers with its first result (the claim below lands in the same transaction as the task).
    if (link.key) {
      const prior = this.db.get('SELECT value FROM settings WHERE key = ?', `link.key.${link.key}`)?.value as string | undefined;
      if (prior) return JSON.parse(prior);
    }
    const id = this.db.tx(() => {
      const now = Date.now();
      const r = this.db.run('INSERT INTO tasks (bot, title, body, origin, state, created_at, updated_at, brain, routine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        bot, title, body, origin, 'queued', now, now, brain, routine?.id ?? null);
      const id = Number(r.lastInsertRowid);
      const parent = link.parent ? this.db.get('SELECT root, room FROM tasks WHERE id = ?', link.parent) : undefined;
      this.db.run('UPDATE tasks SET parent = ?, root = ?, room = ?, hops = ? WHERE id = ?', link.parent ?? null, link.root ?? parent?.root ?? id, Number(link.room ?? !!parent?.room), link.hops ?? 0, id);
      // Photos are kept in the helper's files (so they show in the person's Things) and shown in the chat by that path.
      const kept = pics.map((p, i) => {
        const rel = `files/photos/${id}-${i + 1}.${p.ext}`;
        mkdirSync(join(disk.botDir(this.cfg, bot), 'files', 'photos'), { recursive: true });
        writeFileSync(join(disk.botDir(this.cfg, bot), rel), p.bytes);
        this.db.event('file.delivered', bot, { task: id, path: rel, note: 'your photo', size: p.bytes.length, photo: true });
        return rel;
      });
      if (kept.length) this.db.run('UPDATE tasks SET photos = ? WHERE id = ?', JSON.stringify(kept), id);
      shown = kept.map((k) => `\n[photo ${bot}] ${k}`).join('');
      // The thread shows the routine's own words, never Crewhouse's note to the bot (a watch's page and its before and after).
      if (routine) this.say(bot, 'system', `${routine.watch ? `“${routine.name}”: the page changed` : `Routine “${routine.name}”`}: ${body.split('\n\n[Crewhouse]')[0]}`, id);
      else this.say(bot, origin === 'person' ? 'person' : origin, said + shown, id);
      this.db.event('task.created', bot, { task: id, origin, title });
      if (link.key) this.db.run('INSERT INTO settings (key, value) VALUES (?, ?)', `link.key.${link.key}`, JSON.stringify({ task: id, shown }));
      return id;
    });
    if (bot === CHIEF) this.db.live('reply.partial', CHIEF, { task: id, text: chiefFirst(body) });
    queueMicrotask(() => this.dispatch());
    return { task: id, shown };
  }

  private setTask(task: Row, state: string, result?: string) {
    if (state === 'done' || state === 'failed' || state === 'unsure') {
      this.taskGrants.delete(task.id);
      if (this.checkouts.get(task.bot)?.task === task.id) this.checkouts.delete(task.bot);
    }
    this.db.run('UPDATE tasks SET state = ?, result = COALESCE(?, result), updated_at = ? WHERE id = ?', state, result ?? null, Date.now(), task.id);
    this.db.event(`task.${state}`, task.bot, { task: task.id, title: task.title, ...(result ? { result: result.slice(0, 280) } : {}) });
    if (state === 'failed' && result && result !== STOPPED) this.failedLine(task, result);
    if (state === 'unsure') this.failedLine(task, result!, true);
    if (['done', 'failed', 'unsure'].includes(state)) this.wrap(task.root ?? task.id);
  }

  /** The photos sent with a task, for its first prompt: the helper sees them. */
  private images(bot: string, task: Row) {
    const paths: string[] = task.photos ? JSON.parse(task.photos) : [];
    return paths.flatMap((rel) => {
      const full = join(disk.botDir(this.cfg, bot), rel);
      if (!existsSync(full)) return [];
      const ext = rel.split('.').pop()!;
      return [{ type: 'image' as const, data: readFileSync(full).toString('base64'), mimeType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` }];
    });
  }

  /** A job that didn't work always says so, in words crewd writes: a routine's in Chief's thread (with when it
   *  tries again), anything else in its own chat. Never silent, and never a model call. A job that acted but couldn't
   *  confirm it worked (`unsure`) says so the same way: not sure is never reported as done. */
  private failedLine(task: Row, result: string, unsure = false) {
    const b = this.bot(task.bot)?.display ?? task.bot;
    const r = task.routine && this.db.get('SELECT * FROM routines WHERE id = ?', task.routine);
    if (r) {
      if (unsure) return void this.say(CHIEF, 'bot', `${b} isn't sure “${r.name}” worked. ${result}`, null);
      const again = r.state === 'on' && r.next_at ? ` It will try again ${clock(r.next_at)}.` : '';
      return void this.say(CHIEF, 'bot', `${b} couldn't finish “${r.name}”. ${result}${again}`, null);
    }
    this.say(task.bot, 'bot', unsure ? `${UNSURE} ${result}` : result, task.id);
    this.alert();
  }

  /** A line in a helper's chat that the person should hear about even with the app closed: the phone gets a push. */
  private alert() { this.db.event('alert', null); }

  private prompt(task: Row) {
    const who = task.origin === 'person' ? this.called() : task.origin === CHIEF ? 'Chief' : this.bot(task.origin)?.display ?? task.origin;
    const r = task.routine && this.db.get('SELECT name, quiet FROM routines WHERE id = ?', task.routine);
    const routine = r?.name;
    // A quiet check-in only speaks up when something needs the person.
    const quiet = r?.quiet ? `\n\n[Crewhouse] This is a check-in. If nothing needs ${who}, reply exactly ${ALL_CLEAR} and nothing else.` : '';
    // The debrief: the bot proposes what to keep; crewd caps it, commits it and offers Undo.
    const debrief = disk.botConfig(this.cfg, task.bot).memory === false ? '' : `\n\n[Crewhouse] When you finish: if this task showed you a lasting preference of ${who} (not how to address them; Crewhouse keeps that), ` +
      'call crew_remember with `text` set to one short line (and `replaces` naming an old note to correct one). Set `everyone` when every helper should know it ' +
      '(family, diet, units, where they live); leave it out for how they like your own work. Otherwise save nothing.';
    // A new job in a chat often answers the last thing said there ("OK, post it"): a new session carries that line.
    const said = task.origin === 'person' && task.bot !== CHIEF && this.db.get("SELECT text FROM messages WHERE bot = ? AND author = 'bot' AND COALESCE(task_id, 0) != ? AND at > ? ORDER BY id DESC LIMIT 1", task.bot, task.id, Date.now() - 2 * 86_400_000)?.text;
    const last = said ? `[Crewhouse] Your last message in this chat, which this may answer: “${short(said, 800)}”\n` : '';
    if (task.bot !== CHIEF) return `${this.memory(task.bot)}${last}[Crewhouse task #${task.id} from ${routine ? `the routine “${routine}”, set up by ${this.called()}` : who}]\n${task.body}${quiet}${debrief}`;
    // The crew by name only: crew_roster already lists roles, busy state and recruitable templates on demand,
    // so the standing prompt need not carry them (and their staleness) on every turn.
    const crew = this.bots().filter((b) => b.id !== CHIEF)
      .map((b) => `${b.display} (id ${b.id})`).join('; ') || 'nobody yet';
    const history = this.db.all("SELECT author, text FROM messages WHERE bot = ? AND id < (SELECT MIN(id) FROM messages WHERE task_id = ?) ORDER BY id DESC LIMIT 6", CHIEF, task.id)
      .reverse().map((m) => `${m.author === 'person' ? 'Person' : 'Chief'}: ${short(String(m.text).split('[tool ')[0], 300)}`).join('\n').slice(0, 1500);
    return `${this.memory(task.bot)}[Crewhouse] Crew: ${crew}.\n${history ? `Earlier in this chat:\n${history}\n` : ''}The person says: ${task.body}`;
  }

  /** What the crew actually finished: titles and delivered files, for Chief's crew_status. */
  private finishedList() {
    const rows = this.db.all("SELECT id, bot, title FROM tasks WHERE bot != ? AND state = 'done' AND updated_at >= ? AND COALESCE(result, '') != ? ORDER BY id DESC LIMIT 10", CHIEF, Date.now() - 30 * 86_400_000, ALL_CLEAR_RESULT);
    return rows.map((t) => {
      const files = this.taskFiles(t.id);
      return {
        bot: this.bot(t.bot)?.display ?? t.bot,
        title: short(t.title.split('[tool')[0].trim() || t.title, 80),
        note: files.map((f) => short(String(f.note ?? '').split('[tool')[0].trim(), 140)).find(Boolean) ?? '',
        files: files.map((f) => String(f.path).replace(/^files\//, '')).filter((p) => !p.startsWith('photos/')).slice(0, 3),
      };
    });
  }

  /** How to address the person, what the whole crew knows about them, and this bot's own notes on them: read at the start of
   *  every task, so a correction lands at once. The files stay at people/1. */
  private memory(id: string) {
    const on = disk.botConfig(this.cfg, id).memory !== false;
    const about = on ? disk.readNotes(this.cfg, { bot: null }).trim() : '';
    const notes = on ? disk.readNotes(this.cfg, { bot: id }).trim() : '';
    return `[Crewhouse] ${disk.addressLine(this.person().address)}` +
      `${about ? `\nWhat the whole crew knows about the person:\n${about}` : ''}` +
      `${notes ? `\nYour notes (what you have learned about how they like your work):\n${notes}` : ''}\n\n`;
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

  /** Start (or continue) a task in its own engine session, on the person's accounts. */
  private async run(task: Row) {
    const bot = this.bot(task.bot)!;
    try {
      const choices = this.choices(task);
      const brain = await this.usable(choices);
      if (!brain) return this.pause(task, choices);
      if (task.origin === 'routine' && this.overShare()) return this.waitForTomorrow(task);
      this.setTask(task, 'working');
      if (this.runtime.memoryLimited?.()) {
        const key = 'memory.limited.1';
        if (!this.db.get('SELECT 1 FROM settings WHERE key = ?', key)) {
          this.say(bot.id, 'system', 'Memory features are limited: no subscription-backed or local search is set up. Keyword search still works; no paid search was tried.', task.id);
          this.db.run('INSERT INTO settings (key, value) VALUES (?, ?)', key, 'shown');
        }
      }
      const handoff = this.handoffs.get(task.id);
      this.handoffs.delete(task.id);
      const resumes = !!task.session && task.session.startsWith('agent:m1:');
      const l = await this.open(bot, task, brain);
      this.db.run("UPDATE bots SET state = 'on' WHERE id = ?", bot.id);
      this.db.event('run.started', bot.id, { task: task.id, account: brain.provider, name: disk.brainName(brain) });
      if (handoff && resumes) this.db.event('run.resumed', bot.id, { task: task.id, why: handoff });
      if (handoff && handoff !== 'Crewhouse restarted') this.say(bot.id, 'system', `${handoff}. ${bot.display} carries on${this.connected.delete(task.id) ? '' : ` with ${disk.brainName(brain)}`}.`, task.id);
      this.turn(bot.id, l, resumes ? `[Crewhouse] ${handoff ?? 'You were interrupted'}. Continue task #${task.id} where you left off; ` +
        'check work/ and files/ before redoing anything.' : this.prompt(task), resumes ? undefined : this.images(bot.id, task));
    } catch (e: any) {
      console.error(`run ${bot.id} #${task.id}:`, e);
      this.close(bot.id);
      this.setTask(task, 'failed', `${bot.display} couldn't start this one. Try again in a moment.`);
    } finally {
      this.starting.delete(bot.id);
      this.dispatch();
    }
  }

  /** A helper whose template lists the only hosts it may reach: its list and its proxy's socket. Every refusal is an event,
   *  so an attempt is seen. The list comes from the template in the repo, never from the bot's own folder, which it can write. */
  private netOf(botId: string) {
    let list: string[] | undefined;
    try { list = disk.loadTemplate(this.cfg, this.bot(botId)?.template ?? '').net; } catch { /* no template: not fenced */ }
    if (!list) return undefined;
    const sock = join(this.cfg.stateDir, 'net', `${botId}.sock`);
    if (!this.nets.has(botId)) {
      mkdirSync(dirname(sock), { recursive: true });
      rmSync(sock, { force: true });
      this.nets.set(botId, proxy(sock, list, (host, port) => this.refusedNet(botId, `${host}:${port}`)));
    }
    return { list, sock, may: (u: URL) => allowed(list!, u.hostname, Number(u.port || (u.protocol === 'http:' ? 80 : 443))) || (this.refusedNet(botId, u.host), false) };
  }
  private refusedNet(botId: string, to: string) { this.db.event('net.refused', botId, { task: this.activeTask(botId)?.id, to: to.slice(0, 260) }); }

  /** A run's setup: the bot's folder as its space, its granted tools behind crewd's gate, its own session key. */
  private async open(bot: Row, task: Row, brain: disk.Brain) {
    this.close(bot.id);
    const space = disk.botDir(this.cfg, bot.id);
    const conf = disk.botConfig(this.cfg, bot.id);
    const g = resolveGrants(this.cfg, conf.tools ?? [], { 'bot.dir': space, 'bot.id': bot.id });
    const net = this.netOf(bot.id);
    const l = { key: `agent:m1:crewhouse:${bot.id}:${task.id}`, task: task.id, account: brain.provider, model: brain.model, grants: g.tools } as Live;
    // The bot's shell: bubblewrap, where its space is the only writable part of the disk.
    if (g.tools.includes('files') && sandboxReady()) l.shell = bashTool(space, [this.cfg.toolsDir], { ...g.env, PATH: toolBin(this.cfg) }, net?.sock);
    // The person's connected apps (their Notion, their Google…): every helper working for them can use them, through the gate.
    const apps = await this.connections.tools();
    l.apps = apps.effects;
    l.appTools = new Map(apps.tools.map((t) => [t.name, t]));
    const axi = g.axi.browser;
    if (axi) {
      // With its own computer, the browser tool drives the visible Chromium crewd keeps on the bot's display.
      const onScreen = g.tools.includes('computer') && !!browserBin() && this.cfg.engine !== 'stub';
      if (onScreen) await this.desktops.ensure(bot.id, bot.n, space);
      // Its own HOME and XDG folders (the playwright daemon's state lives there), never the person's.
      const env = axiEnv(join(this.cfg.stateDir, 'homes', bot.id), { ...axi.env, PLAYWRIGHT_CLI_SESSION: bot.id });
      const run = (args: string[], signal?: AbortSignal) => runAxi(axi.script, args, space, env, signal);
      // The browser starts on first use. ponytail: a crewd that dies leaves a headless browser up until that bot's next
      // task reopens it; an idle timeout when the engine has one.
      let started: Promise<string> | undefined;
      const start = async () => {
        const cdp = onScreen ? (await this.desktops.ensure(bot.id, bot.n, space)).cdp : undefined;
        return run(cdp ? ['attach', '--cdp', cdp] : ['open', '--persistent', '--profile', join(space, 'browser')]);
      };
      l.browser = {
        run,
        end: () => { if (started) void run([onScreen ? 'detach' : 'close']); },
        release: () => { if (started && onScreen) { started = undefined; void run(['detach']); } },
      };
      l.browserTool = tool('browser', 'Your own browser (playwright-axi): goto <url>, snapshot, find <text>, click <ref>, fill <ref> <text>, press <key>, go-back',
        { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'], additionalProperties: false },
        async (p, signal) => {
          started ??= start();
          const opened = await started;
          if (/^error:/m.test(opened)) { started = undefined; return opened; }
          const out = await run((p.args ?? []).map(String), signal);
          const page = /^page: \{url: ([^,}\s]+)/m.exec(out)?.[1];
          if (page) l.page = page;
          return out;
        });
    }
    this.live.set(bot.id, l);
    return l;
  }

  private close(botId: string) {
    const l = this.live.get(botId);
    if (!l) return;
    this.live.delete(botId);
    this.busy.delete(botId);
    l.browser?.end();
    void this.runtime.abort(l.key).catch(() => {});
  }

  /** One turn: the prompt goes into the run's session, and when it settles the reply (or the account's error) is handled. */
  private turn(botId: string, l: Live, text: string, images?: { type: 'image'; data: string; mimeType: string }[]) {
    const task = this.activeTask(botId);
    if (!task) return;
    this.db.run('UPDATE tasks SET session = ? WHERE id = ?', l.key, task.id); // the session key, so a resume continues it
    this.db.event('run.prompted', botId, { task: l.task, ...(images?.length ? { photos: images.length } : {}) });
    this.busy.add(botId);
    const spec: RunSpec = {
      key: l.key, bot: botId, task: l.task, account: l.account, ...(l.model ? { model: l.model } : {}),
      cwd: disk.botDir(this.cfg, botId), system: this.systemPromptFor(botId, l), message: text,
      ...(images?.length ? { images } : {}),
      thinking: botId === CHIEF ? 'low' : undefined, builtins: [],
    };
    void this.runtime.run(spec, (e) => this.onEvent(botId, l, e)).then(
      (end) => this.settled(botId, task, l, end),
      (e) => { console.error(`${botId}:`, e); this.settled(botId, task, l, { ok: false, kind: 'other', message: String(e) }); });
  }

  /** The bot's own words and job, its skills listed by name, and the connected app's tools it may call. */
  private systemPromptFor(botId: string, l: Live) {
    const skills = disk.listSkills(this.cfg, botId);
    const apps = [...(l.appTools?.keys() ?? [])].filter((n) => n !== 'calendar' && n !== 'mail')
      .map((n) => `${n} (${l.apps?.[n]?.app ?? 'app'})`);
    return disk.systemPrompt(this.cfg, botId, botId === CHIEF)
      + (skills.length ? `\n## Skills you follow\n${skills.map((s) => `- ${s.name}: ${s.description || 'how you do this kind of job'} (in ${join(disk.botDir(this.cfg, botId), 'skills', s.name)})`).join('\n')}\n` : '')
      + (apps.length ? `\nThe person's connected apps give you more tools through crew_app: pass \`tool\` (one of ${apps.join(', ')}) and \`input\` (its arguments).\n` : '');
  }

  /** Only assistant prose is visible; tool arguments and reasoning never ride the live feed. */
  private onEvent(botId: string, l: Live, e: RunEvent) {
    if (this.live.get(botId) !== l) return;
    if (e.type === 'text') this.db.live('reply.partial', botId, { task: l.task, text: cleanReply(e.text).slice(0, 280) });
    else if (e.type === 'usage' && e.tokens) {
      this.db.run('UPDATE tasks SET tokens = tokens + ? WHERE id = ?', Math.round(e.tokens), l.task);
      this.db.run('INSERT INTO usage (member, day, tokens) VALUES (1, ?, ?) ON CONFLICT(member, day) DO UPDATE SET tokens = tokens + excluded.tokens', dayOf(), Math.round(e.tokens));
      const t = this.db.get('SELECT * FROM tasks WHERE id = ?', l.task);
      if (t && t.state === 'working' && t.tokens >= taskTokenCap()) { this.close(botId); this.setTask(t, 'failed', 'This one was getting long, so I stopped it before it used more of your AI.'); }
    }
  }

  private settled(botId: string, task: Row, l: Live, end: RunEnd) {
    if (this.stopped) return; // a turn cut short by shutdown settles after the store has closed
    this.busy.delete(botId);
    if (this.live.get(botId) !== l) return; // replaced or reset
    if (end.ok) {
      void this.surfaceLearned(botId, l).catch(() => {});
      return this.finish(botId, end.text); // a rest expires by its own time; a success never clears one early
    }
    if ('aborted' in end) return; // stopped on purpose: Take over, Stop, or a parked question
    if (end.kind === 'network') {
      this.handoffs.set(task.id, 'The connection dropped');
      this.close(botId);
      this.setTask(task, 'queued');
      return this.dispatch();
    }
    const name = disk.brainName({ provider: l.account });
    const words = end.kind === 'resting' ? `${name} is resting until ${clock(end.until ?? Date.now() + 60 * 60_000)}`
      : end.kind === 'signed-out' ? `${name} needs you to sign in again`
      : end.kind === 'plan' ? `${name}'s plan doesn't include helpers` : '';
    if (!words) {
      console.error(`${botId}: ${end.message}`);
      this.close(botId);
      this.setTask(task, 'failed', `${name} couldn't finish this one. Try again.`);
      return this.dispatch();
    }
    // The account hit its limit, needs signing in again, or its plan doesn't include helpers: rest or flag it, and the
    // task continues in its own session on the next account, conversation and all.
    if (end.kind === 'resting') {
      const until = end.until ?? Date.now() + 60 * 60_000;
      this.accounts.rest(l.account, until);
      this.db.event('account.resting', null, { account: l.account, name, until });
    } else if (end.kind === 'plan') this.accounts.notIncluded(l.account, true);
    else this.accounts.expired.add(l.account);
    this.close(botId);
    this.handoffs.set(task.id, words);
    this.db.tx(() => {
      this.db.run("UPDATE bots SET state = 'off' WHERE id = ?", botId);
      this.setTask(task, 'queued');
    });
    this.dispatch();
  }

  /** The first of these brains the person can think with now: signed in, and not resting. */
  private async usable(choices: disk.Brain[]) {
    for (const b of choices) {
      if (!await this.accounts.signedIn(b.provider).catch(() => false)) continue;
      const until = this.accounts.restingUntil(b.provider);
      if (until && until > Date.now()) continue;
      return b;
    }
    return undefined;
  }

  /** Every account this task could use is resting: wait for the earliest. None usable yet (never signed in, signed out,
   *  or a plan without helpers): the task waits for this person's own account, nobody else's, and starts by itself once
   *  they sign in. The app shows the sign-in (or the plan's options) right under these words. */
  private pause(task: Row, choices: disk.Brain[]) {
    const name = PROVIDERS[choices[0]?.provider]?.name ?? 'ChatGPT';
    const who = this.bot(task.bot)!.display;
    // Only accounts the person has: a resting one wakes up; one never signed in doesn't.
    const rests = choices.filter((b) => !this.accounts.unready(b.provider)).map((b) => this.restingUntil(b.provider)).filter(Boolean);
    let wake: number | null, state: string, words: string, voice: string;
    if (!rests.length) {
      const handoff = this.handoffs.get(task.id) ?? '';
      this.handoffs.delete(task.id);
      const plan = choices.some((b) => this.accounts.notIncluded(b.provider));
      const first = !this.db.get("SELECT 1 FROM tasks WHERE id != ? AND state != 'paused'", task.id);
      wake = null;
      state = plan ? `Waiting for a ${name} plan with helpers.` : `Waiting for you to sign in with ${name}.`;
      words = plan ? `Your ${name} plan doesn't include helpers yet. Everything else in ${name} is fine. ${name} Plus includes it.`
        : /sign in again/.test(handoff) ? signedOutWords(name)
        : first && task.bot === CHIEF ? `The crew uses your ${name} account. Sign in when you're ready and I'll start.`
        : `${task.bot === CHIEF ? 'I' : who} will start the moment you sign in with ${name}.`;
      voice = task.bot === CHIEF ? 'bot' : 'system';
    } else {
      wake = Math.min(...rests);
      const why = choices.length === 1 ? `Your ${name} is resting until ${clock(wake)}` : `All your AI accounts are resting until ${clock(wake)}`;
      state = `${why}.`;
      words = `${why}. ${choices.length === 1 ? `${who} will finish this then` : "I'll pick this up then"}.`;
      voice = 'system';
    }
    this.db.tx(() => {
      this.db.run('UPDATE tasks SET wake_at = ? WHERE id = ?', wake, task.id);
      this.setTask(task, 'paused', state);
      this.say(task.bot, voice, words, task.id);
    });
  }

  /** The person can think again (signed in, or their plan changed): what was waiting for them starts now. */
  wake(words?: string) {
    const waiting = this.db.all("SELECT * FROM tasks WHERE state = 'paused' AND wake_at IS NULL");
    if (!waiting.length) return;
    this.db.tx(() => {
      for (const t of waiting) this.setTask(t, 'queued');
      if (words) this.say(CHIEF, 'bot', words, null);
    });
    this.dispatch();
  }

  /** "I've changed my plan": try the account again. */
  retryAccount(key: string) {
    this.accounts.notIncluded(key, false);
    this.wake();
  }

  private teamJob(task: Row) {
    const root = task.root ?? task.id;
    return !!this.db.get('SELECT 1 FROM tasks WHERE root = ? AND id != ?', root, task.id) ||
      !!this.db.get("SELECT 1 FROM asks WHERE state = 'open' AND json_extract(detail, '$.pass.root') = ?", root);
  }

  /** After a real engine run: any skill the engine's reviewer applied lands as one plain line with a Forget. */
  private async surfaceLearned(botId: string, l: Live) {
    if (this.cfg.engine === 'stub') return;
    const learned = await this.runtime.learned().catch(() => [] as { id: string; skill: string; at: number; state: string }[]);
    const applied = learned.filter((p) => p.state === 'applied');
    for (const p of applied) {
      if (this.seenLearned.has(p.id)) continue;
      this.seenLearned.add(p.id);
      this.db.tx(() => {
        this.say(botId, 'system', `Learned: ${p.skill} — I'll do it this way next time. You can Forget it on ${this.bot(botId)?.display ?? 'its'} page.`, l.task);
        this.db.event('learn.applied', botId, { task: l.task, id: p.id, skill: p.skill });
      });
    }
  }

  /** A turn finished with a reply. */
  finish(botId: string, reply: string) {
    const task = this.activeTask(botId);
    const text = cleanReply(reply.trim());
    // A turn that ended on a parked question isn't the end of the task: it resumes when the person answers.
    const parked = task && this.db.get("SELECT 1 FROM asks WHERE task_id = ? AND state = 'open' AND kind IN ('permission', 'connect')", task.id);
    const clear = !!task?.routine && text.replace(/[.\s]+$/, '') === ALL_CLEAR && !!this.db.get('SELECT 1 FROM routines WHERE id = ? AND quiet = 1', task.routine);
    this.db.tx(() => {
      if (text && !clear) this.say(botId, 'bot', text, task?.id ?? null);
      if (task && parked && task.state !== 'needs_you') this.setTask(task, 'needs_you');
      // While the person holds the controls the turn was cut short on purpose; Give back resumes it.
      if (!task || parked || this.held.has(botId)) return;
      // Done needs proof: a job that acted out in the world ends done only when the helper declared it saw it work
      // (crew_outcome). Declared unsure, or declared nothing, it ends unsure, never done.
      const said = task.outcome ? JSON.parse(task.outcome) : null;
      const b = this.bot(botId)!;
      // A fix it delivered counts only when crewd saw its check fail without it and pass with it (crew_verify).
      const unchecked = this.unchecked(task);
      if (unchecked || (said ? !said.worked : task.acted)) {
        this.setTask(task, 'unsure', unchecked ? `I suggested a change (${unchecked}) for the maintainer to review, but it wasn't seen to fail before it and pass after it. Check it before you use it.`
          : said?.seen || `I did something on ${task.acted}, but I didn't see it confirmed. Worth checking there yourself.`);
        if (task.origin === CHIEF && !this.teamJob(task)) this.say(CHIEF, 'bot', `${b.display} isn't sure “${short(task.title, 60)}” worked. It's in ${b.display}'s chat.`, null);
        return;
      }
      this.setTask(task, 'done', clear ? ALL_CLEAR_RESULT : text || 'Done.');
      if (task.origin === CHIEF && !this.teamJob(task)) {
        // In Chief's own voice, written by crewd: no model call, no task number.
        const files = this.db.all("SELECT data FROM events WHERE kind = 'file.delivered' AND bot = ? AND json_extract(data, '$.task') = ? AND json_extract(data, '$.input') IS NULL AND json_extract(data, '$.path') NOT LIKE 'files/from-%'", botId, task.id);
        const note = files.map((e) => JSON.parse(e.data).note as string).find(Boolean) ?? '';
        // One clarifying question round-trips word for word, carrying its task so the answer finds it again.
        if (!files.length && /\?\s*$/.test(text)) this.say(CHIEF, 'bot', `${b.display} asks: ${text}`, task.id);
        else this.say(CHIEF, 'bot', relayResult(text, note), files.length ? task.id : null);
      }
    });
    if (task && !parked && !this.held.has(botId)) this.close(botId);
    this.dispatch();
  }

  /** Host half of the replaceable agent runtime. The task and live run are checked before any tool is considered. */
  toolHost(): ToolHost {
    const own = (run: RunRef) => {
      const task = this.activeTask(run.bot);
      if (!task || task.id !== run.task || this.live.get(run.bot)?.task !== run.task)
        throw new Error('Unknown or stale task');
      return task;
    };
    return {
      tools: (run) => {
        own(run);
        return this.crewTools(run.bot).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
      },
      gate: async (run, tool, rawInput) => {
        try {
          const task = own(run);
          const [name, input] = this.unwrap(tool, rawInput);
          if (this.netOf(run.bot) && (name === 'web_fetch' || name === 'web_search')) {
            this.refusedNet(run.bot, name);
            return { allow: false, reason: 'This helper can read only the places on its list. Use its checked web tool.' };
          }
          // crew_app rides on the inner tool being one of this run's connected apps; everything else by grant.
          const ok = tool === 'crew_app' ? (this.live.get(run.bot)?.appTools?.has(name) ?? false)
            : this.toolAllowed(run.bot, name);
          if (!ok) return { allow: false, reason: 'This run does not have that tool.' };
          const result = await this.gate(run.bot, name, input);
          if (result) {
            if (result.terminate) { // the person hasn't answered: stop the run here; the answer arrives as the next prompt
              this.db.tx(() => this.setTask(task, 'needs_you', 'Waiting for you.'));
              void this.runtime.abort(run.key).catch(() => {});
            }
            return { allow: false, reason: result.reason ?? 'Not allowed', park: result.terminate };
          }
          return { allow: true };
        } catch { return { allow: false, reason: 'Crewhouse could not check this call.' }; }
      },
      call: async (run, tool, rawInput, signal) => {
        own(run);
        let ok = true, text = '';
        try {
          text = await this.toolCall(run, tool, rawInput, signal);
        } catch (e: any) {
          // A refused tool is a result the model reads and adapts to, never a crashed run.
          ok = false;
          text = `error: ${String(e?.message ?? e).slice(0, 300)}`;
        }
        // crewd's own record of what the run did: the drawer and the validator read this, never the engine's word.
        const [name] = this.unwrap(tool, rawInput);
        this.db.event('run.call', run.bot, { task: run.task, tool: name, input: JSON.stringify(rawInput).slice(0, 1000), ok, head: text.split('\n')[0].slice(0, 160) });
        return text;
      },
    };
  }

  // A remote app's tool rides inside crew_app; the gate and the card see the real tool and its input.
  private unwrap(tool: string, input: Record<string, unknown>): [string, Record<string, unknown>] {
    return tool === 'crew_app' ? [String(input.tool ?? ''), (input.input ?? {}) as Record<string, unknown>] : [tool, input];
  }

  /** The crew's half of a tool call, after the gate said yes. */
  private async toolCall(run: RunRef, tool: string, rawInput: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const l = this.live.get(run.bot);
    const space = disk.botDir(this.cfg, run.bot);
    const [name, input] = this.unwrap(tool, rawInput);
        if (l?.shell && name === 'bash') return String(await l.shell.run(input, signal));
        if (l?.browserTool && name === 'browser') return String(await l.browserTool.run(input, signal));
        if (/^crew_(read|write|edit|ls|grep|find)$/.test(name)) return fileTool(space, name, input);
        if (name === 'crew_web_fetch' || name === 'crew_web_search') {
          const net = this.netOf(run.bot);
          const selected = webTools(net?.may).find((entry) => entry.name === name.slice(5));
          if (!selected) throw new Error('Unknown web tool');
          return String(await selected.run(input, signal));
        }
        if ((name === 'calendar' || name === 'mail' || tool === 'crew_app') && l?.appTools?.has(name)) {
          const app = l.appTools.get(name)!;
          return said(app, input, signal);
        }
        // Command-line tools that need the person's own sign-in: fixed argv on this computer, outside the sandbox.
        const runTool = registry(this.cfg).find((t) => t.run && (l?.grants ?? []).includes(t.id) && t.id.replace(/-/g, '_') === name);
        if (runTool) return await new Promise<string>((resolve) => {
          execFile(which(this.cfg, runTool.bins[0]) ?? runTool.bins[0], ((input.args as string[]) ?? []).map(String),
            { cwd: space, env: { ...process.env, ...(this.live.get(run.bot) ? resolveGrants(this.cfg, disk.botConfig(this.cfg, run.bot).tools ?? [], { 'bot.dir': space, 'bot.id': run.bot }).env : {}), NO_COLOR: '1' }, timeout: 120_000, maxBuffer: 8 << 20, signal },
            (err, out, errOut) => resolve(`${out}${errOut}${err && !out ? `\n(exit: ${err.message})` : ''}`.slice(0, 30_000)));
        });
        const candidate = this.crewTools(run.bot).find((entry) => entry.name === name);
        if (!candidate) throw new Error('Unknown tool');
        return String(await candidate.run(input, signal));
  }

  /** Whether this run may even consider the tool: grants first, then the policy decides what a call means. */
  toolAllowed(botId: string, name: string) {
    const l = this.live.get(botId);
    if (!l) return false;
    const grants = l.grants ?? [];
    // OpenClaw's own read/recall/media tools, adopted for unfenced runs; a fenced helper's way out stays crewd's.
    if (NATIVE_TOOLS.has(name)) return !this.netOf(botId);
    if (/^crew_(read|write|edit|ls|grep|find)$/.test(name)) return grants.includes('files');
    if (name === 'bash') return grants.includes('files') && sandboxReady();
    if (name === 'crew_web_fetch' || name === 'crew_web_search') return grants.includes('web');
    if (name === 'browser') return !!l.browserTool;
    if (name === 'calendar' || name === 'mail') return l.appTools?.has(name) ?? false;
    if (name === 'crew_app') return true; // the inner tool is checked inside the gate and again in call
    if (name.startsWith('crew_')) return this.crewTools(botId).some((t) => t.name === name);
    // Command-line tools that need the person's own sign-in (a kit tool's run grant).
    return registry(this.cfg).some((t) => t.run && grants.includes(t.id) && t.id.replace(/-/g, '_') === name);
  }

  // ---- the gate: every tool call, before it runs ----
  /** What the policy needs to know about a bot right now. */
  private seen(botId: string) {
    const conf = disk.botConfig(this.cfg, botId);
    const granted = new Set(conf.tools ?? []);
    return {
      bot: this.bot(botId)!.display, space: disk.botDir(this.cfg, botId), page: this.live.get(botId)?.page, signedIn: conf.signedIn ?? [], apps: this.live.get(botId)?.apps,
      filledHost: this.live.get(botId)?.fills?.length ? this.hostOf(this.live.get(botId)?.page) : undefined,
      run: Object.fromEntries(registry(this.cfg).filter((t) => t.run && granted.has(t.id)).map((t) => [t.id.replace(/-/g, '_'), { name: t.name, ...t.run! }])),
      // Sign-ins and keys: the person's, former people's, the engine's, and other programs'. Nothing reads them through a bot.
      secret: [this.cfg.stateDir, this.cfg.toolsDir, ...['.pi', '.ssh', '.gnupg', '.aws', '.config/gh', '.treg', '.codex', '.claude', '.claude.json'].map((d) => join(homedir(), d))],
    };
  }

  /** A call that goes through and acts out in the world marks its job: that job must now say whether it worked, and an
   *  earlier "it worked" no longer covers it. */
  private async gate(botId: string, tool: string, input: Record<string, any>, s = this.seen(botId)) {
    const e = effectOf(tool, input, s);
    const r = await this.decide(botId, tool, input, e);
    const task = !r && acts(tool, input, e) && this.activeTask(botId);
    if (task) {
      let where = s.apps?.[tool] ? `your ${s.apps[tool].app}` : tool === 'calendar' ? 'your Google Calendar' : s.run?.[tool]?.name ?? 'a web page';
      try { if (tool === 'browser') where = new URL(s.page ?? '').hostname.replace(/^www\./, '') || where; } catch { /* no page yet */ }
      this.db.run('UPDATE tasks SET acted = ?, outcome = NULL WHERE id = ?', where, task.id);
    }
    return r;
  }

  /** Run it, refuse it, or ask the person in one plain sentence and wait. The model's own words never decide. */
  private async decide(botId: string, tool: string, input: Record<string, any>, e: Effect = effectOf(tool, input, this.seen(botId))) {
    if (this.held.has(botId)) return { block: true, reason: 'The person has the controls of your screen; wait. You will be told when they give them back.', terminate: true };
    const task = this.activeTask(botId);
    // A fenced helper uses only tools whose way out crewd holds: the proxied shell, the checked web, its files, the crew.
    if (this.netOf(botId) && !/^(bash|web_fetch|web_search|read|write|edit|ls|grep|find|crew_\w+)$/.test(tool)) {
      this.refusedNet(botId, tool);
      return { block: true, reason: 'This helper may reach only the places on its list; that tool goes elsewhere.' };
    }
    const words = toolWords(tool, input);
    if (words) this.db.event('run.tool', botId, { task: task?.id, words });
    // Lines the helper types on a page nobody has approved yet (an unsigned register's form) are remembered for the
    // card of the press that sends them; a new page starts a new form.
    if (tool === 'browser' && e.kind === 'safe') {
      const l = this.live.get(botId);
      const cmd = String(Array.isArray(input.args) ? input.args[0] ?? '' : '');
      if (l && ['goto', 'tab-new', 'reload'].includes(cmd)) l.fills = undefined;
      if (l && cmd === 'fill') {
        const label = pressOf(l.snapshot ?? '', String(input.args?.[1] ?? '').replace(/^@/, ''))?.label ?? String(input.args?.[1] ?? '');
        l.fills = [...(l.fills ?? []), { label, value: String(input.args?.[2] ?? '') }];
      }
    }
    if (e.kind === 'safe') return undefined;
    if (e.kind === 'refuse') return { block: true, reason: e.why };
    let checkout: { page: string; total: number | null } | undefined;
    if (e.kind === 'spend' && tool === 'browser') {
      // The whole page, read by crewd itself: the model's view of it is cut short and never decides a card.
      const l = this.live.get(botId);
      if (l?.browser) l.snapshot = await l.browser.run(['snapshot', '--full']);
      const r = this.order(botId, e);
      e = r.effect; checkout = r.checkout;
      // One yes covers the rest of that page's clicks (place order included), until the page or its total changes.
      const ok = this.checkouts.get(botId);
      if (ok && ok.task === task?.id && ok.page === checkout.page && ok.total === checkout.total) {
        this.db.event('run.allowed', botId, { task: task?.id, words: e.words });
        return undefined;
      }
    }
    if (e.kind === 'send' && tool === 'browser') {
      // Pressing something on a site the person signed the bot in to (a shop's claim button) is its own card every
      // time, and the card is read from the page: which button, the page's own words around it, any money it shows.
      const l = this.live.get(botId);
      if (l?.browser) l.snapshot = await l.browser.run(['snapshot', '--full']);
      e = this.press(botId, e, input);
    }
    if (e.kind === 'spend' && e.cost !== undefined && this.spentThisMonth() + e.cost > this.moneyCap()) {
      this.db.event('money.refused', botId, { task: task?.id, cost: e.cost });
      return { block: true, reason: `That would take this month's spending past the $${this.moneyCap()} monthly limit. Tell the person, in one line; they can raise it in Settings.` };
    }
    if (this.granted.delete(`${botId}\n${e.words}`)) return undefined; // answered "allow" after the turn had parked
    const standing = e.key && [...(task && this.taskGrants.get(task.id) || []), ...(disk.botConfig(this.cfg, botId).allow ?? [])].includes(e.key);
    if (standing && task?.reask) this.db.run('UPDATE tasks SET reask = 0 WHERE id = ?', task.id); // acted, then restarted: this one asks
    else if (standing) {
      this.db.event('run.allowed', botId, { task: task?.id, words: e.words });
      return undefined;
    }
    const answer = await this.ask(botId, task, e, checkout);
    if (answer === null) return { block: true, terminate: true, reason: "The person hasn't answered yet; stop here and wait. You'll be told when they answer." };
    return answer === 'allow' ? undefined : { block: true, reason: 'The person said not now. Continue without it, or explain what you need.' };
  }

  /** A checkout page's card: the order as the page shows it, and its total as the cost the money cap counts when it's in
   *  dollars. crewd reads it from the page as the browser tool itself reports it; the model's words never reach it. */
  private order(botId: string, e: Extract<Effect, { words: string }>) {
    const l = this.live.get(botId);
    const name = this.bot(botId)?.display ?? botId;
    let host = 'a shop', page = '';
    try { const u = new URL(l?.page ?? ''); host = u.hostname.replace(/^www\./, ''); page = u.origin + u.pathname; } catch { /* no page yet */ }
    const o = orderOf(l?.snapshot ?? '');
    const few = o.items.slice(0, 3).map((i) => i.replace(/\s*[—–-]?\s*[$£€]\s?[\d,.]+\s*$/, '')).join(', ');
    // The card says what the page charges, in the page's own money. Only a dollar price counts toward the dollar cap;
    // anything else says so in plain words, so a capped-looking yes can never hide a different currency.
    const not$ = o.total !== null && o.currency !== '$';
    const words = o.total === null ? `${name} wants to act on a checkout page at ${host}. I couldn't read the total on this page.`
      : `${name} wants to place this order at ${host}${few ? `: ${few}${o.items.length + o.more > 3 ? ', …' : ''}` : ''}. Total ${o.shown}.${not$ ? ` That's ${o.currency === '£' ? 'pounds' : 'euros'}, not dollars, so the monthly limit can't count it.` : ''}`;
    const body = [...o.items, ...(o.more ? [`and ${o.more} more`] : []),
      o.total === null ? "Total: couldn’t read it on this page" : `Total ${o.shown}${not$ ? " — not dollars, the monthly limit can't count it" : ''}`].join('\n');
    return { effect: { ...e, words, ...(o.capped ? { cost: o.total! } : {}), preview: { head: `The order at ${host}`, body } }, checkout: { page, total: o.total, shown: o.shown, currency: o.currency } };
  }

  /** The host of a page, named the way a person would: no www, no path. */
  private hostOf(page?: string) {
    try { return new URL(page ?? '').hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  /** The card for acting as the person on a site they signed the bot in to: the button it will press, or the form line
   *  it will fill, the host, the page's own lines around it, and the money the page shows — all read by crewd from the
   *  page as the browser tool itself reports it, never from what the model says it was about to do. A filled line is
   *  shown as `label: value` — the label from the page, the value from the call — since this is the one card that
   *  carries the family's own words (an unclaimed-money claim). A press that submits a form the helper typed lines
   *  into asks wherever it is, and its card lists every line it will fill in. */
  private press(botId: string, e: Extract<Effect, { words: string }>, input: Record<string, any>) {
    const l = this.live.get(botId);
    const name = this.bot(botId)?.display ?? botId;
    const host = this.hostOf(l?.page) || 'a site';
    const value = ['fill', 'select'].includes(String(input.args?.[0] ?? '')) && input.args?.[2] !== undefined ? String(input.args[2]) : null;
    // The lines typed on this page that no card has shown yet ride the card for the press that sends them.
    const pending = value === null ? l?.fills ?? [] : [];
    if (pending.length) {
      const signed = (disk.botConfig(this.cfg, botId).signedIn ?? []).some((d) => host === d || host.endsWith(`.${d}`));
      const n = pending.length;
      return { ...e, fill: true,
        words: `${name} wants to fill in ${n} ${n === 1 ? 'line' : 'lines'} on the claim form at ${host}${signed ? ', a site you signed it in to' : ''}.`,
        preview: { head: `What ${name} will fill in on ${host}`, body: pending.map((f) => `${f.label}: ${f.value}`).join('\n') } };
    }
    const p = pressOf(l?.snapshot ?? '', String(input.args?.[1] ?? '').replace(/^@/, ''));
    if (!p) return e;
    const shown = orderOf(l?.snapshot ?? '').shown;
    const back = value === null ? claimOf(l?.snapshot ?? '') : null;
    return { ...e, ...(value !== null ? { fill: true } : {}),
      words: value !== null ? `${name} wants to fill “${p.label}” on ${host}, a site you signed it in to.`
        : `${name} wants to press “${p.label}” on ${host}, a site you signed it in to${shown ? `. The page shows ${shown}.` : '.'}`,
      // One plain money line first on a press, only when the page itself writes both prices (the preview clamps);
      // a filled line reads `label: value`, and the card says nothing about money it did not read.
      preview: { head: `What ${name} will ${value !== null ? 'fill' : 'press'} on ${host}`,
        body: value !== null ? `${p.label}: ${value}` : back ? `You'd get ${back.shown} back.\n${p.body}` : p.body } };
  }

  private async ask(botId: string, task: Row | undefined, e: Extract<Effect, { words: string }>, checkout?: { page: string; total: number | null }): Promise<string | null> {
    // The same call asked again (the bot resumed after a restart) takes over the card already shown.
    const same = this.db.all("SELECT id FROM asks WHERE bot = ? AND kind = 'permission' AND state = 'open' AND title = ?", botId, e.words).find((a) => !this.holds.has(a.id));
    const askId = same ? same.id : this.openAsk(botId, task, e.words, { effect: e.kind, key: e.key, ...(e.cost !== undefined ? { cost: e.cost } : {}), ...(e.preview ? { preview: e.preview } : {}), ...(checkout ? { checkout } : {}), ...(e.press ? { press: true } : {}), ...(e.fill ? { fill: true } : {}) });
    if (same && task) this.setTask(task, 'needs_you');
    // In their quiet hours nobody will answer soon: park at once instead of holding the bot.
    const quiet = quietNow(this.person().quiet);
    const answer = await new Promise<string | null>((resolve) => {
      const t = setTimeout(() => { this.holds.delete(askId); resolve(null); }, quiet ? 0 : HOLD_MS);
      this.holds.set(askId, (a) => { clearTimeout(t); resolve(a); });
    });
    if (answer === null) this.db.event('ask.parked', botId, { ask: askId, task: task?.id, quiet });
    else if (task) this.setTask(this.db.get('SELECT * FROM tasks WHERE id = ?', task.id)!, 'working');
    return answer;
  }

  private openAsk(bot: string, task: Row | undefined, title: string, detail: Row, kind = 'permission') {
    return this.db.tx(() => {
      const r = this.db.run('INSERT INTO asks (bot, task_id, kind, title, detail, at) VALUES (?, ?, ?, ?, ?, ?)', bot, task?.id ?? null, kind, title, JSON.stringify(detail), Date.now());
      if (task) this.setTask(task, 'needs_you');
      this.db.event('ask.opened', bot, { ask: Number(r.lastInsertRowid), task: task?.id, title, effect: detail.effect });
      return Number(r.lastInsertRowid);
    });
  }

  private defer(ask: Row) { // "Not now, remind me tomorrow": a one-shot routine, fired once by schedule(), then gone
    const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0);
    const name = short(String(ask.title ?? 'a deferred question'), 60);
    const id = this.db.run("INSERT INTO routines (bot, name, schedule, body, kind, next_at, created_at) VALUES (?, ?, '', ?, 'once', ?, ?)", ask.bot, name, `The person said not now and asked to be reminded: "${name}". Raise it with them again now.`, next.getTime(), Date.now()).lastInsertRowid;
    this.db.event('routine.created', ask.bot, { routine: Number(id), name, words: 'Reminds you tomorrow' });
  }

  /** Allow once, for this task, or always for the bot; or not now — with a reminder tomorrow when asked. Spending is never more than once. */
  async answer(askId: number, body: { answer?: string; scope?: string; schedule?: string; change?: string; text?: string; remind?: boolean }, key?: string) {
    const ask = this.db.get("SELECT * FROM asks WHERE id = ? AND state = 'open'", askId);
    // A replayed phone answer lands here when the first one acted but its reply never shipped: already settled, same key.
    if (!ask && key && this.db.get('SELECT 1 FROM settings WHERE key = ?', `link.key.${key}`)) return;
    if (!ask) throw fail('that question is already settled', 409);
    const detail = JSON.parse(ask.detail || '{}');
    if (!['allow', 'deny'].includes(body.answer ?? '')) throw fail('answer allow or deny');
    const scope = body.answer === 'allow' ? body.scope ?? 'once' : 'once';
    if (!['once', 'task', 'always'].includes(scope) || (scope !== 'once' && !detail.key) || (scope === 'task' && !ask.task_id)) throw fail('allow once, for this task, or always');
    const who = this.bot(ask.bot)?.display ?? ask.bot;
    // A suggestion takes effect on yes, before the card closes: if it can't, the card stays open. A routine offered by
    // Chief takes the time the person changed on the card ("Change time"), then the same yes.
    if (body.schedule && ask.kind === 'propose' && detail.routine) detail.routine.schedule = String(body.schedule);
    // A draft the person changed before Approve: their words are the ones kept, in the draft's own file. Still nothing is sent.
    if (body.text !== undefined) {
      const text = String(body.text).trim();
      if (ask.kind !== 'propose' || !detail.draft || body.answer !== 'allow') throw fail('only a draft you approve takes new words');
      if (!text || text.length > DRAFT_CAP) throw fail(text ? 'that draft is too long' : 'the draft is empty');
      if (text !== String(detail.preview?.body ?? '').trim()) {
        // A card from before drafts showed whole may hold only the start of it: changing that would cut the rest.
        if (sha(String(detail.preview?.body ?? '')) !== detail.draft.sha) throw fail('that draft is too long to change here', 409);
        this.keepDraft(ask.bot, detail.draft.path, text);
        detail.draft = { ...detail.draft, sha: sha(text), edited: true };
      }
    }
    if (ask.kind === 'propose' && body.answer === 'allow') this.adopt(ask.bot, detail);
    if (ask.kind === 'propose' && body.answer === 'deny' && detail.draft) this.db.event('draft.rejected', ask.bot, { ...detail.draft, task: detail.task });
    const change = ask.kind === 'propose' && detail.plan && body.answer === 'deny' ? String(body.change ?? '').trim().slice(0, 2000) : '';
    const shown = change ? 'change it' : body.answer === 'deny' ? 'not now' : scope === 'task' ? 'allowed for this task' : scope === 'always' ? `always allowed for ${who}` : 'allowed once';
    const held = this.holds.get(askId);
    const task = ask.task_id && this.db.get('SELECT * FROM tasks WHERE id = ?', ask.task_id);
    this.db.tx(() => {
      this.db.run("UPDATE asks SET state = 'answered', answer = ?, answered_at = ? WHERE id = ?", shown, Date.now(), askId);
      this.db.event('ask.answered', ask.bot, { ask: askId, task: ask.task_id, answer: shown });
      // Counted when the person says yes, at its most: the cap holds even if the tool spent less.
      if (body.answer === 'allow' && detail.checkout && ask.task_id) this.checkouts.set(ask.bot, { task: ask.task_id, ...detail.checkout });
      if (body.answer === 'allow' && detail.effect === 'spend' && detail.cost) this.db.event('money.spent', ask.bot, { amount: detail.cost, month: monthOf(), ask: askId });
      if (scope === 'task') this.taskGrants.set(ask.task_id, [...(this.taskGrants.get(ask.task_id) ?? []), detail.key]);
      if (scope === 'always') {
        disk.setSettings(this.cfg, ask.bot, { allow: [...(disk.botConfig(this.cfg, ask.bot).allow ?? []), detail.key] });
        this.db.event('bot.allowed', ask.bot, { covers: coversOf(detail.key) });
      }
      if (task?.state === 'needs_you' && !held) this.setTask(task, 'working');
      if (detail.pass) this.wrap(detail.pass.root);
      if (body.answer === 'deny' && body.remind === true && !change) this.defer(ask);
      if (key) this.db.run('INSERT INTO settings (key, value) VALUES (?, ?)', `link.key.${key}`, '{"ok":true}');
    });
    if (held) { held(body.answer!); this.holds.delete(askId); return; }
    // Change it: the person's own words go back to Chief with the plan they are about, for a new card.
    if (change) this.requestChief(`[Crewhouse] ${this.called()} wants a change to your plan for ${detail.plan.bot}: ${detail.plan.text}\nSteps:\n` +
      `${detail.plan.steps.map((x: string, i: number) => `${i + 1}. ${x}`).join('\n')}\nThey say: ${change}\nOffer the changed plan with crew_assign and steps.`, change);
    if (ask.kind === 'propose') return;
    if (ask.kind === 'connect' && task && body.answer === 'allow' && this.live.get(ask.bot)?.task === task.id) {
      // Connected: the app's tools arrive with a fresh session, so the task picks up in its own conversation with them.
      this.close(ask.bot);
      this.handoffs.set(task.id, `${this.connections.apps[detail.app]?.name ?? 'The app'} is connected now`);
      this.connected.add(task.id);
      this.setTask(task, 'queued');
      return this.dispatch();
    }
    // Parked: the turn already ended with a "wait", so the answer is the next prompt into the same session.
    if (body.answer === 'allow') this.granted.add(`${ask.bot}\n${ask.title}`);
    const l = this.live.get(ask.bot);
    if (!task || !l || l.task !== task.id) return; // not running now (after a restart): it asks again when it resumes, and goes through
    this.turn(ask.bot, l, `[Crewhouse] ${this.called().replace(/^the/, 'The')} has answered your request ("${ask.title}"): ` +
      (body.answer === 'allow' ? 'allowed. Go ahead and continue the task.' : 'not now. Continue without it, or explain what you need.'));
  }

  /** "Chief, call me Umer": for the person. */
  setAddress(address: string) {
    const a = needText(address, 40, 'say how to address them');
    this.db.run('UPDATE people SET address = ?, onboarded = 1 WHERE id = 1', a);
    this.db.event('person.onboarded', null, { address: a });
  }

  /** The person adds a word while the bot works: it reads it after its current step, without starting over.  */
  steer(botId: string, text: string) {
    const l = this.live.get(botId);
    if (!text.trim()) throw fail('empty message');
    if (!l || !this.busy.has(botId)) throw fail(`${this.bot(botId)?.display ?? 'That bot'} isn't working on anything right now; send it as a message`, 409);
    void this.runtime.steer(l.key, text.trim()).catch(() => {});
    this.say(botId, 'person', text.trim(), l.task);
    this.db.event('run.typed', botId, { task: l.task });
  }

  // ---- the crew tools: how a bot reports, delivers and remembers, and how Chief runs the crew ----
  private crewTools(botId: string): CrewTool[] {
    const tool = (name: string, description: string, params: Record<string, any>, fn: (p: any) => unknown): CrewTool => ({
      name, description, parameters: Type.Object(params),
      run: async (p) => JSON.stringify(await fn(p) ?? { ok: true }),
    });
    const task = () => this.activeTask(botId)?.id;
    const apps = Object.keys(this.connections.apps).join(', ');
    const own = [
      tool('crew_connect', `Ask the person to connect one of their apps (${apps}) when the task needs it and it isn't connected yet. ` +
        'Ask for one app at a time, then end your turn with one short line saying what you could do with it; you are resumed when they answer.',
        { app: Type.String() }, (p) => this.askConnect(botId, String(p.app ?? '').toLowerCase())),
      tool('crew_outcome', 'Before you end a job that did something outside your own space (booked, sent, bought, posted, pressed a button on a ' +
        'site, changed something in an app), say whether it worked. `worked`: true only when you saw the proof yourself (a confirmation page ' +
        'or number, the sent message, the event read back), and `seen` names it. Otherwise false, and `seen` says in plain words what you did ' +
        'and what the person should check ("I pressed Book, but the page didn\'t show a confirmation. Worth checking your email for one."). ' +
        'Not sure is an honest answer; a job that acted and says nothing counts as not sure.',
        { worked: Type.Boolean(), seen: Type.String() }, (p) => {
          const seen = clean(p.seen, 400);
          if (!seen) throw new Error('say what you saw, or what the person should check');
          const id = task();
          if (id) this.db.run('UPDATE tasks SET outcome = ? WHERE id = ?', JSON.stringify({ worked: p.worked === true, seen }), id);
        }),
      tool('crew_report', 'A one-line progress note the person sees.', { text: Type.String() }, (p) => { this.db.event('task.progress', botId, { task: task(), text: clean(p.text, 200) }); }),
      tool('crew_deliver', 'Register a finished file (a path in your folder, usually under files/).', { path: Type.String(), note: Type.Optional(Type.String()) }, (p) => this.deliver(botId, p.path, p.note)),
      tool('crew_workbook', 'Make a real spreadsheet the person can use straight away (.xlsx), in your files/, and deliver it. `name` is the title; '
        + '`sheets` is [{ name, columns: [{ header, width?, options? }], rows: [[cell, …], …] }]. `options` on a column makes it a dropdown; a cell that '
        + 'starts with "=" is a formula. crewd writes the file, so never make the binary yourself. Make it finished: a real heading on every sheet and at '
        + 'least one example row that shows the person how to fill it in.',
        { name: Type.String(), sheets: Type.Any() }, (p) => this.workbook(botId, String(p.name ?? ''), p.sheets)),
      tool('crew_batch', 'Research several items at once (up to 24) against the one `question`: `items` is the list, each a short name. ' +
        'Each item is researched in parallel and you get back one JSON array of {item, ok, text}. Put every answer — with a source column — into a single crew_workbook, delivered once. ' +
        'A batch item answers its own item only; it cannot start another batch.',
        { question: Type.String(), items: Type.Array(Type.String()) }, (p) =>
          this.batch(botId, String(p.question ?? ''), Array.isArray(p.items) ? p.items.map(String) : [])),
      tool('crew_document', 'Write a real document the person can open and edit (.docx), in your files/, and deliver it. `name` is the title; '
        + '`blocks` is the document in order: {heading}, {text, bold?, italic?}, {bullets: […]} or {table: {head: […], rows: [[cell, …], …]}}. '
        + 'crewd writes the file, so never make the binary yourself. Make it finished: a title, short paragraphs and a table where rows help. '
        + 'They read it right in Crewhouse on the web and on their phone, so one finished document is enough — never a shorter companion copy of it.',
        { name: Type.String(), blocks: Type.Any() }, (p) => this.document(botId, String(p.name ?? ''), p.blocks)),
      tool('crew_copy', "Put a copy of a file from your folder into the person's own folders. `to` is the full path of the new file.",
        { from: Type.String(), to: Type.String() }, (p) => {
          const from = disk.insideBot(this.cfg, botId, String(p.from ?? ''));
          if (!existsSync(from)) throw new Error(`no file at ${p.from}`);
          mkdirSync(dirname(String(p.to)), { recursive: true });
          copyFileSync(from, String(p.to));
          this.db.event('task.progress', botId, { task: task(), text: `Put a copy of ${basename(from)} in your ${basename(dirname(String(p.to)))} folder` });
        }),
      tool('crew_remember', 'Save a lasting preference of the person (one short line). `replaces`: words of an old note this corrects. ' +
        '`everyone`: true for something every helper should know about them; otherwise it goes in your own notes.',
        { text: Type.String(), replaces: Type.Optional(Type.String()), everyone: Type.Optional(Type.Boolean()) }, (p) => {
          if (disk.botConfig(this.cfg, botId).memory === false) throw new Error('memory is off for this bot; the person turned it off');
          const everyone = p.everyone === true;
          const change = disk.remember(this.cfg, { bot: everyone ? null : botId }, String(p.text ?? ''), String(p.replaces ?? ''));
          this.db.event('memory.learned', botId, { task: task(), text: change.added.slice(2, 202), ...(everyone ? { everyone } : {}), ...change });
        }),
      tool('crew_draft', 'Put a draft that would go out in the person\'s name (a reply, a post, an email) in front of them on a card. Nothing is ' +
        'sent either way: they post it themselves if they approve. `path`: the draft in your folder; `to`: where it would go ("muxr issue #208").',
        { path: Type.String(), to: Type.String() }, (p) => {
          const full = disk.insideBot(this.cfg, botId, String(p.path ?? ''));
          if (!existsSync(full)) throw new Error(`no file at ${p.path}`);
          const text = readFileSync(full, 'utf8').trim(), to = clean(p.to, 80), b = this.bot(botId)!;
          if (!text) throw new Error('the draft is empty');
          if (text.length > DRAFT_CAP) throw new Error(`the draft is over ${DRAFT_CAP} characters; shorten it`);
          return this.propose(botId, `${b.display} drafted something for ${to}. Nothing is sent: you post it yourself.`,
            { draft: { to, path: full.slice(disk.botDir(this.cfg, botId).length + 1), sha: sha(text) }, preview: { head: `Draft for ${to}`, body: text } });
        }),
      tool('crew_verify', 'Have Crewhouse itself check a fix you propose to a git checkout in your folder: it applies only the check (`tests`, the ' +
        'paths in the patch that test the fix) to `base` and runs `command`, which must fail; then the whole patch, which must pass; it runs in a ' +
        'fresh copy seeded with the dependencies your checkout already has installed. A check that failed before only on a missing module proves nothing, and a patch you deliver unproven ends as not sure.',
        { repo: Type.String(), base: Type.String(), patch: Type.String(), tests: Type.Array(Type.String()), command: Type.String() }, (p) => this.verify(botId, p)),
      tool('crew_learn', 'Ask to keep a skill when the person explicitly says to follow a way of working from now on (even the first time), or when you have done the same kind of job at least twice. Never propose one for an ordinary one-off job. ' +
        '`name`: two to four words; `description`: when to use it; `says`: what it does, in the person\'s plain words; `steps`: the steps, short and in plain words, as the person sees them. ' +
        'The person sees a card; it becomes one of your skills only if they say yes.',
        { name: Type.String(), description: Type.String(), says: Type.String(), steps: Type.String() }, (p) => {
          const d = disk.draftSkill(this.cfg, botId, p);
          const b = this.bot(botId)!;
          return this.propose(botId, `${b.display} would like to remember how to do this: ${d.says}`,
            { skill: { name: d.slug, description: String(p.description), says: d.says, steps: d.steps }, preview: { head: `How ${b.display} would do it`, body: d.steps } });
        }),
    ];
    if (botId !== CHIEF) {
      // A helper can ask for its own recurring check — a watch on a page, or a quiet look that needs its own browser.
      // It is the same card as Chief's: nothing runs until the person says yes on it.
      own.push(tool('crew_routine', 'Offer the person a recurring check of your own: the same task on a schedule, which nothing runs until they say ' +
        'yes on a card. `when` is plain words in local time: "every day 9:00", "every 2 hours". `on` starts it on a local event instead of a time: "when a file arrives in the inbox" or "when this computer wakes up" (the card names the inbox; `when` may be empty then). `watch`: a page address Crewhouse reads itself, waking ' +
        'you only when it changed, so a quiet day costs the person no AI — prefer it. `quiet`: you look each time but speak only when something ' +
        'changed; use it when the page draws what matters with JavaScript, so only your own browser can read it. Say in `task` what you are looking for.',
        { when: Type.Optional(Type.String()), on: Type.Optional(Type.String()), task: Type.String(), name: Type.Optional(Type.String()), quiet: Type.Optional(Type.Boolean()), watch: Type.Optional(Type.String()) },
        (p) => this.offerRoutine({ bot: botId, schedule: p.when, on: p.on, task: p.task, name: p.name, quiet: p.quiet, watch: p.watch })));
      const others = this.bots().filter((b) => b.id !== CHIEF && b.id !== botId).map((b) => `${b.id} (${b.role})`).join('; ');
      if (!others) return own;
      return [...own, tool('crew_pass', `Hand the next step to another helper, for the same person: ${others}. Write what they should do and what "done" means. ` +
        'Pass finished files from your files/ with `files`; the person can watch the work in The crew.',
        { bot: Type.String(), task: Type.String(), files: Type.Optional(Type.Array(Type.String())) }, (p) => this.pass(botId, String(p.bot ?? '').toLowerCase(), String(p.task ?? ''), p.files ?? []))];
    }
    const accounts = Object.keys(PROVIDERS).join(', ');
    // Chief coordinates and delegates finished files to helpers; their artifact tools need not occupy his first model call.
    const chiefTools = own.filter((t) => !['crew_deliver', 'crew_workbook', 'crew_document', 'crew_copy', 'crew_draft', 'crew_verify', 'crew_batch'].includes(t.name));
    return [...chiefTools,
      tool('crew_add_phone', 'Show an Add a phone card in this chat with a fresh QR and code.', {}, () => this.addPhone()),
      tool('crew_roster', 'Who is on the crew, and the templates you can recruit from.', {}, () => ({
        crew: this.bots().filter((x) => x.id !== CHIEF).map((x) => ({ id: x.id, name: x.display, role: x.role, busy: !!this.activeTask(x.id),
          knows: disk.listSkills(this.cfg, x.id).map((k) => k.description || k.name) })),
        templates: disk.listTemplates(this.cfg).map((t) => ({ id: t.id, name: t.display, role: t.role, knows: t.skills ?? [] })),
      })),
      tool('crew_recruit', 'Recruit a bot from a template.', { template: Type.String(), name: Type.Optional(Type.String()) },
        (p) => { const n = this.recruit(p.template, p.name, CHIEF); return { recruited: { id: n.id, name: n.display } }; }),
      tool('crew_assign', `Hand a bot a task. Give it a short descriptive title, never a URL. \`account\` (${accounts}) only when a task plainly suits another AI. ` +
        'A job of several steps: list them in `steps`, in plain words; the person sees the plan and it starts when they say Go.',
        { bot: Type.String(), task: Type.String(), title: Type.Optional(Type.String()), account: Type.Optional(Type.String()), steps: Type.Optional(Type.Array(Type.String())) },
        (p) => this.plan(String(p.bot).toLowerCase(), p.task ?? '', p.account, p.title, p.steps)),
      tool('crew_routine', 'Offer the person a routine: the same task on a schedule, for them to say yes or no. `when` is plain words in local time: "every Monday 9:00", "weekdays 8am", "every 2 hours". ' +
        '`on` starts it on a local event instead of a time: "when a file arrives in the inbox" or "when this computer wakes up" (the card names the inbox; `when` may be empty then). ' +
        '`quiet`: a check-in that only speaks up when something needs the person. `watch`: a page address to keep an eye on; Crewhouse reads it on ' +
        'schedule and wakes the bot only when it changed, and `task` says what matters ("tell me if the price drops below $900"). ' +
        'The person sees a card with the cadence and first run; nothing runs until they start it.',
        { bot: Type.String(), when: Type.Optional(Type.String()), on: Type.Optional(Type.String()), task: Type.String(), name: Type.Optional(Type.String()), account: Type.Optional(Type.String()), quiet: Type.Optional(Type.Boolean()), watch: Type.Optional(Type.String()) },
        (p) => this.offerRoutine({ bot: p.bot, schedule: p.when, on: p.on, task: p.task, name: p.name, model: p.account, quiet: p.quiet, watch: p.watch })),
      tool('crew_routines', 'The routines and when each runs next.', {}, () => this.routines().map((x) => ({ id: x.id, bot: x.bot, name: x.name, when: x.words, on: x.on ?? '', state: x.state, next: x.next_at ? new Date(x.next_at).toString() : '' }))),
      tool('crew_status', 'Open tasks, and what this person’s crew finished recently (titles and delivered files).', {}, () => ({ open: this.db.all("SELECT id, bot, title, state FROM tasks WHERE state IN ('queued','working','needs_you','paused') ORDER BY id"), finished: this.finishedList() })),
      tool('crew_suggest', 'Suggest a change to how a helper comes across (its personality), when the person asks for one. ' +
        '`text`: the whole new personality, a few short plain lines in the second person ("You are Reel. …"). The person sees it and says yes or no.',
        { bot: Type.String(), text: Type.String() }, (p) => {
          const b = this.bot(String(p.bot ?? '').toLowerCase());
          if (!b) throw fail(`no bot called ${p.bot}; see crew_roster`, 404);
          const body = String(p.text ?? '').replace(/\r/g, '').trim().replace(/^# .*\n+/, '');
          const text = `# ${b.display}\n\n${body}`;
          if (!body || text.length > disk.SOUL_CAP) throw fail(`say it in a few lines, under ${disk.SOUL_CAP} characters`);
          return this.propose(CHIEF, `Chief suggests a change to how ${b.display} comes across`,
            { soul: { bot: b.id, text }, preview: { head: `${b.display}, as Chief suggests`, body } });
        }),
      tool('crew_create', 'Suggest a new helper when no one on the crew and no template fits a job that will come round again (a watch, a standing chore). ' +
        '`name`: a short friendly first name; `job`: all five parts (does, aim, gets, how, great); `personality`: a few short plain lines ' +
        'in the second person ("You are Pip. …"); `first`: the person\'s request, to start on once they say yes. The person sees a card and decides; nothing is made until then.',
        { name: Type.String(), job: Type.Object({ does: Type.String(), aim: Type.String(), gets: Type.String(), how: Type.String(), great: Type.String() }), personality: Type.String(), first: Type.Optional(Type.String()) }, (p) => {
          const name = clean(p.name, 24);
          const job = Object.fromEntries(['does', 'aim', 'gets', 'how', 'great'].map((k) => [k, String(p.job?.[k] ?? '').replace(/\r/g, '').trim()])) as disk.Job;
          disk.validateJob(job);
          const body = String(p.personality ?? '').replace(/\r/g, '').trim().replace(/^# .*\n+/, '');
          if (!name || !/[a-z]/i.test(name)) throw fail('give the new helper a name');
          if (this.bot(disk.slug(name)) || disk.slug(name) === 'helper') throw fail(`there is already a helper called ${name}; pick another name`, 409);
          const soul = `# ${name}\n\n${body || `You are ${name}. Friendly, careful and brief.`}`;
          if (soul.length > disk.SOUL_CAP) throw fail(`say who it is in a few lines, under ${disk.SOUL_CAP} characters`);
          const summary = `${job.does}`;
          return this.propose(CHIEF, `Shall I take on a new helper? ${name}: ${short(summary, 160)}`,
            { create: { name, job, soul, first: p.first ? String(p.first).slice(0, 2000) : undefined },
              preview: { head: `${name}, a new helper`, body: `${disk.jobPreview(job)}\n\n${body}\n\n${name} can use the web, a browser of its own and its own files, and asks you before anything leaves this computer or costs money.` } });
        }),
      tool('crew_job', 'Write the five parts of a helper’s job when the person asks. Nothing changes until they say Use it. ' +
        'Pass `bot` and the five parts flat, or the five parts inside `job` (the shape crew_create uses).',
        { bot: Type.String(), does: Type.Optional(Type.String()), aim: Type.Optional(Type.String()), gets: Type.Optional(Type.String()), how: Type.Optional(Type.String()), great: Type.Optional(Type.String()), job: Type.Optional(Type.Any()) }, (p) => {
          const b = this.bot(String(p.bot ?? '').toLowerCase());
          if (!b || b.id === CHIEF) throw fail(`no helper called ${p.bot}`, 404);
          // The gateway shows the model no parameter schema for this tool, so it sends the nested
          // five-part shape it knows from crew_create. Take either shape, never reject a format.
          let inner: unknown = p.job;
          if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch { inner = undefined; } }
          const src = (inner && typeof inner === 'object' ? inner : p) as Record<string, unknown>;
          const job = Object.fromEntries(['does', 'aim', 'gets', 'how', 'great'].map((k) => [k, String(src[k] ?? '').replace(/\r/g, '').trim()])) as disk.Job;
          disk.validateJob(job);
          return this.propose(CHIEF, `Chief wrote ${b.display}'s job`, { job: { bot: b.id, ...job }, preview: { head: `${b.display}'s job`, body: disk.jobPreview(job) } });
        }),
      tool('crew_call_me', 'Change how the person is addressed, when they ask.', { how: Type.String() }, (p) => { this.setAddress(String(p.how ?? '')); }),
    ];
  }

  /** Files handed from one helper's files/ to another's, resolved and checked: only real files, still inside. */
  private handFiles(from: string, files: string[]) {
    const base = realpathSync(join(disk.botDir(this.cfg, from), 'files'));
    return files.map((f) => {
      const full = disk.insideBot(this.cfg, from, f);
      if (!realpathSync(full).startsWith(base + '/') || !statSync(full).isFile()) throw fail('pass only files from your files/');
      return { full, name: f.slice('files/'.length) };
    });
  }

  /** A helper hands the next step to another, for the person. Three hand-offs from one request at most, so two
   *  helpers can't pass a job back and forth for ever. Chief is not handed work: the person talks to him. */
  private pass(from: string, to: string, text: string, files: string[] = []) {
    const task = this.activeTask(from);
    const b = this.bot(to);
    if (!task) throw fail('pass work on while you are working on a task');
    if (!b || to === CHIEF || to === from) throw fail(`no helper called ${to} to hand this to`, 404);
    if (!text.trim()) throw fail('say what they should do');
    const hops = (task.hops ?? 0) + 1;
    if (hops > 3) throw fail('this job has been handed on three times already; finish it yourself, or tell the person what is left');
    if (!Array.isArray(files) || files.length > 20 || files.some((f) => typeof f !== 'string')) throw fail('pass up to twenty files');
    const checked = this.handFiles(from, files);
    const detail = { to, text: text.trim(), files: files.slice(), root: task.root ?? task.id, parent: task.id, hops };
    if (disk.botConfig(this.cfg, from).handoff === 'ask') return this.propose(from,
      `${this.bot(from)!.display} wants to hand this to ${b.display}: ${short(text, 160)}${files.length ? `, with ${files.map((f) => basename(f)).join(', ')}` : ''}`,
      { pass: detail, preview: { head: `${this.bot(from)!.display} → ${b.display}`, body: text.trim() } });
    return this.handOn(from, detail, checked);
  }

  private handOn(from: string, d: Row, checked?: { full: string; name: string }[]) {
    const files = checked ?? this.handFiles(from, d.files as string[]);
    const dest = join(disk.botDir(this.cfg, d.to), 'files', `from-${from}`);
    const paths = files.map((f) => `files/from-${from}/${f.name}`);
    for (let i = 0; i < files.length; i++) {
      const target = join(dest, files[i].name);
      mkdirSync(dirname(target), { recursive: true });
      const root = realpathSync(join(disk.botDir(this.cfg, d.to), 'files'));
      if (!realpathSync(dirname(target)).startsWith(root + '/') || (existsSync(target) && !realpathSync(target).startsWith(root + '/'))) throw fail('receiver file is outside its files/');
      copyFileSync(files[i].full, target);
    }
    const { task: id } = this.addTask(d.to, `${d.text}${paths.length ? `\n\nFiles handed over:\n${paths.join('\n')}` : ''}`, from, undefined, undefined, d.text, [], { parent: d.parent, root: d.root, hops: d.hops });
    for (const path of paths) this.db.event('file.delivered', d.to, { task: id, path, note: `from ${this.bot(from)!.display}`, input: true, size: statSync(join(disk.botDir(this.cfg, d.to), path)).size });
    return { passed: { to: this.bot(d.to)!.display, task: id }, note: `${this.bot(d.to)!.display} has it. The person can follow along in The crew.` };
  }

  /** A suggestion card: nothing changes until the person says yes, and the bot carries on meanwhile. */
  private propose(botId: string, title: string, detail: Row) {
    const t = this.activeTask(botId);
    if (!this.db.get("SELECT 1 FROM asks WHERE bot = ? AND kind = 'propose' AND state = 'open' AND title = ?", botId, title)) {
      this.openAsk(botId, undefined, title, { ...detail, task: t?.id }, 'propose');
    }
    return { asked: true, note: 'The person sees your suggestion on a card. Carry on; nothing changes unless they say yes.' };
  }

  /** Writes the person's version of a draft over the helper's, never through a link out of the helper's folder: the
   *  helper can still be changing that folder, so the file opened is checked, not just the path beforehand. */
  private keepDraft(bot: string, path: string, text: string) {
    const root = realpathSync(disk.botDir(this.cfg, bot)) + '/', full = disk.insideBot(this.cfg, bot, path);
    const moved = () => fail('that draft has moved', 409);
    let fd: number;
    try { fd = openSync(join(realpathSync(dirname(full)), basename(full)), constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o644); } catch { throw moved(); }
    try {
      let at = root; // where the open file really is; without /proc, the folder resolved just before
      try { at = readlinkSync(`/proc/self/fd/${fd}`); } catch { at = join(realpathSync(dirname(full)), basename(full)); }
      const st = fstatSync(fd);
      if (!at.startsWith(root) || !st.isFile() || st.nlink !== 1) throw moved();
      ftruncateSync(fd);
      writeSync(fd, `${text}\n`);
    } finally { closeSync(fd); }
  }

  /** The person said yes to a suggestion. */
  private adopt(botId: string, d: Row) {
    if (d.skill) {
      disk.saveSkill(this.cfg, botId, disk.draftSkill(this.cfg, botId, d.skill));
      this.db.event('skill.learned', botId, { name: disk.slug(d.skill.name), says: d.skill.says });
    } else if (d.pass) this.handOn(botId, d.pass);
    else if (d.job) {
      disk.writeJob(this.cfg, d.job.bot, d.job);
      this.db.event('job.changed', d.job.bot, { by: CHIEF });
    } else if (d.soul) {
      disk.writeSoul(this.cfg, d.soul.bot, d.soul.text, 'Personality changed, as Chief suggested');
      this.db.event('soul.changed', d.soul.bot, { by: CHIEF });
    } else if (d.routine) this.addRoutine(d.routine, CHIEF);
    else if (d.create) this.create(d.create);
    else if (d.draft) this.db.event('draft.approved', botId, { ...d.draft, task: d.task });
    else if (d.plan) {
      if (!this.bot(d.plan.bot)) throw fail('that helper has left the crew', 409);
      const steps = d.plan.steps.map((x: string, i: number) => `${i + 1}. ${x}`).join('\n');
      this.addTask(d.plan.bot, `${d.plan.text}\n\n[Crewhouse] The plan ${this.called()} said Go to:\n${steps}\nIt approves no send, purchase or change by itself: those still ask.`,
        CHIEF, d.plan.model, undefined, d.plan.text, [], { parent: d.task, title: d.plan.title });
    }
  }

  /** A helper Chief made up, on the person's yes: the plain base template with the job and personality from the card,
   *  and the request that prompted it as its first task. It gets the base tools only: nothing that spends money. */
  private create(c: { name: string; job: disk.Job; soul: string; first?: string }) {
    const id = disk.slug(c.name);
    if (this.bot(id)) throw fail(`there is already a helper called ${c.name}`, 409);
    const tpl = disk.loadTemplate(this.cfg, 'helper');
    this.db.tx(() => {
      this.addBot({ ...tpl, role: short(c.job.does.split(/\n|(?<=[.!?])\s/)[0].replace(/[.!?]$/, ''), 80) }, c.name, id, CHIEF);
      this.say(id, 'system', `${c.name} joined the crew.`);
    });
    disk.writeJob(this.cfg, id, c.job);
    disk.writeSoul(this.cfg, id, c.soul, 'Who it is, as Chief suggested and the person agreed');
    this.say(CHIEF, 'bot', `${c.name} has joined the crew.${c.first ? ` I've handed ${c.name} your request; results will reach you in ${c.name}'s chat.` : ''}`, null);
    if (c.first?.trim()) this.addTask(id, c.first.trim(), CHIEF, undefined);
  }

  /** A helper needs one of the person's apps: an in-chat Connect card, answered once it is connected (or Not now). */
  private askConnect(botId: string, app: string) {
    const a = this.connections.apps[app];
    if (!a) throw fail(`no app called ${app}`);
    const t = this.activeTask(botId);
    if (this.connections.connected(app)) return { connected: true, note: `${a.name} is already connected; its tools arrive with your next task.` };
    if (!this.db.get("SELECT 1 FROM asks WHERE bot = ? AND kind = 'connect' AND state = 'open' AND json_extract(detail, '$.app') = ?", botId, app)) {
      this.openAsk(botId, t, `Connect ${a.name}`, { app, words: `Let ${this.bot(botId)!.display} use your ${a.name}` }, 'connect');
    }
    return { asked: true, note: 'The person sees a Connect card now. End your turn with one short line; you will be told when they answer.' };
  }

  /** crew_verify: crewd applies the check alone to the base (it must fail), then the whole patch (it must pass), each in a
   *  fresh worktree seeded with a copy of the helper's installed node_modules, and keeps the exit codes. The model's word about its tests never counts. */
  private async verify(botId: string, p: { repo: string; base: string; patch: string; tests: string[]; command: string }) {
    if (!sandboxReady()) throw new Error('this computer has no sandbox to run a check in');
    const space = disk.botDir(this.cfg, botId), repo = disk.insideBot(this.cfg, botId, String(p.repo ?? '')), patch = disk.insideBot(this.cfg, botId, String(p.patch ?? ''));
    const tests = (p.tests ?? []).map(String).filter(Boolean);
    if (!existsSync(join(repo, '.git')) || !existsSync(patch)) throw new Error('`repo` must be a git checkout and `patch` a file, both in your folder');
    if (!tests.length || !/^[\w./-]+$/.test(String(p.base)) || !String(p.command ?? '').trim()) throw new Error('give the base commit, the check\'s paths and the command');
    const task = this.activeTask(botId)?.id;
    const run = (side: string, only: string[]) => {
      const w = join(space, 'work', 'verify', `${task}-${side}`);
      return runSandboxed(space, [this.cfg.toolsDir], { PATH: toolBin(this.cfg) }, `rm -rf ${q(w)}; git -C ${q(repo)} worktree prune; ` +
        `git -C ${q(repo)} worktree add -q --detach ${q(w)} ${q(p.base)} && cd ${q(w)} && git apply ${only.map((t) => `--include=${q(t)} `).join('')}${q(patch)} || exit 97; (cd ${q(repo)} && find . -name node_modules -type d -prune -print0 | xargs -0 -r cp -a --reflink=auto --parents -t ${q(w)}); ` +
        `(${p.command}); e=$?; cd /; git -C ${q(repo)} worktree remove --force ${q(w)}; rm -rf ${q(w)}; exit $e`, this.netOf(botId)?.sock);
    };
    const before = await run('base', tests), after = await run('fix', []);
    if (before.code === 97 || after.code === 97) throw new Error(`the patch doesn't apply to ${p.base}: ${(before.code === 97 ? before : after).tail}`);
    const missingDep = /Cannot find (?:package|module)|ERR_MODULE_NOT_FOUND/.test(before.tail), passed = before.code !== 0 && after.code === 0 && !missingDep; // red on a missing module proves nothing: a patch that deletes the import would pass it
    this.db.event('verify.result', botId, { task, patch: patch.slice(space.length + 1), sha: sha(readFileSync(patch, 'utf8')), base: p.base, command: clean(p.command, 300), before: before.code, after: after.code, passed, ...(missingDep ? { missingDep } : {}) });
    return { passed, missingDep, before: { exit: before.code, tail: before.tail }, after: { exit: after.code, tail: after.tail } };
  }

  /** A patch this task delivered that crewd never saw pass its check, as the file is now; null when there is none. */
  private unchecked(task: Row): string | null {
    const ok = new Set(this.db.all("SELECT data FROM events WHERE kind = 'verify.result' AND bot = ? AND json_extract(data, '$.passed')", task.bot).map((e) => JSON.parse(e.data).sha));
    for (const e of this.db.all("SELECT data FROM events WHERE kind = 'file.delivered' AND json_extract(data, '$.task') = ?", task.id)) {
      const { path } = JSON.parse(e.data), full = join(disk.botDir(this.cfg, task.bot), path);
      if (/\.(patch|diff)$/.test(path) && !(existsSync(full) && ok.has(sha(readFileSync(full, 'utf8'))))) return path;
    }
    return null;
  }

  /** Tasks with a batch running now: a batch item answers its own item only, never starts another batch. */
  private batching = new Set<number>();

  /** crew_batch: one question fanned out over many items, each its own engine session on this task
   *  (same gate and subscription). At most MAX_PARALLEL sessions
   *  run at once; the model merges the returned answers into one crew_workbook. A resting account stops new waves
   *  early with plain words, exactly as a normal turn would rest it. */
  private async batch(botId: string, question: string, items: string[]) {
    const task = this.activeTask(botId);
    const l = this.live.get(botId);
    if (!task || !l) throw new Error('no task running');
    if (this.batching.has(task.id)) throw new Error('a batch item researches its one item itself; it cannot start another batch');
    const q = clean(question, 500);
    const list = items.map((s) => String(s).trim().slice(0, 200)).filter(Boolean);
    if (!q) throw new Error('say the one question every item should answer');
    if (!list.length) throw new Error('list the items to research, each a short name');
    const trimmed = list.slice(0, MAX_ITEMS);
    const answers: BatchAnswer[] = new Array(trimmed.length);
    let at = 0, tired = 0;
    this.batching.add(task.id);
    try {
      // Waves of at most MAX_PARALLEL: a resting account stops the later waves before they start.
      while (at < trimmed.length && tired < 2) {
        const wave = trimmed.slice(at, at + MAX_PARALLEL).map((item, k) => (async () => {
          const i = at + k;
          const end = await this.runtime.run({
            key: `agent:m1:crewhouse:${botId}:${task.id}:batch:${i}`, bot: botId, task: task.id,
            account: l.account, cwd: disk.botDir(this.cfg, botId), system: BATCH_SYSTEM,
            message: subMessage(q, item), builtins: [],
          }, () => {});
          if (!end.ok && 'aborted' in end) {
            answers[i] = { item, ok: false, text: 'this item was stopped before it answered.' };
          } else if (!end.ok && (end.kind === 'resting' || end.kind === 'plan')) {
            tired++;
            if (end.kind === 'resting') this.accounts.rest(l.account, end.until ?? Date.now() + 60 * 60_000);
            else this.accounts.notIncluded(l.account, true);
            answers[i] = { item, ok: false, text: `${disk.brainName({ provider: l.account })} is resting; this item was not researched.` };
          } else if (!end.ok) {
            answers[i] = { item, ok: false, text: `this item could not be researched (${end.message.slice(0, 120)}).` };
          } else {
            answers[i] = { item, ok: true, text: end.text.slice(0, 2000) };
          }
        })());
        at += wave.length;
        await Promise.all(wave);
      }
    } finally {
      this.batching.delete(task.id);
    }
    const notes = [
      list.length > trimmed.length ? `only the first ${MAX_ITEMS} of ${list.length} items were researched` : '',
      tired >= 2 ? `${disk.brainName({ provider: l.account })} started resting, so the remaining items were left out — try them again later` : '',
    ].filter(Boolean);
    return { answers, ...(notes.length ? { note: notes.join('; ') } : {}) };
  }

  /** crew_workbook: crewd writes the .xlsx itself (src/workbooks.ts) into the bot's files/ and delivers it like any other file. */
  private async workbook(botId: string, name: string, sheets: unknown) {
    const title = clean(name, 60) || 'Workbook';
    const task = this.activeTask(botId)?.id;
    const rel = join('files', `${disk.slug(title)}${task ? `-t${task}` : ''}.xlsx`);
    const full = disk.insideBot(this.cfg, botId, rel);
    mkdirSync(dirname(full), { recursive: true });
    const built = await buildWorkbook(full, { name: title, sheets } as any);
    await this.deliver(botId, rel, `${built.sheets.length === 1 ? 'One sheet' : `${built.sheets.length} sheets`}: ${built.sheets.slice(0, 4).join(', ')}`);
    return { ok: true, path: rel, sheets: built.sheets };
  }

  /** A raw file only opens after delivery, the same check the previews use. */
  fileFor(botId: string, path: string) {
    return !!this.db.get("SELECT 1 AS ok FROM events e JOIN tasks t ON t.id = json_extract(e.data, '$.task') " +
      "WHERE e.bot = ? AND e.kind = 'file.delivered' AND json_extract(e.data, '$.path') = ?", botId, String(path ?? ''));
  }

  /** The app's read-only preview of a workbook the bot delivered: words and counts, never the file or its path. */
  async workbookView(botId: string, path: string) {
    const rel = String(path ?? '');
    if (!this.fileFor(botId, rel)) throw Object.assign(new Error('that spreadsheet was not delivered to you'), { status: 403 });
    const full = disk.insideBot(this.cfg, botId, rel);
    if (!/\.xlsx$/i.test(full) || !existsSync(full) || statSync(full).size > 20_000_000) throw Object.assign(new Error('no such spreadsheet'), { status: 404 });
    return readWorkbook(full);
  }

  /** crew_document: crewd writes the .docx itself (src/documents.ts) into the bot's files/ and delivers it like any other file. */
  private async document(botId: string, name: string, blocks: unknown) {
    const title = clean(name, 60) || 'Document';
    const task = this.activeTask(botId)?.id;
    const rel = join('files', `${disk.slug(title)}${task ? `-t${task}` : ''}.docx`);
    const full = disk.insideBot(this.cfg, botId, rel);
    mkdirSync(dirname(full), { recursive: true });
    await buildDocument(full, { name: title, blocks } as any);
    const headings = (Array.isArray(blocks) ? blocks : []).filter((b: any) => typeof b?.heading === 'string')
      .map((b: any) => clean(b.heading, 45).replace(/[.!?:;]+$/, '').toLowerCase()).filter(Boolean);
    const sections = Math.max(1, headings.length);
    const headline = `The ${title} is ready${headings.length ? `: ${headings.slice(0, 3).join(', ')}` : ''}.`;
    await this.deliver(botId, rel, headline);
    return { ok: true, path: rel, sections };
  }

  /** The app's read-only preview of a document the bot delivered: plain parts for a .docx, the file's
   *  own words for a delivered .md or .txt (for the shared safe renderer) — never a path, only after delivery. */
  async documentView(botId: string, path: string) {
    const rel = String(path ?? '');
    if (!this.fileFor(botId, rel)) throw Object.assign(new Error('that document was not delivered to you'), { status: 403 });
    const full = disk.insideBot(this.cfg, botId, rel);
    if (!/\.(docx|md|txt)$/i.test(full) || !existsSync(full) || statSync(full).size > 20_000_000) throw Object.assign(new Error('no such document'), { status: 404 });
    // A delivered .md or .txt leaves as its own words (capped), read by the app's shared safe markdown renderer;
    // a .docx leaves as plain parts. Either way crewd reads the file, only after delivery.
    return /\.(md|txt)$/i.test(full) ? { text: readFileSync(full, 'utf8').slice(0, 100_000) } : readDocument(full);
  }

  /** A delivered video, in base64 slices (a phone fetches it piece by piece over the link), only after delivery. */
  async videoSlice(botId: string, path: string, after: number) {
    const rel = String(path ?? '');
    if (!this.fileFor(botId, rel)) throw Object.assign(new Error('that video was not delivered to you'), { status: 403 });
    const full = disk.insideBot(this.cfg, botId, rel);
    if (!/\.(mp4|webm|mov)$/i.test(rel) || !existsSync(full) || !statSync(full).isFile()) throw Object.assign(new Error('no such video'), { status: 404 });
    const size = statSync(full).size;
    const start = Math.max(0, Math.min(after, size));
    const end = Math.min(size, start + 600_000); // one link frame's worth, like the photo cap
    return { size, more: end < size, data: readFileSync(full).subarray(start, end).toString('base64') };
  }

  /** A finished file, registered once per task (a retried call is a no-op). Only inside the bot's own folder. */
  private deliver(botId: string, path: string, note?: string) {
    const full = disk.insideBot(this.cfg, botId, String(path ?? ''));
    if (!existsSync(full)) throw new Error(`no file at ${path}`);
    const rel = full.slice(disk.botDir(this.cfg, botId).length + 1);
    const active = this.activeTask(botId);
    const task = active?.id;
    if (task && this.db.get(`SELECT 1 FROM events WHERE kind = 'file.delivered' AND bot = ? AND json_extract(data, '$.task') = ? AND json_extract(data, '$.path') = ?`, botId, task, rel)) return { ok: true, already: true };
    this.db.event('file.delivered', botId, { task, path: rel, note: short(clean(note, 1000), 200), size: statSync(full).size });
    // A patch is only ever a suggested change for the maintainer to review, in crewd's own words, never the model's.
    this.say(botId, 'system', /\.(patch|diff)$/.test(rel) ? `Delivered ${rel}: Suggested change (for the maintainer to review)${this.db.get("SELECT 1 FROM events WHERE kind = 'verify.result' AND bot = ? AND json_extract(data, '$.passed') AND json_extract(data, '$.sha') = ?", botId, sha(readFileSync(full, 'utf8'))) ? ': passed its own check' : ''}` : `Delivered ${rel}${note ? `: ${note}` : ''}`, task ?? null);
    return { ok: true };
  }

  // ---- crewd's own clock: routines, timeouts, idle desktops ----
  private tick() {
    try {
      const now = Date.now();
      if (this.lastTick && now - this.lastTick > SLEPT_MS) this.slept(this.lastTick, now);
      this.lastTick = now;
      this.db.run("INSERT INTO settings (key, value) VALUES ('crew.lastTick', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(now));
      this.schedule();
      const working = !!this.db.get("SELECT 1 FROM tasks WHERE state = 'working' LIMIT 1");
      if (working !== this.awake) { this.awake = working; this.keepAwake(working); }
      if (this.learningOn() && this.curationAt && now >= this.curationAt && !this.curationBusy) {
        this.curationBusy = true;
        void this.weeklyCuration().finally(() => { this.curationBusy = false; });
      }
      for (const task of this.db.all("SELECT * FROM tasks WHERE state IN ('working', 'needs_you') AND updated_at < ?", Date.now() - TASK_TIMEOUT_MS)) {
        this.close(task.bot);
        this.setTask(task, 'failed', 'Took longer than an hour, so I stopped it.');
      }
      this.desktops.sweep((bot) => !!this.activeTask(bot) || this.held.has(bot));
      if (Date.now() - this.freshAt > 30 * 60_000) {
        this.freshAt = Date.now();
        void this.connections.keepFresh().catch((e) => console.error('keep fresh', e));
      }
    } catch (e) { console.error('tick', e); }
    this.dispatch();
  }

  /** The computer slept from `from` to `to`: the person hears which missed routines run now, once.
   *  Call it before `schedule()`, which does the catching up. The morning digest speaks for itself. */
  slept(from: number, to: number) {
    this.db.tx(() => {
      this.db.event('system.slept', null, { from, to });
      // Only those that really run now: one whose last run is still open is skipped, not caught up.
      const missed = this.db.all("SELECT * FROM routines WHERE state = 'on' AND kind != 'digest' AND next_at <= ? AND (last_task IS NULL OR last_task NOT IN " +
        "(SELECT id FROM tasks WHERE state IN ('queued', 'working', 'needs_you', 'paused'))) ORDER BY next_at", to);
      if (missed.length) {
        const names = missed.map((r) => `“${r.name}”`);
        const list = names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
        this.say(CHIEF, 'bot', `The crew was off from ${clock(from)} to ${clock(to)}, so jobs paused. ` +
          `I'm running ${list} now, once, to catch up.`, null);
      }
    });
    // Wake triggers: chores the person asked to start on waking, through the same fire path as a time.
    for (const r of this.db.all("SELECT * FROM routines WHERE state = 'on' AND trigger IS NOT NULL AND kind != 'digest'")) {
      try { if ('wake' in parseTrigger(r.trigger)) this.fire(r, 'wake'); } catch (e) { console.error('trigger', r.id, e); }
    }
  }

  // ---- the bot's screen: watch, take over, give back ----
  /** One signaling request from a watching screen. Watching starts the bot's desktop if it is resting.
   *  `canControl` false: a watch-only phone, which never drives even while the person holds the controls elsewhere. */
  async desktopSignal(botId: string, watcher: Watcher, method: string, params: Row, canControl = true) {
    const bot = this.needBot(botId);
    if (method === 'session.open') {
      if (!disk.canUse(this.cfg, botId, 'computer')) throw Object.assign(new Error(`${bot.display} has no computer; grant it on the Tools tab`), { code: 'no-screen' });
      await this.desktops.ensure(botId, bot.n, disk.botDir(this.cfg, botId));
    }
    return this.desktops.signal(botId, watcher, method, params, canControl && this.held.has(botId));
  }

  /** The person takes the controls: the bot stops where it is, and its tool calls are refused until Give back. */
  async takeOver(botId: string) {
    const bot = this.needBot(botId);
    if (this.held.has(botId)) return;
    this.held.add(botId);
    const task = this.activeTask(botId);
    this.db.tx(() => {
      this.db.event('desktop.takeover', botId, { task: task?.id ?? null });
      if (task) this.say(botId, 'system', `You have the controls. ${bot.display} is paused until you give them back.`, task.id);
    });
    this.live.get(botId)?.browser?.release();
    const l = this.live.get(botId);
    if (l) void this.runtime.abort(l.key).catch(() => {});
  }

  /** The person hands the controls back; the bot resumes its task with a note of what they did.
   *  `keep` names the sites they ticked on the give-back sheet — hosts crewd read itself off the bot's own tabs
   *  (`tabHosts`), so a sign-in the person does while holding the wheel is remembered and its presses ask. */
  async giveBack(botId: string, note = '', keep?: string[]) {
    const bot = this.needBot(botId);
    if (!this.held.has(botId)) throw fail(`${bot.display} already has the controls`, 409);
    let kept: string[] = [];
    if (keep?.length) {
      const tabs = await this.desktops.pages(botId);
      const bad = keep.find((h) => !tabs.includes(h));
      if (bad) throw Object.assign(new Error(`${bot.display}'s screen has no tab on ${bad}`), { status: 400 });
      disk.setSignedIn(this.cfg, botId, [...(disk.botConfig(this.cfg, botId).signedIn ?? []), ...keep]);
      kept = keep;
    }
    this.held.delete(botId);
    await this.desktops.revokeControl(botId);
    const did = clean(note, 500);
    const task = this.activeTask(botId);
    this.db.tx(() => {
      this.db.event('desktop.giveback', botId, { task: task?.id ?? null, note: did });
      if (kept.length) this.db.event('signin.kept', botId, { hosts: kept });
      if (task) this.say(botId, 'system', `You gave the controls back${did ? `: ${did}` : '.'}`, task.id);
    });
    const l = this.live.get(botId);
    if (task && l) {
      const who = this.called().replace(/^the/, 'The');
      this.turn(botId, l, `[Crewhouse] ${who} took the controls of your screen and has given them back. ` +
        `${did ? `What they did: ${did}. ` : 'They left no note. '}Look at your screen again before you carry on with task #${task.id}.`);
    } else this.dispatch();
  }

  async resetBot(id: string, why = STOPPED) {
    this.held.delete(id);
    await this.desktops.revokeControl(id);
    this.close(id);
    this.db.tx(() => {
      for (const t of this.db.all("SELECT * FROM tasks WHERE bot = ? AND state IN ('working', 'needs_you')", id)) this.setTask(t, 'failed', why);
      this.db.run("UPDATE asks SET state = 'withdrawn' WHERE bot = ? AND state = 'open'", id);
      this.db.run("UPDATE bots SET state = 'off' WHERE id = ?", id);
    });
  }

  /** The hosts on its tabs, for the give-back sheet — read only while the person holds the wheel. */
  tabHosts(botId: string) {
    return this.held.has(botId) ? this.desktops.pages(botId) : Promise.resolve([] as string[]);
  }

  /** The person takes a site back off the list. Its cookies and storage go from the bot's own browser FIRST: only a
   *  successful clear removes the host, because a host off the list with cookies still in its browser would let
   *  presses there run silently — exactly the gap this closes. No computer granted means there is no browser and
   *  nothing to clear, so the host goes. */
  async forget(botId: string, host: string) {
    const bot = this.needBot(botId);
    try {
      if (disk.canUse(this.cfg, botId, 'computer')) {
        await this.desktops.ensure(botId, bot.n, disk.botDir(this.cfg, botId));
        await this.desktops.clearSite(botId, host);
      }
    } catch {
      throw Object.assign(new Error(`Couldn't sign ${bot.display} out of ${host} just now; it still asks before acting there`), { status: 409 });
    }
    disk.setSignedIn(this.cfg, botId, (disk.botConfig(this.cfg, botId).signedIn ?? []).filter((d) => d !== host));
    this.db.event('signin.forgot', botId, { host });
  }

  /** The engine session a bot is working in, for tests. */
  /** The run's live state, for tests and the room. */
  sessionOf(botId: string) { return this.live.get(botId); }
}
