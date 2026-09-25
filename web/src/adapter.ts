// The thin adapter: crewd's state in, plain words out. Every screen reads these view models and nothing raw,
// so the engine underneath can change (docs/ui-contract.md) without the screens changing, and nothing technical
// (commands, file paths, model names, percentages, raw prompts) can reach a person. test/ui.test.ts holds this.
import type { Json } from './api.ts';
import { PALS, type Kind, type Mood } from './art.ts';

export const OWNER = 1;

export type Helper = {
  id: string; name: string; kind: Kind; mood: Mood; ring: 'working' | 'needs' | ''; status: string; role: string;
  computer: boolean; driving: boolean; stuckFor: number; quietSince: number;
};
export type Choice = { label: string; body: Json; primary?: boolean };
export type Card = {
  id: number; helper: string; kind: 'ok' | 'spend' | 'question' | 'connect'; head: string; words: string;
  preview?: { head?: string; body: string }; choices: Choice[]; reply: boolean; app?: App; at: number;
};
export type Work = { helper: string; title: string; line: string; waiting: boolean };
export type Thing = { id: number; helper: string; title: string; at: number; summary: string; files: FileView[] };
export type FileView = { url: string; kind: 'video' | 'image' | 'doc'; name: string };
export type Step = { at: number; text: string; now?: boolean; asked?: boolean; seq: number; undo?: boolean };
export type Line = { id: number; from: 'me' | 'them' | 'chief' | 'note'; text: string; files: FileView[]; choices: string[] };
export type App = { id: string; name: string; mark: string; bg: string; on: boolean; does: string };

// ---------- words ----------
export const clock = (t: number) => {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  if (d.toDateString() === new Date().toDateString()) return time;
  return Math.abs(t - Date.now()) < 6 * 86_400_000 ? `${d.toLocaleDateString([], { weekday: 'short' })} ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};
const at = (t: number | string) => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t));
export const greeting = (h = new Date().getHours()) => (h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');

/** A file's name as a person would say it: "files/mum-birthday_v2.mp4" → "Mum birthday v2". */
export function pretty(path: string) {
  const b = (path.split('/').pop() ?? path).replace(/\.[a-z0-9]+$/i, '').replace(/[-_.]+/g, ' ').trim();
  return b ? b[0].toUpperCase() + b.slice(1) : 'A file';
}
export function fileView(bot: string, path: string): FileView {
  const rel = path.replace(/^files\//, '');
  const url = /^(data:|\/)/.test(path) ? path : `/files/${bot}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  if (path.startsWith('data:image/')) return { url, name: 'A picture', kind: 'image' };
  return { url, name: pretty(rel), kind: /\.(mp4|webm|mov)$/i.test(rel) ? 'video' : /\.(png|jpe?g|webp|gif)$/i.test(rel) ? 'image' : 'doc' };
}

/**
 * A helper's own words, scrubbed of the machinery: code spans, fenced blocks, file paths and the names of engines.
 * ponytail: a pattern scrub, not a guarantee; the engine's prompts keep bots in plain words (docs/ui-contract.md).
 */
export function plain(text = '') {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`\n]*)`/g, (_, s: string) => (/^[\w.\-~\/]+\.[a-z0-9]{2,4}$/i.test(s) ? `“${pretty(s)}”` : /[\/\\$|]|--?\w/.test(s) ? '' : s))
    .replace(/(^|[\s(“"'])((~|\.{1,2})?\/[\w.\-~]+)+\/?(?=[\s).,;:!?”"']|$)/g, (_, pre: string, p: string) => `${pre}${/\.[a-z0-9]{2,4}$/i.test(p) ? `“${pretty(p)}”` : 'its folder'}`)
    .replace(/\bfiles\/([\w.\-]+)/g, (_, f: string) => `“${pretty(f)}”`)
    .replace(/\b(claude(\s+code)?|anthropic|codex|sonnet|opus|haiku|gpt-[\w.]+|herdr|mcp__\w+)\b/gi, 'the crew')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------- the crew ----------
const KINDS = Object.keys(PALS) as Kind[];
/** Which pal a bot looks like: its template's, else a steady pick from its name. */
export function kindOf(b: Json): Kind {
  const t = String(b?.template ?? b?.id ?? '');
  if ((KINDS as string[]).includes(t)) return t as Kind;
  let h = 0;
  for (const c of String(b?.id ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return KINDS[h % KINDS.length];
}
/** Templates only the owner sees in the gallery (people-finding spends money). */
const OWNER_ONLY = new Set(['tracer']);

export function helper(b: Json): Helper {
  const needs = b.task?.state === 'needs_you';
  const stuck = !!b.stuck;
  const driving = b.controls === 'person';
  const status = driving ? 'Paused while you drive' : needs ? 'Needs you' : stuck ? 'Quiet for a while' : b.task ? b.task.title
    : b.queued ? 'Up next' : b.pausedUntil ? `Resting until ${clock(at(b.pausedUntil))}` : 'Free to help';
  return {
    id: b.id, name: b.display, kind: kindOf(b), role: plain(b.role ?? ''), status: plain(status), computer: !!b.computer, driving,
    mood: needs ? 'ask' : b.task ? 'work' : b.pausedUntil ? 'rest' : 'idle',
    ring: needs ? 'needs' : b.task ? 'working' : '',
    stuckFor: stuck ? Math.max(1, Math.round((Date.now() - b.quietSince) / 60_000)) : 0, quietSince: b.quietSince ?? 0,
  };
}

/** When the crew is resting because an account ran out, in one sentence: "The crew is resting until 6:40 pm". */
export function resting(state: Json) {
  const until = Object.values(state.resting ?? {}).filter((t) => t) as number[];
  return until.length ? `The crew is resting until ${clock(Math.min(...until))}` : '';
}

/** Chief's heartbeat: his mood and one line for the whole crew. */
export function chief(state: Json) {
  const all = crew(state);
  const needs = all.find((h) => h.ring === 'needs');
  const busy = all.filter((h) => h.ring === 'working');
  const rest = resting(state);
  const mood: Mood = state.asks.length ? 'ask' : busy.length ? 'work' : rest ? 'rest' : 'idle';
  const line = needs ? `${needs.name} needs you`
    : state.asks.length ? `${crewName(state, state.asks[0].bot)} needs you`
    : busy.length === 1 ? `${busy[0].name} is on “${busy[0].status}”`
    : busy.length > 1 ? `${busy.map((h) => h.name).join(' and ')} are working`
    : rest || 'Keeping an eye on things';
  return { mood, line };
}
const crewName = (state: Json, id: string) => state.bots.find((b: Json) => b.id === id)?.display ?? 'The crew';

/** The helpers this person sees: everyone's, less the owner-only ones unless it's the owner. */
export function crew(state: Json) {
  const owner = state.person.id === OWNER;
  return state.bots.filter((b: Json) => b.id !== 'chief' && (owner || !OWNER_ONLY.has(b.template))).map(helper) as Helper[];
}

export function gallery(state: Json) {
  const owner = state.person.id === OWNER;
  return state.templates.filter((t: Json) => t.id !== 'chief' && (owner || !(t.ownerOnly || OWNER_ONLY.has(t.id))))
    .map((t: Json) => ({ id: t.id, name: t.display, kind: kindOf(t), does: plain(t.role ?? '') }));
}

// ---------- asks ----------
/**
 * One card per open ask, in plain words. The engine's own sentence and preview when it sends them
 * (detail.words, detail.preview, detail.always, detail.app); a safe sentence of our own when it doesn't.
 */
export function card(a: Json, state: Json): Card {
  const name = crewName(state, a.bot);
  const d = a.detail ?? {};
  const base = { id: a.id, helper: a.bot, at: a.at, reply: false };
  if (a.kind === 'connect' || d.app) {
    const app = apps(state).find((x) => x.id === d.app) ?? APPS[0];
    return { ...base, kind: 'connect', app, head: `${name} could use ${app.name}`, words: plain(d.words ?? `${name} can do this with your ${app.name}. Connect it?`),
      choices: [{ label: `Connect ${app.name}`, body: { answer: 'allow' }, primary: true }, { label: 'Not now', body: { answer: 'deny' } }] };
  }
  if (a.kind !== 'permission') {
    return { ...base, kind: 'question', reply: true, head: `${name} has a question`,
      words: d.question ? plain(d.question) : `${name} stopped to check something with you. Tell ${name} what to do:`, choices: [] };
  }
  const spend = !!d.spends || d.effect === 'spend';
  const words = d.words ? plain(d.words) : spend ? `${name} wants to use something that costs money. Is that all right?` : `${name} would like your OK to carry on.`;
  const choices: Choice[] = [{ label: spend ? 'OK, spend it' : d.effect === 'send' ? 'Send' : 'Yes, go ahead', body: { answer: 'allow', scope: 'once' }, primary: true }];
  // "Always" is a relationship ("Always OK for Aunty Sara"), and money never gets one.
  if (!spend && (d.always || d.rule)) choices.push({ label: `Always OK for ${d.always ?? name}`, body: { answer: 'allow', scope: 'always' } });
  choices.push({ label: 'Not now', body: { answer: 'deny' } });
  return {
    ...base, kind: spend ? 'spend' : 'ok', words, choices,
    head: spend ? `${name} needs a quick OK` : d.effect === 'send' ? `${name}'s ${d.thing ?? 'message'} is ready to send` : `${name} would like your OK`,
    preview: d.preview ? { head: d.preview.head ? plain(d.preview.head) : undefined, body: plain(d.preview.body ?? '') } : undefined,
  };
}
export const cards = (state: Json) => state.asks.map((a: Json) => card(a, state)) as Card[];

// ---------- work and things ----------
export function work(state: Json): Work[] {
  const mine = new Set(crew(state).map((h) => h.id));
  return state.bots.filter((b: Json) => mine.has(b.id) && (b.task || b.queued)).map((b: Json) => {
    const s = b.step && step(b.step);
    const needs = b.task?.state === 'needs_you';
    return { helper: b.id, title: plain(b.task?.title ?? 'Up next'), line: needs ? 'Waiting for your OK' : s ? s : b.task ? 'Getting started…' : 'Waiting its turn', waiting: !b.task || needs };
  });
}

export function things(state: Json): Thing[] {
  return state.tasks.filter((t: Json) => t.state === 'done').map((t: Json) => ({
    id: t.id, helper: t.bot, title: plain(t.title), at: t.updated_at, summary: plain(t.result ?? '').slice(0, 220),
    files: (t.files ?? []).map((f: string) => fileView(t.bot, f)),
  }));
}

/** Ideas are promises from a named helper; Chief offers three of his own when the crew has none. */
export function ideas(state: Json) {
  const own = state.ideas.map((i: Json) => ({ bot: i.bot, label: plain(i.promise), ask: i.ask }));
  return own.length ? own : [
    { bot: 'chief', label: "Plan this week's dinners", ask: "Plan this week's dinners and make a shopping list" },
    { bot: 'chief', label: 'Write a birthday message', ask: 'Help me write a birthday message for ' },
    { bot: 'chief', label: "What's on this week?", ask: "What's on this week?" },
  ];
}

// ---------- the trail ("Show the work", as steps) ----------
const ANSWER: Record<string, string> = { allow: 'yes', deny: 'not now' };
/** One friendly step per event, or null for machinery nobody needs to see. */
export function step(e: Json): string | null {
  const d = e.data ?? {};
  switch (e.kind) {
    case 'task.created': return `Got the job: “${plain(d.title)}”`;
    case 'task.working': return `Started on “${plain(d.title)}”`;
    case 'task.progress': return plain(d.text) || null;
    // crewd writes the step in plain words ("Searched the web for “school trips”", "Worked on a video").
    case 'run.tool': return d.words ? plain(d.words) : 'Worked on it';
    case 'run.allowed': return 'Went ahead, as you allowed';
    case 'ask.opened': return 'Asked for your OK';
    case 'ask.answered': return `You said ${ANSWER[d.answer] ?? (/always/.test(d.answer) ? 'always OK' : /task/.test(d.answer) ? 'yes for this job' : 'what to do')}`;
    case 'file.delivered': return `Made “${pretty(d.path)}”`;
    case 'memory.learned': return `Learned: ${plain(d.text)}`;
    case 'memory.undone': return `You undid: ${plain(d.text)}`;
    case 'run.resumed': return 'Picked up where it left off';
    case 'desktop.takeover': return 'You took the wheel';
    case 'desktop.giveback': return 'You handed the wheel back';
    case 'task.paused': return `Paused “${plain(d.title)}” for now`;
    case 'task.done': return `Finished “${plain(d.title)}”`;
    case 'task.failed': return `Couldn't finish “${plain(d.title)}”`;
    default: return null;
  }
}

/** A task's steps, oldest first, repeats folded ("Worked on it" once, not forty times). */
export function steps(events: Json[], task?: number, live = false): Step[] {
  const rows = [...events].sort((a, b) => a.seq - b.seq).filter((e) => task == null || e.data?.task === task);
  const out: Step[] = [];
  let started = false;
  for (const e of rows) {
    if (e.kind === 'task.working') { if (started) continue; started = true; }
    const text = step(e);
    if (!text || out.at(-1)?.text === text) continue;
    out.push({ at: e.at, text, seq: e.seq, asked: e.kind === 'ask.opened', undo: e.kind === 'memory.learned' && !e.undone });
  }
  if (live && out.length) out[out.length - 1].now = true;
  return out;
}

// ---------- a chat ----------
export function lines(page: Json, bot: string): Line[] {
  return (page?.messages ?? []).map((m: Json) => {
    const text = String(m.text ?? '');
    if (m.author === 'system') {
      const f = /^Delivered (files\/.+?)(?::\s|$)/.exec(text);
      return f ? { id: m.id, from: 'note', text: plain(text.slice(f[0].length)) || `Here's “${pretty(f[1])}”`, files: [fileView(bot, f[1])], choices: [] }
        : { id: m.id, from: 'note', text: plain(text), files: [], choices: [] };
    }
    return { id: m.id, from: m.author === 'person' ? 'me' : m.author === 'chief' && bot !== 'chief' ? 'chief' : 'them',
      text: m.author === 'person' ? text : plain(text), files: [], choices: (m.choices ?? []).map(plain) };
  }).filter((l: Line) => l.text || l.files.length);
}

/** What a helper remembers about you, one line each, from its notes. */
export const memories = (notes = '') => notes.split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter((l) => l && !l.startsWith('#')).map(plain);

// ---------- routines, people, accounts, apps ----------
export function routines(state: Json, bot?: string) {
  return state.routines.filter((r: Json) => !bot || r.bot === bot).map((r: Json) => ({
    id: r.id, name: plain(r.name), helper: r.kind === 'digest' ? 'chief' : r.bot, when: r.words, paused: r.state === 'paused', next: clock(r.next_at), digest: r.kind === 'digest',
    last: r.history?.[0] ? `Last ran ${clock(r.history[0].at)}${r.history[0].kind === 'routine.skipped' ? ', skipped while busy' : ''}` : '',
  }));
}

/** The AI accounts a person can think with, in the order the app offers them. Never another brand, and never Claude. */
export const AIS = [{ key: 'chatgpt', name: 'ChatGPT' }]; // the one front door; crewd keeps other accounts as quiet paths

/** One of the person's own AI accounts: signed in, or a sign-in in progress as a link and a code. */
export function account(accounts: Json[] | null, member: number, key = 'chatgpt') {
  const a = accounts?.find((x) => x.member === member && x.account === key);
  if (!a) return { state: 'checking' as const, signing: null, expired: false, failed: false, resting: '' };
  const s = a.signIn;
  const signing = s?.state === 'waiting' && s.code ? { url: s.url ?? '', code: s.code } : null;
  const expired = s?.state === 'failed' && /expired|too long/i.test(s.error ?? '');
  // 'unavailable' was the CLI missing; the engine now ships inside Crewhouse, so there is always something to sign in to.
  return { state: a.signedIn ? 'ready' as const : 'signed-out' as const as 'ready' | 'signed-out' | 'unavailable',
    signing, expired, failed: s?.state === 'failed' && !expired, resting: a.restingUntil > 0 ? `Resting until ${clock(a.restingUntil)}` : '' };
}
export const chatgpt = (accounts: Json[] | null, member: number) => account(accounts, member, 'chatgpt');
/** The account the crew thinks with: the first one signed in. Null while checking, 'none' when there is none yet. */
export function thinking(accounts: Json[] | null, member: number) {
  if (!accounts) return null;
  return AIS.find((a) => account(accounts, member, a.key).state === 'ready') ?? 'none';
}

/** Whose sign-in page an app opens: "Google" for Gmail, Calendar and Drive. */
export const signsInWith = (app: App) => ({ gmail: 'Google', calendar: 'Google', drive: 'Google', outlook: 'Microsoft', photos: 'your phone' } as Record<string, string>)[app.id] ?? app.name;
export const appById = (state: Json, id: string) => apps(state).find((a) => a.id === id);

const APPS: App[] = [
  { id: 'photos', name: 'Phone photos', mark: '✿', bg: 'linear-gradient(135deg,#ffc27a,#ff7aa2)', on: false, does: 'Helpers can use photos you pick. Nothing else.' },
  { id: 'gmail', name: 'Gmail', mark: 'M', bg: '#ea4335', on: false, does: 'Helpers can read and draft. Sending always asks you first.' },
  { id: 'calendar', name: 'Calendar', mark: '31', bg: '#4285f4', on: false, does: 'Helpers can see your week and add things. You can undo any change.' },
  { id: 'drive', name: 'Drive', mark: '▲', bg: '#fbbc04', on: false, does: 'Helpers can save copies of what they make.' },
  { id: 'outlook', name: 'Outlook', mark: 'O', bg: '#0a64d6', on: false, does: 'Helpers can read and draft. Sending always asks you first.' },
  { id: 'notion', name: 'Notion', mark: 'N', bg: '#2e2a40', on: false, does: 'Helpers can read and add pages you share with them.' },
  { id: 'canva', name: 'Canva', mark: 'C', bg: 'linear-gradient(135deg,#00c4cc,#7d2ae8)', on: false, does: 'Helpers can make designs in your Canva.' },
  { id: 'spotify', name: 'Spotify', mark: '♫', bg: '#1db954', on: false, does: 'Helpers can make playlists for you.' },
];
/** The app grid; which ones are on comes from crewd's connections once it has them. */
export const apps = (state: Json): App[] => APPS.map((a) => ({ ...a, on: !!state.connections?.includes?.(a.id) }));
