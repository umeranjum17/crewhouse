// The thin adapter: crewd's state in, plain words out. Every screen reads these view models and nothing raw,
// so the engine underneath can change (docs/ui-contract.md) without the screens changing, and nothing technical
// (commands, file paths, model names, percentages, raw prompts) can reach a person. test/ui.test.ts holds this.
import { PROVIDERS as ROUTES } from '@byokit/accounts';
import { phaseOf } from '@byokit/ui-core/phase';
import type { Json } from './api.ts';
import { safeLink } from './chat-md.ts';
import { PALS, type Kind, type Mood } from './art.ts';

export type Helper = {
  id: string; name: string; kind: Kind; mood: Mood; ring: 'working' | 'needs' | ''; status: string; role: string;
  computer: boolean; driving: boolean; stuckFor: number; quietSince: number; things: FileView[]; seat: Seat;
};
export type Choice = { label: string; body: Json; primary?: boolean };
export type Card = {
  id: number; helper: string; kind: 'ok' | 'spend' | 'question' | 'connect' | 'routine' | 'plan'; head: string; words: string;
  preview?: { head?: string; body: string }; choices: Choice[]; reply: boolean; app?: App; at: number;
  /** Chief's offered routine: the lines to confirm (cadence, what, quiet, first run), the schedule words to edit, and
   *  the time-zone line when the home computer's clock sits in another zone from this device's. */
  lines?: string[]; schedule?: string; zoneNote?: string;
  /** A reminder is the person's own one moment: the card says when it is, and offers nothing else to remember. */
  remind?: boolean;
  /** A checkout: the inbox opens the review before any yes, and the sheet's yes names the order.
   *  `known`: crewd could read the total. Without it, the safe way out is the person buying it themselves. */
  review?: boolean; order?: { shown: string; known: boolean; dollars: boolean };
  /** One ask-card layout for every kind (§4.4): the kind changes only the status line under the helper's name,
   *  the evidence block and the button words. `evidence` picks the sunken block — a form's or a job's
   *  label-over-value lines, or a draft's to/subject/body — an order is a `review`, anything else a plain preview. */
  status: string; evidence?: 'lines' | 'draft'; draftTo?: string; draftSubject?: string;
  /** The person's own question for an OK or a spend: their task's title, with a question mark if it has no ending of its
   *  own. The tool's words (site, lines) stay on the review sheet. */
  question?: string;
  /** A draft's own words, unscrubbed: the person may change them before Approve, and their version is what is kept. */
  draftText?: string;
};
/** The small line above an ask's title: what kind of yes it wants, so the title itself can stay plain. */
export const askTag = (c: Card) => ({ spend: 'Wants to spend money', question: 'Has a question', routine: 'A routine to start', plan: 'A plan to start', connect: 'Wants an app' } as Record<string, string>)[c.kind] ?? 'Needs your OK';
export type Work = { helper: string; title: string; line: string; waiting: boolean; things: FileView[] };
export type Thing = { id: number; helper: string; title: string; at: number; summary: string; files: FileView[] };
export type FileView = { url: string; kind: 'video' | 'image' | 'doc' | 'sheet' | 'page'; name: string; review?: Review };
/** One tab of a delivered workbook, read back by crewd: its headings, its first rows, how many it has,
 *  and the parallel row numbers and cell roles (`head`, `in`, `calc`, or empty) the panel reads. */
export type Sheet = { name: string; head: string[]; rows: string[][]; total: number; nums: number[]; roles: string[][] };
export type Workbook = { name: string; sheets: Sheet[] };
/** One part of a delivered document, read back by crewd: a heading, a paragraph, a bullet, or a table. */
export type DocPart = { kind: 'heading' | 'p' | 'li' | 'table'; text?: string; bold?: boolean; items?: string[]; head?: string[]; rows?: string[][] };
export type DocView = { name: string; parts: DocPart[] };
export type Step = { at: number; text: string; now?: boolean; asked?: boolean; seq: number; undo?: boolean };
/** `unsure`: crewd's line for a job that acted but couldn't confirm it worked, shown apart from the helper's own words. */
export type Line = { id: number; from: 'me' | 'them' | 'chief' | 'note'; text: string; files: FileView[]; choices: string[]; at?: number; unsure?: boolean; recap?: boolean;
  /** A tray notice's helper (Chief's thread): the small face beside "Tracer finished … · it's in your tray". */
  by?: string;
  /** A helper speaking in Chief's thread (its finished job or its question, in its own words): its face and name lead. */
  helper?: string;
  /** Chief's full assignment in a helper's chat, behind Show details: the line itself stays one short ask. */
  detail?: string;
  /** What a delivered workbook or document holds, said once: the web's card says it itself, the phone shows these. */
  about?: string };
/** The one-use pairing ticket is rendered in Chief's chat, never as chat text. */
export const phoneOffer = (page: Json): { qr: string; typed: string; expires: number; message: number; token?: string; waiting?: { id: number; name: string; words: string }; joined?: string } | null => page?.phoneOffer ?? null;
export type App = { id: string; name: string; mark: string; bg: string; on: boolean; does: string; warns?: boolean };

// ---------- words ----------
export const clock = (t: number) => {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  if (d.toDateString() === new Date().toDateString()) return time;
  return Math.abs(t - Date.now()) < 6 * 86_400_000 ? `${d.toLocaleDateString([], { weekday: 'short' })} ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};
const at = (t: number | string) => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t));
export const greeting = (h = new Date().getHours()) => (h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
/** The person's quiet hours in Home's words ("Quiet from 11 pm", "Quiet until 7 am"); '' when they have none. */
export function quietLine(person: Json): string {
  const q = String(person?.quiet ?? '');
  const m = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(q);
  if (!m) return '';
  const say = (h: number, min: number) => `${h % 12 || 12}${min ? `:${String(min).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
  return person.quietNow ? `Quiet until ${say(+m[3], +m[4])}` : `Quiet from ${say(+m[1], +m[2])}`;
}
/** The small line over Home's greeting: the day, in the reader's own words ("Sunday 28 September"). */
export const today = (d = new Date()) => d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
/** The marker between chat lines from different days: Today, Yesterday, or the date. */
export const dayLabel = (t: number, now = new Date()) => {
  const d = new Date(t), day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(now) - day(d)) / 86_400_000);
  return ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
};

/**
 * The runs-at-home promise, said once and read in three places: Hello, Settings, and the phone's This phone.
 * Each part is true of the code as it ships — the database, the crew's notes and everyone's sign-ins live on this
 * machine and crewd has no server of its own (README); a job's own words are the only thing sent to the person's own
 * AI account or a connected app (src/engine.ts, src/connections.ts); a phone notification carries no words at all (src/link.ts).
 * `home` names the machine from wherever the line is read, `plan` the one the crew thinks with (`planName`). Keep it
 * free of technical words; test/ui.test.ts pins it. The middle line is `awake`, the one condition every surface that
 * mentions the computer or pairing repeats word for word.
 */
export const awake = (home = 'this computer') => `The crew works only while ${home} is on and connected to the internet.`;
export const atHome = (home = 'this computer', plan = 'AI plan') => [
  `Your helpers live on ${home} and use your own sign-ins.`,
  awake(home),
  `Nothing you tell them is kept anywhere else — only what a job needs goes to your ${plan} or the app it's using.`,
];

/** A file's name as a person would say it: "files/mum-birthday_v2.mp4" → "Mum birthday v2". */
export function pretty(path: string) {
  const b = (path.split('/').pop() ?? path).replace(/\.[a-z0-9]+$/i, '').replace(/[-_.]+/g, ' ').trim();
  return b ? b[0].toUpperCase() + b.slice(1) : 'A file';
}
/** The bot and path a file view came from, for the phone's photo fetch: `/files/<bot>/<path under files/>`. */
export const fileSource = (url: string) => { const m = /^\/files\/([a-z0-9-]+)\/(.+)$/.exec(url); return m ? { bot: m[1], path: `files/${decodeURIComponent(m[2])}` } : null; };

/** Crewd's own check on a suggested change, as a person reads it: did it pass, what the check actually found, when, and
 *  whether a newer run overturned an older verdict. Nothing at all when no check ever ran on this change. */
export type Review = { task: number; ok: boolean; why: string; when: number; runs: number; changed: boolean };
const WHY = (d: Json) => d.passed ? 'the check failed on the old code and passes with this change'
  : d.missingDep ? 'the check could not run: something it needs is not installed'
  : Number(d.after) === 0 ? 'the check passes here but never failed before the change, so nothing was proved'
  : Number(d.before) === 0 ? 'the check passed before the change and fails after it: the change broke it'
  : 'the same check still fails after the change';

/** Every check crewd has run, newest verdict for each suggested change, keyed `bot|files/x.patch`. A second run on the
 *  same change is the current one; `changed` marks a verdict a newer run overturned, so nobody acts on the stale one. */
export function reviews(state: Json) {
  const out = new Map<string, Review>();
  for (const e of (state.events ?? []) as Json[]) {
    if (e.kind !== 'verify.result') continue;
    const d = (e.data ?? {}) as Json, key = `${e.bot}|${d.patch}`, prev = out.get(key);
    out.set(key, { task: Number(d.task), ok: d.passed === true, why: WHY(d), when: at(e.at), runs: (prev?.runs ?? 0) + 1, changed: !!prev && prev.ok !== (d.passed === true) });
  }
  return out;
}

export function fileView(bot: string, path: string, review?: Review): FileView {
  const rel = path.replace(/^files\//, '');
  const url = /^(data:|\/)/.test(path) ? path : `/files/${bot}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  if (path.startsWith('data:image/')) return { url, name: 'A picture', kind: 'image' };
  return { url, name: pretty(rel), kind: /\.(mp4|webm|mov)$/i.test(rel) ? 'video' : /\.(png|jpe?g|webp|gif)$/i.test(rel) ? 'image' : /\.xlsx?$/i.test(rel) ? 'sheet' : /(\.docx?|\.md|\.txt)$/i.test(rel) ? 'page' : 'doc', ...(review ? { review } : {}) };
}

/** Where a tap on a delivered file goes: the read-only panel for a page or sheet, the file itself (a PDF, a download)
 *  otherwise — a written page never opens as the raw file. The chip is the kind of thing it is, as a person meets it. */
export function fileTarget(f?: FileView): { href: string; chip: string } | null {
  if (!f) return null;
  const src = fileSource(f.url);
  const panel = (f.kind === 'sheet' || f.kind === 'page') && src;
  return { href: panel ? `#/f/${src.bot}/${encodeURIComponent(src.path)}` : f.url,
    chip: (f.url.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? 'file').toUpperCase() };
}

/** What a phone opens in its own reader: the same crewd-parsed words the web's panel shows — a document, a written
 *  page, a spreadsheet — and a video, fetched over the link in pieces. Any other file really is on the computer. */
export const phoneReadable = (f: FileView) => !!fileSource(f.url) && (f.kind === 'page' || f.kind === 'sheet' || f.kind === 'video');

/**
 * A workbook crewd read for the app (docs/ui-contract.md): the tabs, the heading row, and the first rows as a read-only
 * table. What is in a sheet is the helper's own doing, so every cell is read the way its chat words are.
 */
export function workbook(json: Json, name: string): Workbook {
  return {
    name,
    sheets: (Array.isArray(json?.sheets) ? json.sheets : []).slice(0, 12).map((s: Json) => {
      const rows = (Array.isArray(s?.rows) ? s.rows : []).slice(0, 501)
        .map((r: Json) => (Array.isArray(r) ? r : []).slice(0, 24).map((c: Json) => plain(String(c ?? '')).slice(0, 160)));
      const nums = (Array.isArray(s?.nums) ? s.nums : []).slice(0, 501).map((n: Json) => Number(n) || 0);
      const roles = (Array.isArray(s?.roles) ? s.roles : []).slice(0, 501)
        .map((r: Json) => (Array.isArray(r) ? r : []).slice(0, 24).map((c: Json) => ['head', 'in', 'calc'].includes(String(c)) ? String(c) : ''));
      return { name: plain(String(s?.name ?? '').trim()) || 'Sheet', head: rows[0] ?? [], rows: rows.slice(1), total: Number(s?.total) || rows.length, nums, roles };
    }),
  };
}
/** A sheet's column letter: A, B, C… (workbook() keeps 24 columns at most, so one letter always does). */
export const column = (i: number) => String.fromCharCode(65 + i);
/** How many tabs a workbook has, said the way a person would: "One sheet", "4 sheets". */
export const sheetWords = (n: number) => (n === 1 ? 'One sheet' : n > 1 ? `${n} sheets` : 'A spreadsheet');
/** How many sections a document has, said the way a person would: "3 sections", "One section", "A document". */
export const pageWords = (n: number) => (n === 1 ? 'One section' : n > 1 ? `${n} sections` : 'A document');

/** Link only web URLs in document text — bare, or a written citation like [SEC](https://…) whose label becomes the
 *  link text — leaving punctuation, other schemes and unsafe-looking strings as literal text. */
export function docLinks(text: string): { text: string; href?: string }[] {
  return text.split(/(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>]+)/g).flatMap((part) => {
    const md = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (md) {
      const href = safeLink(md[2]);
      return href ? [{ text: md[1], href }] : part ? [{ text: part }] : [];
    }
    const url = part.replace(/[”’"')\].,;:]+$/g, '');
    const href = /^https?:\/\//.test(part) ? safeLink(url) : '';
    return href ? [{ text: url, href }, ...(part.slice(url.length) ? [{ text: part.slice(url.length) }] : [])] : part ? [{ text: part }] : [];
  });
}

/** A delivered document is the person's file, not bot chatter: preserve its words, including URLs and product names. */
export function document(json: Json, name: string): DocView {
  const words = (v: Json) => String(v ?? '');
  const cells = (r: Json) => (Array.isArray(r) ? r : []).slice(0, 14).map(words);
  return {
    name,
    parts: (Array.isArray(json?.parts) ? json.parts : []).slice(0, 150).map((p: Json): DocPart | null => {
      const kind = ['heading', 'p', 'li', 'table'].includes(String(p?.kind)) ? (p.kind as DocPart['kind']) : 'p';
      if (kind === 'table') {
        const head = cells(p?.head);
        if (!head.length) return null;
        return { kind, head, rows: (Array.isArray(p?.rows) ? p.rows : []).slice(0, 40).map(cells) };
      }
      const text = words(p?.text);
      if (!text) return null;
      return { kind, text, ...(p?.bold === true ? { bold: true } : {}) };
    }).filter((p: DocPart | null): p is DocPart => p !== null),
  };
}

/** A delivered page's own text is content, not bot chatter; the renderer escapes markup. */
export const mdPlain = (text = '') => text;

/**
 * A helper's own words, scrubbed of the machinery: code spans, fenced blocks, file paths and the names of engines.
 * ponytail: a pattern scrub, not a guarantee; the engine's prompts keep bots in plain words (docs/ui-contract.md).
 */
/** A JSON object, three levels of nesting deep. Matching it balanced is the whole fix: a tool call's own array
 *  (a check's `["check.sh"]`) ends a `[^]]*` match early, which left the tail of the call rendered as if the
 *  person had typed it — a raw `"command":"sh check.sh"}]` in their own bubble. */
const OBJ = String.raw`\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}`;
const TOOL_CALL = new RegExp(String.raw`\[tool \w+ ${OBJ}\s*\]?`, 'g'); // a tool call is an engine event, never a sentence
const TOOL_FRAGMENT = /\[tool\b[\s\S]*$/i; // ...and a cut-off one (task titles are trimmed) still isn't
const JSON_BLOB = new RegExp(OBJ, 'g'); // nor is a raw JSON object
/** The test engine's own prefix, never words a helper would say: the thread drops such a message and `answerOf` reads
 *  it as no answer at all, so the thread and what it made can never disagree about one. */
export const STUB = /\bstub [\w-]+:/;
export const noTools = (text = '') => text.replace(TOOL_CALL, ' ').replace(JSON_BLOB, ' ').replace(TOOL_FRAGMENT, '').replace(/\s{2,}/g, ' ').trim();

export function plain(text = '') {
  if (STUB.test(text)) return 'On it.';
  // Heading markers strip before noTools collapses whitespace (D23): a later heading must still sit at a line
  // start to be found — after the collapse every ### but the first survives mid-line as literal markup.
  return noTools(text.replace(/(^|\n)#{1,6}\s+/g, '$1'))
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`\n]*)`/g, (_, s: string) => (/^[\w.\-~\/]+\.[a-z0-9]{2,4}$/i.test(s) ? `“${pretty(s)}”` : /[\/\\$|]|--?\w/.test(s) ? '' : s))
    .replace(/(^|[\s(“"'])((~|\.{1,2})?\/[\w.\-~]+)+\/?(?=[\s).,;:!?”"']|$)/g, (_, pre: string, p: string) => `${pre}${/\.[a-z0-9]{2,4}$/i.test(p) ? `“${pretty(p)}”` : 'its folder'}`)
    .replace(/\bfiles\/([\w.\-]+)/g, (_, f: string) => `“${pretty(f)}”`)
    .replace(/\b(claude(\s+code)?|anthropic|codex|sonnet|opus|haiku|gpt-[\w.]+|herdr|mcp__\w+|crew_[a-z_]+)\b/gi, 'the crew')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
/** A teaser line (a chat list row, a Things summary): plain words, no raw ** emphasis marks — those render only in a chat bubble. */
export const teaser = (text: string) => plain(text).replace(/(\*\*|\*)(?=[^\s*])([^*]*[^\s*])\1/g, '$2');

// ---------- the crew ----------
const KINDS = Object.keys(PALS) as Kind[];
/** The looks for helpers no template draws (Chief's made-up hires): never a template pal's clone. */
const MADE: Kind[] = ['pip', 'bow', 'cap', 'specs', 'scarf'];
/** Which pal a bot looks like: its template's, else a steady pick from its name that skips a look someone who joined
 *  before it already wears (`crew`, in joining order), so a new hire stands apart until every look is taken. */
export function kindOf(b: Json, crew: Json[] = []): Kind {
  const drawn = (x: Json) => (KINDS as string[]).includes(String(x?.template ?? x?.id)) && !(MADE as string[]).includes(String(x?.template ?? x?.id));
  if (drawn(b)) return String(b.template ?? b.id) as Kind;
  const worn = new Set<Kind>();
  const order = crew.some((x) => x.id === b?.id) ? crew : [...crew, b];
  for (const x of order.filter((x) => x.id !== 'chief' && !drawn(x))) {
    let h = 0;
    for (const c of String(x?.id ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const k = [...MADE.keys()].map((i) => MADE[(h + i) % MADE.length]).find((m) => !worn.has(m)) ?? MADE[h % MADE.length];
    if (x.id === b?.id) return k;
    worn.add(k);
  }
  return MADE[0];
}

/** A helper's desk: its active job's delivered files as views, own output first, one row per path where it
 *  last landed. Photos ride in the chat, never on the desk. */
export function deskThings(id: string, task: Json | null): FileView[] {
  const paths = ((task?.files ?? []) as Json[])
    .filter((f) => !f?.photo && !String(f?.path ?? '').startsWith('files/photos/'))
    .map((f) => String(f?.path ?? ''))
    .filter(Boolean);
  return paths.filter((p, i) => paths.lastIndexOf(p) === i).map((p) => fileView(id, p));
}

/** A job held for something other than the person's answer, in crewd's own words: their sign-in or plan, tomorrow's
 *  share, or an account back at a set time. */
const waitWords = (why: unknown, wake?: number | string | null) => {
  const w = plain(String(why ?? ''));
  return /^Waiting for /.test(w) ? w.split(':')[0].replace(/\.$/, '') : wake ? `Waiting until ${clock(at(wake))}` : 'Waiting';
};
const midnight = () => new Date().setHours(0, 0, 0, 0);

/** One helper, from crewd's row and its jobs (`tasks`, newest first): the seat says only what crewd holds. A working job
 *  with no news past crewd's limit has gone quiet (never "working"); a held job waits, with crewd's reason; the last job
 *  that ended badly today says so until a newer one starts. */
export function helper(b: Json, events: Json[] = [], crew: Json[] = [], tasks: Json[] = []): Helper {
  const needs = b.task?.state === 'needs_you';
  const stuck = !!b.stuck;
  const driving = b.controls === 'person';
  const mine = b.task ? [] : tasks.filter((t) => t.bot === b.id);
  const held = mine.find((t) => t.state === 'paused');
  const ended = ['failed', 'unsure'].includes(mine[0]?.state) && at(mine[0].updated_at) >= midnight() ? mine[0] : null;
  const seat: Seat = driving ? 'waiting' : needs ? 'chat' : stuck ? 'quiet' : b.task ? 'working'
    : held || b.pausedUntil ? 'waiting' : b.queued ? 'next' : ended ? 'failed' : 'free';
  const status = driving ? 'Paused while you drive' : needs ? 'Needs you' : b.task ? b.task.title
    : held || b.pausedUntil ? waitWords(held?.result, held?.wake_at ?? b.pausedUntil) : b.queued ? 'Up next'
    : ended ? (ended.state === 'unsure' ? 'Not sure it worked' : "Didn't finish") : 'Free to help';
  return {
    id: b.id, name: b.display, kind: kindOf(b, crew), role: plain(b.role ?? ''), status: plain(status), computer: !!b.computer, driving,
    mood: helperMood(b, seat, events), seat,
    ring: needs ? 'needs' : b.task ? 'working' : '',
    stuckFor: stuck ? Math.max(1, Math.round((Date.now() - b.quietSince) / 60_000)) : 0, quietSince: b.quietSince ?? 0,
    things: deskThings(b.id, b.task ?? null),
  };
}

/** A helper's face follows its seat: waiting on you, gone quiet, a job that ended badly today, fresh work (5 minutes),
 *  on the job, held, else content. */
function helperMood(b: Json, seat: Seat, events: Json[]): Mood {
  if (seat === 'chat') return 'ask';
  if (seat === 'quiet') return 'worried';
  if (seat === 'failed') return 'error';
  if (events.some((e) => e.kind === 'task.done' && e.bot === b.id && Date.now() - at(e.at) < 5 * 60_000)) return 'happy';
  if (b.task) return 'work';
  if (seat === 'waiting') return 'rest';
  return 'idle';
}

/** Settings, Phones, "Reach it away from home": one of three states in plain words, and the steps still to do. The
 *  connector app uses the same account on your computer and phone, so Settings never names it. */
export function anywhere(link: Json) {
  const state: 'home' | 'anywhere' | 'signin' = link?.anywhere === 'anywhere' || link?.anywhere === 'signin' ? link.anywhere : 'home';
  const words = {
    home: 'Only at home. Phones reach this computer on the home Wi-Fi. To reach it away from home, get the connector app:',
    anywhere: "Reachable away from home. Your phone opens Crewhouse on mobile data too. To add your phone:",
    signin: "The connector app needs signing in again on this computer. Until then, phones reach it only on the home Wi-Fi. Open the connector app here and sign in.",
  }[state];
  const steps = [
    'On this computer, get the connector app and sign in with Google.',
    "On your phone, get the same app and sign in with the same Google account as this computer, or share this computer with that phone's account in the app.",
    'Then pair your phone here.',
  ];
  return { state, words, steps: state === 'home' ? steps : state === 'anywhere' ? steps.slice(1) : [] };
}

/** What a quick knock on the computer's address found: `answers` (something is listening), `refused` (the computer
 *  answered, but nothing listens there), `timeout` (nothing came back within the bound). Never hangs: `ms` ends it. */
export type Knock = 'answers' | 'refused' | 'timeout';
// Migration debt (G06): reach has no portable probe(url, {timeout}) API.
export async function knock(url: string, ms = 4000, get: typeof fetch = fetch): Promise<Knock> {
  const stop = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => stop.abort(), ms);
  try { await get(url.replace(/^ws/, 'http'), { signal: stop.signal }); return 'answers'; }
  // ponytail: a phone's fetch error has no code, so a failure well inside the bound counts as refused; a Tailscale that
  // has no such peer drops the packets, which ends as a timeout.
  catch { return stop.signal.aborted || Date.now() - started >= ms - 100 ? 'timeout' : 'refused'; }
  finally { clearTimeout(timer); }
}

/** The phone can't reach the home computer: what it actually saw, and what to try. From the phone itself: `home` (on the
 *  same Wi-Fi as the computer's home address), `tailnet` (it knows the computer's Tailscale address), `vpn` (Tailscale
 *  is on on this phone), `knock` (what the computer's address did just now: its home one at home, else its Tailscale
 *  one); and from what the computer said when last in touch: `anywhere` (its own Tailscale), `peer` (whether its
 *  Tailscale had this phone as a peer, i.e. shared with this phone's account) and `reached` (when this phone last
 *  reached it over each route). Where the cause can't be told apart, it says so and names each thing to check. */
export function away(f: { home?: boolean; tailnet?: boolean; vpn?: boolean; anywhere?: string; knock?: Knock; peer?: boolean; reached?: { tailscale?: number } }) {
  if (f.home) {
    if (f.knock === 'refused') return "You're on the home Wi-Fi and the home computer answers, but Crewhouse isn't letting phones in there. Either Crewhouse isn't running on it, or its setting for phones on this Wi-Fi is off (then switch Tailscale on on this phone).";
    if (f.knock === 'answers') return "You're on the home Wi-Fi and Crewhouse on the home computer answers; this phone is getting back in touch.";
    return "You're on the home Wi-Fi, but the home computer doesn't answer at all. Check it's switched on and awake.";
  }
  if (!f.tailnet) return "Away from home, this phone reaches the home computer through Tailscale, and that isn't set up yet. Sign in to Tailscale on this computer and your phone with the same account, or share this computer with that phone's account in Tailscale.";
  if (!f.vpn) return 'Tailscale is off on this phone. Open the Tailscale app and switch it on.';
  if (f.anywhere === 'signin') return "The home computer's Tailscale needs signing in again. Open Tailscale on the computer and sign in.";
  if (f.knock === 'answers') return 'The home computer answers over Tailscale, so it is on; this phone is getting back in touch. If this lasts, restart Crewhouse on the computer.';
  if (f.knock === 'refused') return "The home computer answers over Tailscale, but Crewhouse isn't running on it. Open Crewhouse on the computer.";
  if (f.peer === false) return "The home computer isn't shared with this phone's Tailscale account: it checked when this phone was last in touch. Sign this phone in to the same Tailscale account as the computer, or share this computer with that phone's account in Tailscale and tap Accept on this phone.";
  if (f.reached?.tailscale) return `The home computer doesn't answer over Tailscale. This phone has reached it that way before (last ${clock(f.reached.tailscale)}), so sharing works: it's most likely asleep, switched off, or its Tailscale is off.`;
  return "This phone can't reach the home computer over Tailscale, and hasn't yet from away. Either the computer is asleep or off, or it hasn't been shared with this phone's Tailscale account: check both. Sign this phone in to the same Tailscale account, or share this computer with that phone's account in Tailscale.";
}

/** Settings, Phones: when a paired phone last reached this computer, and over which route; a phone that never has from
 *  away says so, since that is the route that fails unseen. */
export function reached(p: Json) {
  const r: Record<string, number> = p?.reached ?? {};
  const away = ['tailscale', 'relay'];
  const [via, t] = Object.entries(r).filter(([k]) => k === 'home' || away.includes(k)).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!via) return 'Not in touch yet';
  const last = `Last reached it ${clock(t)} ${via === 'home' ? 'on the home Wi-Fi' : 'away from home'}`;
  return away.some((k) => r[k]) ? last : `${last} · never from away yet`;
}

/** Settings, Phones: one plain line when notifications can't reach phones yet (README, "Phone notifications"). */
export const pushWords = (link: Json) => (link?.push === 'missing' ? "Phone notifications aren't switched on for this app yet, so phones hear news only when they open Crewhouse." : '');

/** When the crew is resting because an account ran out, in one sentence: "Your ChatGPT is resting until 6:40 pm". */
/** A show in progress on a helper's screen: what, and how many steps so far, in words. */
export function showing(state: Json, bot: string) {
  const s = state.showing?.[bot];
  return s ? { what: plain(s.what), words: s.steps ? `Showing how to ${plain(s.what)}: ${s.steps} step${s.steps === 1 ? '' : 's'} so far.` : `Showing how to ${plain(s.what)}. Go ahead; I'm watching.` } : null;
}

/** The helpers' tools the downloaded app is still fetching, in one sentence; empty when none. */
export function gettingReady(state: Json) {
  const ids: string[] = state.installing ?? [];
  if (!ids.length) return '';
  return ids.includes('browser') ? "Getting the helpers' own web browser ready: a big download, so it takes a few minutes. Everything else works meanwhile."
    : "Getting a few of the helpers' tools ready. Everything else works meanwhile.";
}
/** For the owner: a newer Crewhouse to download, in words. */
export const update = (state: Json) => (state.update ? { words: `A new Crewhouse is ready (${state.update.version}). Download it and open it, and the crew carries on where it was.`, url: String(state.update.url) } : null);

/** The owner's steps to switch Google on for your crew, each with the Google page it happens on (docs/google-setup.md). */
export const GOOGLE_STEPS = [
  { title: 'Make space for Crewhouse', url: 'https://console.cloud.google.com/projectcreate', says: 'Name it “Crewhouse (personal)” and press Create. No billing needed.' },
  { title: 'Switch on Calendar, Gmail and Drive', url: 'https://console.cloud.google.com/apis/library', says: 'Search “Google Calendar” and press Enable. Do the same for “Gmail” and “Google Drive”.' },
  { title: 'Describe the app', url: 'https://console.cloud.google.com/auth/overview', says: 'Pick External, call it “Crewhouse”, give your email. Under Data access add calendar.events, gmail.readonly and drive.file. Under Audience press Publish app, so it says “In production”.' },
  { title: 'Make the sign-in', url: 'https://console.cloud.google.com/apis/credentials', says: 'Create credentials → OAuth client ID → type “Desktop app”. Paste the Client ID and Client secret below.' },
];

/** crewd's word on each step once the sign-in is in (`house.steps`): checked from Google's own answers, or not. */
export type GoogleStep = { state: 'checked' | 'said' | 'missing'; note: string };
export const STEP_MARK = { checked: '✓ Checked', said: 'You said done', missing: 'Missing' } as const;
export const googleHeadline = (steps?: GoogleStep[] | null) => {
  const missing = steps?.findIndex((s) => s.state === 'missing') ?? -1;
  if (missing >= 0) return `Step ${missing + 1} is missing`;
  return steps?.every((s) => s.state === 'checked') ? 'Google is on ✓' : 'Google sign-in saved';
};

/** The one code a phone away from home types: the short code and the pairing code, with the mailbox's own
 *  address carried inside it, so the phone knows where to look and nobody types an address. Empty when there is none. */
export const phoneTyped = (t: Json) => {
  if (!t?.short || !t?.code) return '';
  let at = ''; try { at = new URL(t.relay).host; } catch { at = String(t.relay ?? ''); }
  return `${t.short}-${t.code}${at ? `@${at}` : ''}`;
};

/** Settings, Phones: whether phones reach this computer away from home, in one sentence. */
export function reach(link: Json) {
  let where = '';
  try { where = link?.relay ? new URL(link.relay).host : ''; } catch { /* kept as typed */ }
  const words: Record<string, string> = {
    online: `On. Phones reach this computer away from home through ${where}, which passes along what they say without being able to read it.`,
    connecting: `Getting in touch with ${where}…`,
    offline: `Can't reach ${where} right now. Trying again by itself.`,
    refused: `${where} didn't let this computer in. Ask whoever runs it for a new invitation and paste it below.`,
    replaced: 'Another copy of Crewhouse took over this address, so this one stepped back.',
  };
  const on = !!link?.relay && link.relayStatus !== 'off';
  return { on, online: link?.relayStatus === 'online', words: on ? words[link.relayStatus] ?? words.connecting : 'Off.' };
}

/** The crew's share of the viewer's own plan (`planName`), as three choices and one sentence about today. Never a number. */
export const shares = (plan = 'AI plan') => [
  { key: 'light', label: 'Light', says: `Leave most of my ${plan} for me` },
  { key: 'normal', label: 'Normal', says: 'Share it evenly' },
  { key: 'full', label: 'As much as it needs', says: 'Use what the work takes' },
];
/** The small line at the bottom of the side rail: how the crew's share of the account stands today. It says what Crewhouse
 *  itself knows — the share the person gave the crew — never how much of the provider's allowance is left. */
export const meter = (state: Json) => (state.share?.used ? 'The crew will carry on tomorrow' : resting(state) ? `${resting(state)}` : '');
export function share(state: Json, plan = 'AI plan') {
  const s = state.share ?? { choice: 'light', used: false };
  const part: Record<string, string> = { small: 'a small part', fair: 'a fair part', most: 'most' };
  return { choice: s.choice as string, week: part[s.week] ? `This week the crew has used ${part[s.week]} of what it may use of your ${plan}.` : '', today: s.used ? 'The crew has had its share for today. Routines and check-ins start again tomorrow morning; anything you ask for still goes ahead.'
    : s.choice === 'full' ? `When your ${plan} needs a rest, the crew waits and says so.` : 'The crew stays within the share you gave it.' };
}

/** The person's monthly money cap: "This month: nothing spent yet" or "$4 of $20 spent". */
export function money(state: Json) {
  if (!state.money) return null;
  const { cap, spent } = state.money as { cap: number; spent: number };
  const $ = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  return { cap, month: spent ? `This month: ${$(spent)} of ${$(cap)} spent.` : 'This month: nothing spent yet.' };
}

export function resting(state: Json) {
  const r = Object.entries(state.resting ?? {}).filter(([, t]) => t) as [string, number][];
  if (!r.length) return '';
  const when = clock(Math.min(...r.map(([, t]) => t)));
  const ai = AIS.find((a) => a.key === r[0][0]);
  return r.length === 1 && ai ? `Your ${ai.name} is resting until ${when}` : `The crew is resting until ${when}`;
}

/**
 * Chief's mood and his one line for the whole crew. The first matching row wins, so the face follows how things are
 * actually going; `local` carries what only the app knows (the computer out of reach, his composer, the sign-in).
 * Every Chief render — hero, sidebar, avatars, chat header — reads this.
 */
/** `bare`: no job's words, only names (the bubble's panel and the status bar, which sit over other apps). */
export type ChiefLocal = { offline?: boolean; listen?: boolean; signedOut?: boolean; bare?: boolean };
export type ChiefView = { mood: Mood; line: string; tone: 'ok' | 'wait' | 'off'; rank: number };
export function chief(state: Json, local: ChiefLocal = {}): ChiefView {
  const v = chiefRow(state, local);
  if (local.offline) return { mood: 'rest', line: 'The home computer is asleep', tone: 'off', rank: 1 };
  if (local.listen) return { ...v, mood: 'listen', rank: 2 }; // he leans in; the line stays as it was
  return v;
}

/** Chief's chat top strip: his one line as standing state — who needs you, who is on what, who is resting. Never the
 *  echo of a job that just finished: when that was the last thing to happen, the strip says how things stand ("All quiet."). */
export function stripLine(state: Json, local: ChiefLocal = {}) {
  const v = chief(state, local);
  return v.mood === 'happy' ? 'All quiet.' : v.line;
}

/** The priority table, minus the listen row (the caller's `local` carries it, with offline and the sign-in). */
function chiefRow(state: Json, local: ChiefLocal): ChiefView {
  const all = crew(state);
  const now = Date.now();
  const events = (state.events ?? []) as Json[];
  const asks = state.asks.length;
  const needs = all.find((h) => h.ring === 'needs');
  const stuck = all.find((h) => h.stuckFor > 0);
  const busy = all.filter((h) => h.ring === 'working');
  const rest = resting(state);
  const recent = (kind: string, ms = 30 * 60_000) => events.filter((e) => e.kind === kind && now - at(e.at) < ms).sort((a, b) => at(b.at) - at(a.at));
  const botOf = (id: string) => state.bots.find((b: Json) => b.id === id);
  const failure = recent('task.failed').concat(recent('task.unsure'))
    .find((e) => ((botOf(String(e.bot))?.unread ?? 0) > 0));
  const done = recent('task.done', 5 * 60_000)[0];
  const name = (id: string) => crewName(state, id);
  const line = needs ? `${needs.name} needs you`
    : asks ? `${name(state.asks[0].bot)} needs you`
    : busy.length === 1 ? (local.bare ? `${busy[0].name} is working` : `${busy[0].name} is on “${busy[0].status}”`)
    : busy.length > 1 ? `${busy.map((h) => h.name).join(' and ')} are working`
    : rest || 'Keeping an eye on things';
  const view: ChiefView =
    failure ? { mood: 'error', line: `${name(String(failure.bot))} couldn't finish ${local.bare ? 'a job' : `“${plain(failure.data?.title ?? '') || 'its job'}”`}`, tone: 'wait', rank: 3 }
    : stuck ? { mood: 'worried', line: `${stuck.name} has gone quiet`, tone: 'wait', rank: 4 }
    : local.signedOut ? { mood: 'worried', line: 'Waiting for your sign-in', tone: 'wait', rank: 4 }
    : needs || asks ? { mood: 'ask', line, tone: 'wait', rank: 5 }
    : done ? { mood: 'happy', line: `${name(String(done.bot))} finished ${local.bare ? 'a job' : `“${plain(done.data?.title ?? '') || 'a job'}”`}`, tone: 'ok', rank: 6 }
    : busy.length ? { mood: 'work', line, tone: 'ok', rank: 7 }
    : rest ? { mood: 'rest', line: rest, tone: 'off', rank: 8 }
    : { mood: 'idle', line: 'Keeping an eye on things', tone: 'ok', rank: 9 };
  return view;
}
const crewName = (state: Json, id: string) => state.bots.find((b: Json) => b.id === id)?.display ?? 'The crew';

/** Named only when the home computer's clock sits in a different zone from this device's: routine times are home time. */
export function zoneNote(state: Json) {
  const z = state.zone as string | undefined;
  const mine = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  return z && mine && z !== mine ? `Times follow the home computer's clock (${z}).` : '';
}

/** The person's helpers. */
export function crew(state: Json) {
  return state.bots.filter((b: Json) => b.id !== 'chief').map((b: Json) => helper(b, state.events ?? [], state.bots, state.tasks ?? [])) as Helper[];
}

/** One thread in the chat list: Chief pinned on top, then the helpers, the latest talk first. */
export type Chat = { id: string; name: string; who: Helper | 'chief'; line: string; at: number; unread: number; ring: Helper['ring'] };
/** A thread's last line as the list shows it: "You: …", "Sent “Birthday video”", or the bot's words. */
export function preview(last: Json | null | undefined, status = '') {
  if (!last) return status || 'Say hello';
  const n = photos(String(last.text ?? '')).length;
  const said = String(last.text ?? '').replace(PHOTO, '').trim();
  const text = n && (!said || /^Here (is a photo|are some photos)\.$/.test(said)) ? (n === 1 ? 'Photo' : `${n} photos`) : said;
  const f = /^Delivered (files\/.+?)(?::\s|$)/.exec(text);
  if (f) return `Sent “${pretty(f[1])}”`;
  return last.author === 'person' ? `You: ${text.replace(/\s+/g, ' ')}` : teaser(text.replace(/\s+/g, ' '));
}
/** What Chief last said himself, for his hero (B1): his own message, never the person's; '' when he has said nothing. */
export function chiefSaid(state: Json): string {
  const last = state.bots.find((b: Json) => b.id === 'chief')?.last;
  return last && last.author !== 'person' && !last.helper && String(last.text ?? '').trim() ? preview(last) : ''; // a helper's own words are never Chief's
}
export function chats(state: Json): Chat[] {
  const bot = (id: string) => state.bots.find((b: Json) => b.id === id) ?? {};
  const c = chief(state);
  // A helper's suggestion ("learned something", Chief has a suggestion) lives in its chat; its row carries the dot.
  const suggested = new Set((state.asks as Json[]).filter((a) => a.kind === 'propose').map((a) => a.bot as string));
  // The words the office uses: a row in Needs you says so, a job stopped for an answer in the chat says that.
  const waiting = new Set(needsYou(state).map((c) => c.helper));
  const lead: Chat = { id: 'chief', name: 'Chief', who: 'chief', line: preview(bot('chief').last, c.line), at: at(bot('chief').last?.at ?? 0) || 0, unread: (bot('chief').unread ?? 0) + (suggested.has('chief') && !(bot('chief').unread ?? 0) ? 1 : 0), ring: c.mood === 'ask' ? 'needs' : '' };
  const rest = crew(state).map((h): Chat => {
    const b = bot(h.id);
    // Working or waiting on the person says more than the last line did.
    const line = waiting.has(h.id) ? SEAT_WORDS.needs : h.seat === 'chat' ? SEAT_WORDS.chat : h.seat === 'quiet' ? `Gone quiet on: ${h.status}`
      : h.seat === 'working' ? `Working on: ${h.status}` : h.seat === 'waiting' ? h.status : preview(b.last, h.role);
    return { id: h.id, name: h.name, who: h, line, at: at(b.last?.at ?? 0) || 0, unread: (b.unread ?? 0) + (suggested.has(h.id) && !(b.unread ?? 0) ? 1 : 0), ring: waiting.has(h.id) ? 'needs' : h.ring };
  }).sort((a, b) => b.at - a.at);
  const room = state.room ?? {};
  const pin: Chat = { id: 'room', name: 'The crew', who: 'chief', line: room.last ? plain(room.last.text) : 'Watch the crew work together', at: at(room.last?.at ?? 0), unread: 0, ring: room.busy?.length ? 'working' : '' };
  return [lead, pin, ...rest];
}
export const unreadBadge = (n: number) => (n > 9 ? '9+' : String(n));
export const briefTime = (t: number) => { const m = Math.floor((Date.now() - t) / 60_000); return m >= 0 && m < 60 ? `${Math.max(1, m)}m` : clock(t); };

/** Home's Needs you, one compact list: spending and sending first, then questions, newest first inside each group.
 *  A draft for the person to send belongs here; a plain suggestion or an app connection stays in its helper's chat — nothing to act on from Home itself. */
export function needsYou(state: Json): Card[] {
  const rank = (a: Json) => {
    const d = a.detail ?? {};
    if (a.kind === 'propose') return d.draft ? 1 : 3; // a draft needs the person's yes; other suggestions live in the chat
    if (a.kind === 'connect' || d.app) return 3;
    if (d.spends || d.effect === 'spend' || d.effect === 'send') return 0;
    return a.kind === 'permission' ? 1 : 2;
  };
  return (state.asks as Json[]).map((a) => ({ a, c: card(a, state) })).filter((x) => rank(x.a) < 3)
    .sort((x, y) => rank(x.a) - rank(y.a) || y.c.at - x.c.at).map((x) => x.c);
}

/** What Search found: lines from the member's chats (with the line to land on) and finished things (with the result). */
export function found(state: Json, r: Json | null) {
  if (!r) return [];
  const name = (id: string) => (id === 'chief' ? 'Chief' : state.bots.find((b: Json) => b.id === id)?.display ?? id);
  return [
    ...(r.things ?? []).map((t: Json) => ({ key: `t${t.id}`, bot: t.bot as string, thing: t.id as number, name: name(t.bot), text: `Made “${plain(t.title)}”`, at: at(t.at) })),
    ...(r.messages ?? []).map((m: Json) => ({ key: `m${m.id}`, bot: m.bot as string, msg: m.id as number, name: name(m.bot), text: preview(m), at: at(m.at) })),
  ];
}

export function jobParts(job: Json) {
  const labels = ['What it does', "What it's aiming for", 'What it gets from others', 'How it goes about it', 'What great looks like, with an example'];
  const keys = ['does', 'aim', 'gets', 'how', 'great'];
  return keys.map((key, i) => ({ label: labels[i], text: plain(job?.[key] ?? '') }));
}

export function gallery(state: Json) {
  return state.templates.filter((t: Json) => t.id !== 'chief')
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
  const title = plain(String(state.bots.find((b: Json) => b.task?.id === a.task_id)?.task?.title ?? state.tasks?.find((t: Json) => t.id === a.task_id)?.title ?? '')).trim();
  const question = title ? (/[?.!]$/.test(title) ? title : `${title}?`) : undefined;
  if (a.kind === 'connect' || d.app) {
    const app = apps(state).find((x) => x.id === d.app) ?? APPS[0];
    return { ...base, kind: 'connect', app, status: `Wants to use ${app.name}`, head: `${name} could use ${app.name}`, words: plain(d.words ?? `${name} can do this with your ${app.name}. Connect it?`),
      choices: [{ label: `Connect ${app.name}`, body: { answer: 'allow' }, primary: true }, { label: 'Not now', body: { answer: 'deny' } }] };
  }
  if (a.kind === 'propose' && d.routine) {
    // Chief's offered routine: the lines are the whole confirmation (cadence, what, quiet behaviour, first run). It
    // stays off Home like every suggestion, and nothing runs until the person starts it.
    const note = zoneNote(state);
    const one = !!d.routine.once; // a one-off reminder: the same card, in the words a reminder uses
    return { ...base, kind: 'routine', status: one ? 'A reminder' : 'A new routine', head: one ? 'A reminder' : 'A new routine', words: plain(d.words ?? a.title),
      lines: String(d.preview?.body ?? '').split('\n').map((l: string) => plain(l)).filter(Boolean).concat(note ? [note] : []),
      schedule: String(d.routine.schedule ?? ''), zoneNote: note, remind: one,
      choices: [{ label: one ? 'Remind me' : 'Start it', body: { answer: 'allow', scope: 'once' }, primary: true }, { label: 'Not now', body: { answer: 'deny' } }] };
  }
  // Chief's plan for a job of several steps: the steps are the evidence, and nothing starts before Go. "Change it" is
  // the card's own box (a no that carries the person's words back to Chief), not a choice here.
  if (a.kind === 'propose' && d.plan) return { ...base, kind: 'plan', status: 'A plan to start', head: "Chief's plan", words: plain(d.words ?? a.title),
    lines: (d.plan.steps ?? []).map((x: string, i: number) => `${i + 1}. ${plain(x)}`),
    choices: [{ label: 'Go', body: { answer: 'allow', scope: 'once' }, primary: true }, { label: 'Not now', body: { answer: 'deny' } }] };
  if (a.kind === 'propose' && d.pass) return { ...base, kind: 'ok', status: 'Wants to hand work on', head: `${name} wants to hand work on`, words: plain(d.words ?? a.title),
    lines: (d.pass.files ?? []).map((f: string) => `With “${pretty(f)}”`),
    choices: [{ label: 'Hand it on', body: { answer: 'allow', scope: 'once' }, primary: true }, { label: 'Not now', body: { answer: 'deny' } }] };
  if (a.kind === 'propose' && d.draft) {
    const head = `${name} wrote your ${d.draft.channel}`;
    const body = String(d.preview?.body ?? '').trim();
    return { ...base, kind: 'ok', status: `Nothing is sent · ${d.draft.channel === 'post' ? 'post' : 'send'} it yourself`, evidence: 'draft',
      draftTo: plain(d.draft.to), draftSubject: plain(d.draft.subject) || undefined, draftText: body, head, words: head, preview: { body },
      choices: [{ label: 'Approve', body: { answer: 'allow', scope: 'once' }, primary: true }, { label: 'Reject', body: { answer: 'deny' } }] };
  }
  // Chief's hire in a glance: who, the role, what it can do and the first job; nothing changes until the yes.
  if (a.kind === 'propose' && d.hire) return { ...base, kind: 'ok', status: d.adapt ? 'A new job' : 'A new helper', head: plain(d.words ?? a.title), words: plain(d.words ?? a.title),
    lines: String(d.preview?.body ?? '').split('\n').map((l: string) => plain(l)).filter(Boolean),
    choices: [{ label: plain(d.yes ?? 'Yes'), body: { answer: 'allow', scope: 'once' }, primary: true }, { label: 'Not now', body: { answer: 'deny' } }] };
  if (a.kind === 'propose') {
    // A suggestion: a skill a helper would like to keep, or a new personality from Chief. Nothing changes without a yes.
    return { ...base, kind: 'ok', status: 'Would like to remember this',
      head: a.bot === 'chief' ? 'Chief has a suggestion' : `${name} learned something`, words: plain(d.words ?? `${name} has a suggestion.`),
      preview: d.preview ? { head: d.preview.head ? plain(d.preview.head) : undefined, body: plain(d.preview.body ?? '') } : undefined,
      choices: [{ label: d.yes ? plain(d.yes) : a.bot === 'chief' ? 'Yes, change it' : 'Yes, keep it', body: { answer: 'allow', scope: 'once' }, primary: true }, { label: 'Not now', body: { answer: 'deny' } }] };
  }
  if (a.kind !== 'permission') {
    return { ...base, kind: 'question', reply: true, status: 'Has a question', head: `${name} has a question`,
      words: d.question ? plain(d.question) : `${name} stopped to check something with you. Tell ${name} what to do:`, choices: [] };
  }
  const spend = !!d.spends || d.effect === 'spend';
  const words = d.words ? plain(d.words) : spend ? `${name} wants to use something that costs money. Is that all right?` : `${name} would like your OK to carry on.`;
  // A checkout is review-first: the inbox only opens the review and offers the way out; the sheet's yes names the order.
  // With no readable total there is no yes at all — the person finishes that purchase themselves.
  const order = d.order as Card['order'] | undefined;
  if (spend && order) {
    const choices: Choice[] = order.known
      ? [{ label: d.yes ? plain(d.yes) : `Place order · ${order.shown}`, body: { answer: 'allow', scope: 'once' } }, { label: "Don't place order", body: { answer: 'deny' } }]
      : [{ label: "Don't place order", body: { answer: 'deny' } }, { label: "I'll buy it myself", body: { answer: 'deny' } }];
    return { ...base, kind: 'spend', review: true, order, question, status: 'Wants to spend money', words, choices, head: `Review ${name}'s order`,
      preview: d.preview ? { head: d.preview.head ? plain(d.preview.head) : undefined, body: plain(d.preview.body ?? '') } : undefined };
  }
  // A press on a site they signed the bot in to is not a message going out: the card says acting, not sending. (docs/ui-contract.md)
  // A form the helper fills (a claim's lines) fills, it does not press: "Yes, fill it in" — "these in" when the card
  // lists more than one line.
  const press = d.effect === 'send' && d.press === true;
  const fill = press && d.fill === true;
  const fillLines = String(d.preview?.body ?? '').split('\n').filter(Boolean).length;
  const choices: Choice[] = [{ label: spend ? 'OK, spend it' : fill ? (fillLines > 1 ? 'Yes, fill these in' : 'Yes, fill it in') : press ? 'Yes, press it' : d.effect === 'send' ? 'Send' : 'Yes, go ahead', body: { answer: 'allow', scope: 'once' }, primary: true }];
  // "Always" is a relationship ("Always OK for Aunty Sara"), and money never gets one.
  if (!spend && (d.always || d.rule)) choices.push({ label: `Always OK for ${d.always ?? name}`, body: { answer: 'allow', scope: 'always' } });
  choices.push({ label: 'Not now', body: { answer: 'deny' } });
  return {
    ...base, kind: spend ? 'spend' : 'ok', status: spend ? 'Wants to spend money' : fill ? 'Wants to fill in a form' : press ? 'Wants to press a button' : d.effect === 'send' ? 'Wants to send an email' : 'Needs your OK',
    evidence: fill ? 'lines' : undefined, words, choices, question,
    head: spend ? `${name} needs your OK to spend` : press ? `${name} wants to act on a site` : d.effect === 'send' ? `${name}'s ${d.thing ?? 'message'} is ready to send` : `${name} would like your OK`,
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
    return { helper: b.id, title: plain(b.task?.title ?? 'Up next'), line: needs ? 'Waiting for your OK' : s ? s : b.task ? 'Getting started…' : 'Waiting its turn', waiting: !b.task || needs, things: deskThings(b.id, b.task ?? null) };
  });
}

export function things(state: Json): Thing[] {
  return state.tasks.filter((t: Json) => t.state === 'done' && (answerOf(t) || (t.files ?? []).length)).map((t: Json) => ({
    id: t.id, helper: t.bot, title: plain(t.title), at: t.updated_at, summary: answerOf(t).slice(0, 220),
    files: (t.files ?? []).map((f: string) => fileView(t.bot, f)),
  }));
}

/** A helper's shelf: the files it delivered on finished jobs, newest first, once each — never a handed-over input,
 *  a photo or a summary of its own. Each opens in the reader its kind already has (fileTarget, the phone's FileRow). */
export function made(state: Json, id: string): (FileView & { at: number })[] {
  const files = things(state).filter((t) => t.helper === id).flatMap((t) => t.files.map((f) => ({ ...f, at: t.at })))
    .filter((f) => !/^files\/(from-|photos\/)/.test(fileSource(f.url)?.path ?? ''));
  return files.filter((f, i) => files.findIndex((g) => g.url === f.url) === i);
}

export type Job = { bot: string; label: string; ask: string; says: string; goal: boolean; money: boolean; needs: string[]; hire?: string };

/** Home's three counts, from the same rows shown below them: what needs you, who is working, what got done today. */
export const homeCounts = (state: Json) => office(state).counts;
/** Home's one-line state, from the same needs and work rows shown below it. */
export function homeSummary(state: Json) {
  const { needs, working } = homeCounts(state);
  return `${needs} ${needs === 1 ? 'thing needs' : 'things need'} you · ${working} ${working === 1 ? 'helper' : 'helpers'} working`;
}

/** The phone's status-bar chip and its notification, one more view of Home's own numbers; null when nothing is working
 *  or waiting. Only this person's jobs: a bot's `task` is theirs alone (its bot-wide `live` never counts). Names stay in
 *  `title`/`text`, shown only on an unlocked phone; `chip` (at most 7 characters) and `publicText` carry counts only.
 *  `active`: a job is working, so the chip may show; waiting alone is a plain notification. A watching phone gets no
 *  actions: a tap opens the app. */
export type CrewStatus = { active: boolean; needsYou: number; title: string; text: string; publicText: string; chip: string; actions: { id: 'needs' | 'ask'; label: string }[] };
export function status(state: Json, canAct = true): CrewStatus | null {
  const mine = new Set(['chief', ...crew(state).map((h) => h.id)]);
  const working = (state.bots as Json[]).filter((b) => mine.has(b.id) && b.task?.state === 'working' && !b.stuck).map((b) => (b.id === 'chief' ? 'Chief' : String(b.display)));
  const n = working.length, needs = homeCounts(state).needs;
  if (!n && !needs) return null;
  const need = `${needs} ${needs === 1 ? 'needs' : 'need'} you`;
  return {
    active: n > 0, needsYou: needs,
    title: n === 1 ? `${working[0]} is working` : n ? `${n} helpers working` : need,
    text: n && needs ? need : chief(state, { bare: true }).line,
    publicText: [n ? `${n} working` : '', needs ? need : ''].filter(Boolean).join(' · '),
    chip: needs ? 'Needs' : n > 1 && n < 10 ? `${n} busy` : 'Busy',
    actions: canAct ? [...(needs ? [{ id: 'needs' as const, label: 'See what needs you' }] : []), { id: 'ask' as const, label: 'Ask Chief' }] : [],
  };
}

const hired = (state: Json, template: string) => crew(state).find((x) => state.bots.find((b: Json) => b.id === x.id)?.template === template);
/** Who a bubble job goes to: that template's helper, else the general Helper. `id` is '' while nobody is either: the
 *  tap hires the Helper first, never Chief, whose hand-offs carry no photos. */
export type Hand = { id: string; name: string };
export function handTo(state: Json, template: string): Hand {
  const h = hired(state, template) ?? hired(state, 'helper');
  return h ? { id: h.id, name: h.name } : { id: '', name: 'Helper' };
}
/** Who drafts for Write it here: this crew's Scribe, else the general Helper. */
export const writer = (state: Json) => handTo(state, 'scribe');

/** What a tap on the bubble read (Android): the box in focus, its app, words and the part picked ('off' while the phone
 *  doesn't let him see it, null for none: then the app is unknown too, since the overlay kit names the app only with a
 *  box), and how often the person picked each button in that app (the kit's tap log, which keeps no words). */
export type Screen = { box: { app?: string; text: string; picked: string } | 'off' | null; used?: Record<string, number> };
/** A bubble button: fixed words to one helper (`handTo`), so its reply is an ordinary job. `from` is what goes with
 *  them: `box` is Write it here's own flow, `text` sends what the box says (the part picked, if any), `keep` puts the
 *  part picked in what the whole crew knows about the person (`keep()`, no helper), `screen` a still (the phone asks
 *  every time) and `camera` a photo, both to the share screen with that helper picked and `ask` in its box: words a
 *  person would write, with `brief` (how to go about it) sent after them, never shown in the box. A
 *  button that needs an app the person hasn't connected says so in its label (`needs`), and its tap opens Settings.
 *  `said` is what the person actually wrote — what they picked or typed in the box — the only words of theirs that go
 *  in their bubble; `ask` and `brief` are ours and reach the helper alone. */
export type BubbleButton = { id: 'write' | 'calendar' | 'real' | 'mail' | 'remember' | 'short' | 'lookup' | 'deal' | 'letter' | 'plan'; label: string; to: Hand; ask: string;
  from: 'box' | 'text' | 'keep' | 'screen' | 'camera' | 'none'; needs: string[]; brief: string; said: string; put?: 'Put it in' | 'Copy' };
const REAL = "Point out the warning signs you can see, and anything that looks normal. Don't tell me it's safe or a scam, and don't open or look up any web address in it. End with how I can check for myself: in the official app, or on the official website typed in by hand.";
/** Web addresses written so no tool follows them by accident: hxxp://, and [.] before the last part of a name. */
export const defang = (text: string) => text.replace(/\bhttp(s?):\/\//gi, 'hxxp$1://').replace(/\b([a-z0-9-]+)\.(?=[a-z]{2,}\b)/gi, '$1[.]');
// What the words and the app look like. ponytail: word lists, not understanding; a miss only leaves a button for the
// rows below it, and anything else is one sentence in Chief's box.
const MONTH = '(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)';
const DATE = new RegExp(`\\b(mon|tues|wednes|thurs|fri|satur|sun)day\\b|\\b${MONTH}\\.? \\d|\\b\\d{1,2}(st|nd|rd|th)? ${MONTH}\\b|\\d ?[ap]m\\b|\\b\\d{1,2}:\\d\\d\\b|\\b(today|tonight|tomorrow|next week)\\b|\\b\\d{1,2}\\/\\d{1,2}\\b`, 'i');
const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|co|uk|org|net|top|xyz|info|io|app|ly|me|link|click|site|online|shop|store|live|biz|cc|pk|in|ru|cn)\b/i;
const PRESSURE = /\b(urgent|immediately|suspended|locked|verify|pay now|overdue|final notice|prize|gift card|act now|within 24 hours|unusual activity)\b/i;
const BOOKING = /\b(booking|booked|reservation|order|receipt|invoice|ticket|flight|confirmation|delivery|tracking|e-?mail(ed)?|sent you|inbox)\b/i;
// Where a reply is the person's own words (Reddit, a Hacker News reader): Write it here gives notes to write from, and
// Copy instead of Put it in. ponytail: package names, not the site; Reddit in a browser gets prose like any box.
const NOTES = /^com\.reddit\.frontpage$|hackernews|materialistic|\.hews$/i;
export const notesOn = (app = '') => (NOTES.test(app) ? (/reddit/i.test(app) ? 'Reddit' : 'Hacker News') : '');
const CHAT = /whatsapp|telegram|securesms|messaging|orca|slack|discord|viber|teams|instagram/i, MAIL = /\.gm$|mail|outlook/i;
type Seen = { box: Screen['box']; said: string; picked: string; app: string };
/** The bubble's rules table: the first three rows that fit what the tap read are its buttons, never chosen by a model.
 *  Phase 0's buttons came first; each now shows when its words fit, then whatever fits any words (or none). */
const ROWS: [BubbleButton['id'], (s: Seen) => unknown][] = [
  ['write', (s) => s.box],
  ['calendar', (s) => DATE.test(s.said)],
  ['real', (s) => LINK.test(s.said) || PRESSURE.test(s.said) || (!s.said && (CHAT.test(s.app) || MAIL.test(s.app)))],
  ['mail', (s) => BOOKING.test(s.said) || (s.said && MAIL.test(s.app))],
  ['remember', (s) => s.picked],
  ['lookup', (s) => s.picked && s.picked.length <= 100],
  ['short', (s) => s.said.length > 280],
  ['short', (s) => s.said], ['lookup', (s) => s.said], ['real', (s) => s.said],
  // No words, and with no box no app either: the two that work on any screen.
  ['deal', (s) => !s.said], ['letter', (s) => !s.said],
];
/** The bubble's buttons (Android): at most three, the table's first rows that fit this screen, the one the person
 *  picks most in this app first (the tap log only orders them, it never adds one). A watching phone gets none. */
export function quick(state: Json, screen: Screen, canAct = true): BubbleButton[] {
  if (!canAct) return [];
  const read = screen.box && screen.box !== 'off' ? screen.box : null, picked = read?.picked.trim() ?? '';
  const seen: Seen = { box: screen.box, picked, said: picked || read?.text.trim() || '', app: read?.app ?? '' };
  const used = screen.used ?? {};
  return [...new Set(ROWS.filter(([, fits]) => fits(seen)).map(([id]) => id))].slice(0, 3)
    .sort((a, b) => (used[b] ?? 0) - (used[a] ?? 0)).map((id) => button(state, id, seen.said, seen.app));
}
function button(state: Json, id: BubbleButton['id'], said: string, app = ''): BubbleButton {
  const quote = `\n“${said}”`;
  const google = (app: string) => (state.connections?.includes?.(app) ? [] : ['Google']);
  const b = (label: string, from: BubbleButton['from'], ask = '', needs: string[] = [], brief = ''): BubbleButton =>
    ({ id, label: needs.length ? `${label} · needs ${needs.join(' and ')}` : label, to: handTo(state, id === 'write' ? 'scribe' : 'scout'), ask, from, needs, brief, said });
  if (id === 'write') return { ...b('Write it here', 'box'), put: notesOn(app) ? 'Copy' : 'Put it in' };
  if (id === 'calendar') return b('Put this date in my calendar', 'text', `Put this date in my Google Calendar:${quote}\nWork out the date and time from it. If there isn't a clear one, say so instead of guessing.`, google('calendar'));
  if (id === 'real') return said ? b('Is this real?', 'text', `Is this real? Here's what it says:\n“${defang(said)}”\n${REAL}`) : b('Is this real?', 'screen', 'Is this real?', [], `It's on my phone's screen, in the picture.\n${REAL}`);
  if (id === 'mail') return b('Find that email', 'text', `Find the email in my Gmail this is about, and tell me in a few lines what it says, who sent it and when. Only look: don't change, move, send or delete anything.${quote}`, google('gmail'));
  if (id === 'remember') return b('Remember this', 'keep', said);
  if (id === 'short') return b('Short version', 'text', `Give me the short version, in three lines or fewer:${quote}`);
  if (id === 'lookup') return b('Look it up', 'text', `Look this up and tell me in a few lines what it is, and where you found it:${quote}`);
  if (id === 'deal') return b('Deal with this', 'screen');
  if (id === 'plan') return b('Plan my day', 'none', "Give me my day: what's on, what's waiting on me, what to do first", [...new Set([...google('calendar'), ...google('gmail')])]);
  return b('Scan a letter', 'camera', 'Read this letter for me', [], "Who it's from, what it wants and by when, in a few lines. If it has a date to keep, offer to put it on my calendar.");
}

// Remember this: kept on the phone's tap, straight into what the whole crew knows (GET/PUT /api/about), with no model.
// It never keeps a secret: digits that look like a PIN, a card number or a one-time code are refused before anything is
// sent, and so are web and email addresses (crewd's own rule for remembered lines, src/bots.ts RISKY).
const SECRET = /(^|[^\p{L}])(pins?|codes?|passcodes?|passwords?|otp|cvv|cvc)(?!\p{L})|one[- ]time|verification|security code|sort code/iu;
const ADDRESS = /https?:|www\.|[\w.+-]+@[\w-]+\.[a-z]|(^|\s)~?\/[\w.-]*\/|`|\$\(|&&/i;
const DATES = /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g;
/** Why these words can't be kept ('' when they can): any digits in a run of 4 to 8 look like a PIN or a code, and 12
 *  or more like a card number (spaces and dashes between, any script's digits, letters beside them or not); a phone
 *  number (9 to 11, or after +) and a written date are fine. ponytail: a year alone is refused too; a door code
 *  looks just like one. */
export function secretOf(text: string) {
  const runs = [...text.replace(DATES, ' ').matchAll(/(?<![+\p{Nd}])\p{Nd}(?:[ -]?\p{Nd})*/gu)].map((m) => m[0].replace(/[^\p{Nd}]/gu, '').length);
  if (SECRET.test(text) || runs.some((n) => n >= 12 || (n >= 4 && n <= 8)))
    return "That looks like a PIN, a card number or a code, so I won't keep it. Keep those in your phone's password manager.";
  if (ADDRESS.test(text)) return 'I only keep plain words about you, not web or email addresses.';
  return '';
}
/** Plan my day is said, not a button: Scout's own day-plan ask, a job like the buttons' (a model turn, never canned). */
export const planDay = (state: Json) => button(state, 'plan', '');
/** What the whole crew knows about the person with `text` kept as one more line, or why not. */
export function keep(notes: string, text: string): { notes: string; line: string } | { refuse: string } {
  const line = text.replace(/\s+/g, ' ').trim();
  const why = !line ? 'Pick the words to keep first.' : line.length > 200 ? 'That is a lot to keep. Pick a sentence or two.' : secretOf(line);
  if (why) return { refuse: why };
  if (notes.split('\n').includes(`- ${line}`)) return { refuse: 'The crew knows that already.' };
  // ponytail: read, add a line, write the whole file back; a line the crew kept in that second is lost (crewd has no
  // append for the person's edits, and src/ has no lines to spare).
  const next = `${notes.replace(/\n*$/, '')}${notes.trim() ? '\n' : ''}- ${line}\n`;
  return next.length > 1500 ? { refuse: 'What the crew knows about you is full. Tidy it in Crewhouse on your computer, then try again.' } : { notes: next, line };
}
/** Undo for Remember this: that line taken back out, whatever was kept since. */
export const unkeep = (notes: string, line: string) => notes.split('\n').filter((l) => l !== `- ${line}`).join('\n');

// Chief's box in the panel answers two things itself, from what the phone already has and with no model: who is on
// what, and what the crew knows about the person. Everything else (a day plan too) is a job.
const STATUS = /^(status|what('?s| is| are) (every(one|body)|the crew|my crew|you all|y'?all|the team) (doing|up to|working on)( (right )?now| today)?|how('?s| is) (it|everything|the crew) going|who('?s| is) (working|busy|on what))\W*$/i;
const DETAILS = /^(my details|what do (you|we|they) know about me|what('?s| is) my (address|name|info)|who am i)\W*$/i;
const PLAN = /^(plan (my|the) day|plan (for )?today|what('?s| is) (on|happening) (for )?(today|my day))\W*$/i;
/** Which of the two `ask` is, or `plan` for the day plan (a job: `planDay`), or '' for none. */
export const cannedOf = (ask: string): '' | 'status' | 'details' | 'plan' => {
  const a = ask.trim();
  return STATUS.test(a) ? 'status' : DETAILS.test(a) ? 'details' : PLAN.test(a) ? 'plan' : '';
};
/** The answer, in plain words: who is on what (`crewLine`) and what needs the person; or their name and what the crew
 *  knows about them (`notes`, from GET /api/about). */
export function canned(state: Json, kind: 'status' | 'details', notes = '') {
  if (kind === 'status') {
    const needs = homeCounts(state).needs;
    return [crewLine(state) || 'Nobody is on a job right now.', needs ? `${needs} ${needs === 1 ? 'thing needs' : 'things need'} you.` : ''].filter(Boolean).join(' ');
  }
  const name = String(state.person?.name ?? '').trim();
  const lines = notes.split('\n').map((l) => plain(l.replace(/^\s*[-*]\s*/, ''))).filter(Boolean);
  return [name ? `You're ${name}.` : '', lines.length ? `What the crew knows about you:\n${lines.map((l) => `• ${l}`).join('\n')}` : 'The crew knows nothing else about you yet. Pick some words in any app, tap me and choose Remember this.'].filter(Boolean).join('\n');
}
/** Who is on what, in one plain line from state alone (no model turn): each of the crew that is working, waiting on the
 *  person, gone quiet, paused while they drive or resting, then when a resting account is back. '' when nobody is.
 *  `bare` names no job, only who is working (over other apps: the bubble's panel). */
export function crewLine(state: Json, bare = false) {
  const lead = (state.bots as Json[]).find((b) => b.id === 'chief');
  const each = crew(state).map((h) => (h.seat === 'chat' ? `${h.name} needs you` : h.driving ? `${h.name} waits while you drive`
    : h.seat === 'quiet' ? `${h.name} has gone quiet` : h.seat === 'working' ? (bare ? `${h.name} is working` : `${h.name} is on “${h.status}”`)
    : h.seat === 'waiting' ? `${h.name} is ${h.status.replace(/^Waiting/, 'waiting')}` : h.seat === 'failed' ? `${h.name} ${h.status === 'Not sure it worked' ? "isn't sure the last job worked" : "didn't finish the last job"}` : ''));
  return [lead?.task?.state === 'working' ? (bare ? 'Chief is working' : `Chief is on “${plain(lead.task.title)}”`) : '', ...each, resting(state)].filter(Boolean).map((l) => `${l}.`).join(' ');
}
/** Write it here's ask, in the writer's chat like any other (its first line is the job's title): what the person
 *  wants, what the box says, and (on Try again) the draft they passed on. The draft is what the whole box should say,
 *  keeping what they wrote; with some of it picked, it is only what goes in place of that part. On Reddit or in a
 *  Hacker News reader it is labelled notes the person writes their reply from. */
export function writeAsk(want: string, box: { app?: string; text: string; picked: string }, not = '') {
  const sofar = box.text.trim(), picked = box.picked.trim(), on = notesOn(box.app);
  return [
    `Write it here: ${want.trim()}`,
    picked ? `That's for the part I picked in a text box I'm typing in on my phone: “${picked}”. The whole box says: “${sofar}”`
      : `That's for the text box I'm typing in on my phone.${sofar ? ` It says so far: “${sofar}”` : ''}`,
    not && `Not this one: “${not}”`,
    "Don't ask me anything first: decide what fits and write it.",
    on ? `It's a reply on ${on}, where people want my own words, so don't write the reply. Reply with short labelled notes I'll write it from, one per line (Point:, Why:, Example:), as plain text: no file.`
      : picked ? 'Reply with only the words to put in place of the part I picked, as plain text: no file, no notes.'
      : `Reply with only what the whole box should say${sofar ? ', keeping what I wrote where it fits' : ''}, as plain text: no file, no notes.`,
  ].filter(Boolean).join('\n');
}
/** What a finished job actually gave the person, in their plain words: '' when the run ended without an answer (crewd's
 *  "Done." is its empty answer) or said only the test engine's echo. One truth for the thread, Made in this chat, the
 *  rail's word and the panel's draft: a job with no words and no file made nothing, and says so by not being listed. */
export const answerOf = (t: Json): string => {
  const raw = String(t?.result ?? '').trim();
  return STUB.test(raw) || raw === 'Done.' ? '' : teaser(raw);
};
/** What the person wrote for the thread, in their own words: what they asked for, then what they had picked or typed in
 *  the box. Everything else in `writeAsk` is ours and reaches the helper alone. */
export function writeSaid(want: string, box: { text: string; picked: string }) {
  return [want.trim(), (box.picked || box.text).trim()].filter(Boolean).join('\n');
}
/** That ask's draft, from the writer's page: its job's own words once done, '' when it couldn't, null while it writes. */
export function draftOf(page: Json, task: number): string | null {
  const t = (page?.tasks ?? []).find((x: Json) => x.id === task);
  if (!t || !['done', 'failed', 'unsure'].includes(t.state)) return null;
  return t.state === 'done' ? answerOf(t) : '';
}
/** Why that job isn't writing yet, in crewd's own words ('' while it writes): paused for a sign-in or a rest, or
 *  waiting on the person. */
export function waitOf(page: Json, task: number): string {
  const t = (page?.tasks ?? []).find((x: Json) => x.id === task);
  return t?.state === 'paused' ? plain(t.result ?? '') || 'Waiting for you.' : t?.state === 'needs_you' ? 'It needs your OK first.' : '';
}

/** Home's standing "hand me a job" list: the jobs the crew offers to do end to end, from crewd's `ideas[]` — which is
 *  already only what this crew can do. A goal first, then money back, then the everyday jobs. A row that needs an app the person
 *  hasn't connected says what it needs instead of dead-ending, and never fills the box. A row with `hire` names the
 *  unhired template a tap brings on first (docs/ui-contract.md). */
export function jobs(state: Json): Job[] {
  const rows: Job[] = (state.ideas ?? []).map((i: Json) => ({
    bot: String(i.bot ?? 'chief'), label: plain(i.title ?? i.ask ?? ''), ask: String(i.ask ?? ''), says: promiseLine(state, i),
    goal: i.group === 'goal', money: i.group === 'money', needs: ((i.needs ?? []) as string[]).map((w) => plain(w)).filter(Boolean),
    ...(typeof i.hire === 'string' && i.hire ? { hire: i.hire } : {}),
  }));
  return rows.sort((a, b) => Number(b.goal) - Number(a.goal) || Number(b.money) - Number(a.money) || a.needs.length - b.needs.length);
}
/** Under a job row, whose job it is: the template's own short `line` ("Scout checks the unclaimed-money lists"), else the
 *  first sentence of its promise ("Scout · I'll search …"), empty when that only repeats the ask. */
function promiseLine(state: Json, i: Json) {
  const name = i.bot === 'chief' || !i.bot ? 'Chief' : state.bots?.find((x: Json) => x.id === i.bot)?.display ?? i.bot;
  if (i.line) return `${name} ${plain(i.line)}`;
  const first = (/^.*?[.!?](?=\s|$)/s.exec(plain(i.promise ?? '')) ?? [plain(i.promise ?? '')])[0].trim();
  const [a, b] = [first, plain(i.ask ?? '')].map((w) => w.toLowerCase().replace(/[.!?\s]+$/, ''));
  if (!first || a.startsWith(b) || b.startsWith(a)) return '';
  return `${name} · ${first}`;
}
/** What a job that can't run yet would need first, in one plain line. */
export const jobNeeds = (needs: string[]) => `Needs ${needs.join(' and ')} first.`;

/** Chief's three first-run ideas: one tap is both "hello" and the first job. The middle one goes straight to
 *  Scout: her side-income ask starts in Scout's thread, never through Chief. */
export const FIRST_IDEAS: { icon: string; label: string; bot?: string }[] = [
  { icon: '🍲', label: "Plan this week's dinners, with a shopping list" },
  { icon: '💡', label: 'Help me earn a little on the side', bot: 'scout' },
  { icon: '📅', label: "What's on this week?" },
];

/** The starters Hello offers: useful from the first tap, and never one that dead-ends in a connection. With Google
 *  not set up yet, the calendar starter sits out; a party plan takes its place. */
export function firstIdeas(state: Json) {
  if (state.house?.google !== false) return FIRST_IDEAS;
  return FIRST_IDEAS.filter((i) => !i.label.startsWith("What's on this week")).concat({ icon: '🎈', label: 'Help me plan a birthday party' });
}

/** Your three setup jobs: what the crew thinks with, the phones reaching it, and Google setup.
 *  Until all three are done, the owner's Home says how many are left. */
export function homeSetup(state: Json, accounts: Json[] | null, link: Json | null) {
  const plan = planName(accounts);
  const rows = [
    { key: 'signin', says: plan === 'AI plan' ? 'An AI plan the crew can think with' : `The crew thinks with your ${plan}`, done: accounts?.some((a) => a.signedIn === true) === true },
    { key: 'phones', says: 'Phones can reach the crew away from home', done: link?.anywhere === 'anywhere' },
    { key: 'google', says: 'Google setup', done: state.house?.google !== false },
  ];
  return { rows, left: rows.filter((r) => !r.done).length };
}

/** Ideas are promises from a named helper; Chief offers three of his own when the crew has none.
 *  A job still waiting on an app the person hasn't connected belongs on Home (jobs), not among these chips.
 *  Offer-to-hire rows stay on Home too: a chip can only fill a box, never bring a helper on. */
export function ideas(state: Json) {
  const own = state.ideas.filter((i: Json) => !i.hire && !(i.needs ?? []).length).map((i: Json) => ({ bot: i.bot, label: plain(i.promise), ask: i.ask }));
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
    case 'file.delivered': return d.photo ? 'You sent a photo' : /\.(patch|diff)$/.test(String(d.path)) ? `Suggested a change for the maintainer to review: “${pretty(String(d.path))}”` : `Made “${pretty(d.path)}”`;
    case 'memory.learned': return `${d.everyone ? 'Learned, for the whole crew' : 'Learned'}: ${plain(d.text)}`;
    case 'memory.undone': return `You undid: ${plain(d.text)}`;
    case 'soul.changed': return d.by === 'chief' ? 'Took on the personality Chief suggested' : d.reset ? 'Went back to how it started' : 'You changed how it comes across';
    case 'run.resumed': return 'Picked up where it left off';
    case 'desktop.takeover': return 'You took the wheel';
    case 'desktop.giveback': return 'You handed the wheel back';
    case 'task.paused': return `Paused “${plain(d.title)}” for now`;
    case 'task.done': return `Finished “${plain(d.title)}”`;
    case 'task.failed': return d.result === 'Stopped by you.' ? `You stopped “${plain(d.title)}”` : `Couldn't finish “${plain(d.title)}”`;
    case 'task.unsure': return `Not sure “${plain(d.title)}” worked`;
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
    out.push({ at: e.at, text, seq: e.seq, asked: e.kind === 'ask.opened',
      undo: (e.kind === 'memory.learned' && !e.undone) || (e.kind === 'soul.changed' && !!e.data?.prev) });
  }
  if (live && out.length) out[out.length - 1].now = true;
  return out;
}

// ---------- a chat ----------
/** Photos sent with a message ride in its text as `[photo <bot>] files/photos/…` lines: pictures, not words. */
const PHOTO = /\n?\[photo ([a-z0-9-]+)\] (files\/\S+)/g;
const photos = (text: string) => [...text.matchAll(PHOTO)].map((m) => fileView(m[1], m[2]));

export function room(page: Json, state: Json) {
  const people = new Map((state.bots ?? []).map((b: Json) => [b.id, helper(b, state.events ?? [], state.bots, state.tasks ?? [])]));
  const checks = reviews(state);
  return (page?.lines ?? []).map((m: Json) => ({ id: m.id as number, who: people.get(m.bot) as Helper | undefined,
    to: m.to ? (people.get(m.to) as Helper | undefined)?.name : undefined,
    from: m.from ? (people.get(m.from) as Helper | undefined)?.name : undefined,
    text: chatWords(m.text ?? ''), files: (m.files ?? []).map((f: Json) => fileView(f.bot, f.path, checks.get(`${f.bot}|${f.path}`))), at: at(m.at), author: m.author }));
}

const chatWords = (text: string) => text.replace(/```[\s\S]*?```/g, '').split('\n').map(plain).join('\n').trim();

export function lines(page: Json, bot: string, state: Json = {}): Line[] {
  const checks = reviews(state);
  return (page?.messages ?? []).filter((m: Json) => !STUB.test(String(m.text ?? ''))).map((m: Json) => {
    const pics = photos(String(m.text ?? ''));
    const text = String(m.text ?? '').replace(PHOTO, '').trim();
    if (m.author === 'system') {
      const f = /^Delivered (files\/.+?)(?::\s|$)/.exec(text);
      if (!f) return { id: m.id, from: 'note', text: plain(text), files: [], choices: [] };
      const words = plain(text.slice(f[0].length)) || `Here's “${pretty(f[1])}”`;
      // A built workbook or document is its card on the web, which says what is in it: no words of its own there. The
      // phone's plainer card has no count, so it keeps them as `about`.
      const card = /\.(xlsx|docx)$/i.test(f[1]);
      return { id: m.id, from: 'note', text: card ? '' : words, about: card ? words : undefined, files: [fileView(bot, f[1], checks.get(`${bot}|${f[1]}`))], choices: [] };
    }
    // Another helper handing this one a job: a note in its words, "Reel asked: …".
    if (!['person', 'bot', 'chief'].includes(m.author)) return { id: m.id, from: 'note', text: `${String(m.author).replace(/^./, (c) => c.toUpperCase())} asked: ${plain(text)}`, files: [], choices: [] };
    // Chief's hand-off to a helper: one short collapsed line — the ask, not the internal assignment prose — with the
    // result and the full words (Show details) behind it.
    if (m.author === 'chief' && bot !== 'chief') return { id: m.id, from: 'chief',
      text: `Chief asked: ${plain(String(m.title ?? text.split('\n')[0])).slice(0, 80)}`, detail: chatWords(text),
      files: [...pics, ...(m.files ?? []).map((f: Json) => fileView(f.bot, f.path))], choices: [] };
    return { id: m.id, from: m.author === 'person' ? 'me' : 'them', ...(m.helper ? { helper: String(m.helper) } : {}),
      recap: m.recap === true, text: m.author === 'person' ? (pics.length && /^Here (is a photo|are some photos)\.$/.test(text) ? '' : noTools(text)) : chatWords(text), files: [...pics, ...(m.files ?? []).map((f: Json) => fileView(f.bot, f.path))], choices: (m.choices ?? []).map(plain), at: m.at ? at(m.at) : undefined, unsure: m.author === 'bot' && /^Not sure it worked:|^[^.]{1,40} isn't sure “/.test(text) };
  }).filter((l: Line) => l.text || l.files.length);
}

/** Chief's thread (B1): one plain notice where a helper's finished job, with a file, landed in the tray — only from a done
 *  task that delivered files, placed by its time among the dated lines it falls after; nothing before the thread began. */
export function trayNotes(state: Json, lines: Line[]): Line[] {
  const first = lines.find((l) => l.at)?.at;
  if (!first) return lines;
  const notes = things(state).filter((t) => t.helper !== 'chief' && t.files.length && at(t.at) >= first)
    .map((t): Line => ({ id: -t.id, from: 'note', by: t.helper, text: `${crewName(state, t.helper)} finished ${t.title || 'a job'} · it's in your tray`, files: [], choices: [], at: at(t.at) }));
  const out = [...lines];
  for (const n of notes.sort((a, b) => a.at! - b.at!)) { const i = out.findLastIndex((l) => (l.at ?? 0) <= n.at!); out.splice(i + 1, 0, n); }
  return out;
}

/** A file build underway: the chat's task is live on a workbook or document job, and its file hasn't
 *  landed yet. The chat shows a skeleton card until the file's own card arrives. */
const FILE_JOB = /\b(excel|spreadsheet|xlsx?|workbook|docx?|document)\b/i;
export function building(lines: Line[], live: Json): boolean {
  if (!live || live.state !== 'working') return false;
  if ((live.files ?? []).some((f: Json) => !f.photo && !f.input)) return false;
  if (lines.some((l) => l.files.some((f) => f.kind === 'sheet' || f.kind === 'page'))) return false;
  const asked = [...lines].reverse().find((l) => l.from === 'me' && l.text)?.text ?? '';
  return FILE_JOB.test(asked) || FILE_JOB.test(String(live.title ?? ''));
}

/** What a helper remembers about you (or the whole crew knows about you), one line each, from its notes. */
export const memories = (notes = '') => notes.split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter((l) => l && !l.startsWith('#')).map(plain);
/** The sites the person signed a helper in to, bare hosts, sorted for a steady list — each with a Forget in Details. */
export const signedIn = (page: Json) => [...new Set((((page?.signedIn as string[]) ?? [])).map((h) => String(h).replace(/^www\./, '')))].sort();
/** The tick on the give-back sheet, one per tab host crewd read itself: the person's own say-so, never the bot's. */
export const signTick = (name: string, host: string) => `I signed ${name} in to ${host}`;
/** Which ticks start on: the tab on screen (crewd lists it first) — off by default, the person turns the rest on. */
export const signTicks = (pages: string[]) => (pages.length ? [pages[0]] : []);
/** The notes with one more line, or without the i-th: what Add and Forget send back. */
export const withMemory = (notes = '', line: string) => `${notes.replace(/\n*$/, '\n').replace(/^\n$/, '')}- ${line.replace(/\s+/g, ' ').trim()}\n`;
export function withoutMemory(notes = '', i: number) {
  let n = -1;
  return notes.split('\n').filter((l) => { if (!l.replace(/^[-*]\s*/, '').trim() || l.trim().startsWith('#')) return true; n++; return n !== i; }).join('\n');
}

/** Who a helper is, as plain lines: its own name heading dropped, section headings and bullets read as sentences. */
export const personality = (soul = '') => soul.split('\n').slice(soul.startsWith('# ') ? 1 : 0)
  .map((l) => l.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim()).filter(Boolean).map(plain);

/** The About section, in the person's words: one trait per line, about the helper, never instructions to it.
 *  Older souls were written as a prompt ("You are Reel. You love…"): read those as facts about the helper instead. */
export function aboutTraits(name: string, soul = ''): string[] {
  const lines = soul.split('\n');
  const at = lines.findIndex((l) => /^##\s+how you come across\s*$/i.test(l.trim()));
  if (at < 0) {
    return personality(soul).map((l) => l
      .replace(/^you are\b[^.：.]*[.：.]?\s*/i, '')
      .replace(/\byou are\b/gi, `${name} is`)
      .replace(/\byou're\b/gi, `${name} is`)
      .replace(/\byour\b/gi, `${name}'s`)
      .replace(/\byou\b/gi, name));
  }
  const traits: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (/^##\s/.test(l)) break;
    const t = plain(l.replace(/^[-*]\s*/, '').trim());
    if (t) traits.push(t);
  }
  return traits;
}
/** What the person edits: the traits, one per line, nothing else. */
export const aboutDraft = (name: string, soul = '') => aboutTraits(name, soul).join('\n');
/** The helper's instructions, composed behind the scenes from the person's plain words. */
export const soulText = (name: string, draft: string) => `# ${name}\n\n## How you come across\n${draft.trim().split('\n').map((l) => `- ${l.replace(/^[-*]\s*/, '').trim()}`).filter((l) => l !== '- ').join('\n')}\n`;
/** What a helper knows how to do, from its skills: their own descriptions, in plain words. */
export const knows = (skills: Json[] = []) => skills.map((k) => ({ name: String(k.name), says: plain(k.says || String(k.name).replace(/-/g, ' ')), learned: !!k.learned }));

// ---------- routines, people, accounts, apps ----------
export function routines(state: Json, bot?: string) {
  return state.routines.filter((r: Json) => !bot || r.bot === bot).map((r: Json) => {
    const one = r.kind === 'remind'; // a reminder is for one moment: its own words, and where it ended up
    return {
    id: r.id, name: plain(r.name), helper: r.kind === 'digest' ? 'chief' : r.bot, when: one ? 'One time' : plain(r.words ?? ''), on: one ? '' : plain(r.on ?? ''), paused: r.state === 'paused',
    next: one ? (r.next_at ? `at ${moment(Number(r.next_at))}` : r.last_at ? `reminded ${clock(Number(r.last_at))}` : '') : r.next_at ? nextAt(r.next_at) : '', digest: r.kind === 'digest', remind: one, reminded: one && !r.next_at,
    quiet: !!r.quiet, watching: r.watch ? host(r.watch) : '',
    last: r.history?.[0] ? lastRun(r.history[0]) : '',
    // Where the last run ended up: the thing it made, else its line in the helper's chat. A skipped run has neither.
    result: r.history?.[0]?.state === 'done' && r.history[0].thing ? { thing: r.history[0].thing } : r.history?.[0]?.state === 'done' && r.history[0].msg ? { msg: r.history[0].msg } : null,
    changes: (r.history ?? []).filter((h: Json) => h.watch === 'changed').length,
  };
  });
}
/** A reminder's moment in full: the clock alone today, the day with it later, so the row never reads as a bare time. */
function moment(at: number) {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString() ? clock(at) : `${d.toLocaleDateString([], { weekday: 'short' })} ${clock(at)}`;
}
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'a page'; } };
/** When a routine runs next, in the fewest words that stay true: the day, or the time when it is today. The row already
 *  says the time of day, so repeating it would only crowd the line. */
function nextAt(at: number) {
  const d = new Date(at), today = new Date();
  if (d.toDateString() === today.toDateString()) return clock(at);
  return Math.abs(at - today.getTime()) < 6 * 86_400_000 ? d.toLocaleDateString([], { weekday: 'short' }) : `${d.toLocaleDateString([], { weekday: 'short' })}, ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}
/** A routine's latest run in words; a watch says whether the page changed. */
function lastRun(h: Json) {
  const at = clock(h.at);
  if (h.state === 'paused') return h.reason?.includes('share of your AI today') ? "Waiting until tomorrow: today's share for background jobs is used up. Tap Do it now to run it anyway." : `Waiting: ${plain(h.reason ?? 'the crew cannot start yet')}`;
  if (h.kind === 'routine.skipped') return `Didn't start ${at}: another run is still in progress`;
  if (h.state === 'failed' || h.state === 'unsure') return `Didn't finish: ${plain(h.reason ?? 'please try again')}`;
  if (h.task && h.state !== 'done') return `Waiting for a result from ${at}`;
  if (h.watch === 'same') return `Checked ${at}, no change`;
  if (h.watch === 'started') return `Started watching ${at}`;
  if (h.watch === 'unreachable') return `Couldn't open the page ${at}; I'll try again next time`;
  if (h.watch === 'changed') return `Changed ${at}${h.clear ? ", nothing you'd want to hear about" : ''}`;
  return `Last ran ${at}${h.clear ? ', all clear' : ''}`;
}

/** The AI accounts a person can think with, in the order the app offers them: every route the engine supports,
 *  ChatGPT first (the one front door; the rest are quiet paths). Name and billing come from the kit's own catalogue,
 *  so a new route lands with the bump; `MARKS` is only what the kit can't know — the tile colour, the tool a route
 *  needs installed (`cli`), and where that provider's own page lives (`site`, `plans`). Kept in step with crewd's
 *  own list by test/ui.test.ts. */
const MARKS: Record<string, { bg: string; name?: string; cli?: string; site?: string; plans?: string }> = {
  chatgpt: { bg: '#10a37f', site: 'https://chatgpt.com/', plans: 'https://chatgpt.com/#pricing' },
  grok: { bg: '#1d1d1f' },
  copilot: { bg: '#24292f' },
  openrouter: { bg: '#8b5cf6' },
  minimax: { bg: '#e11d48', name: 'MiniMax' },
  claude: { bg: '#d97757', cli: 'Claude Code, installed and signed in on this computer' },
};
export const AIS = ['chatgpt', 'grok', 'copilot', 'openrouter', 'minimax', 'claude'].map((key) => {
  const mark = MARKS[key];
  const route = ROUTES[key];
  return { ...mark, key, name: route?.name ?? mark.name ?? key, billing: route?.billing ?? 'subscription' };
});
/** How one account is paid for, in the person's words: their own plan, or money charged for each use. */
export function paysFor(ai: { name: string; billing: string }) {
  return ai.billing === 'api' ? `each use is charged to your ${ai.name} account` : `it uses your own ${ai.name} plan`;
}
/** The honest word under the account list: which ones come with a plan the person already pays for, and which charge
 *  them for each use. Built from the rows above, so a new route can never be left unlabelled. */
export const AI_ROUTES = `Each one uses a plan you already pay for, except ${AIS.filter((a) => a.billing === 'api').map((a) => a.name).join(' and ')}, where ${paysFor(AIS.find((a) => a.billing === 'api')!)}.`;

/** One of the person's own AI accounts: signed in; a sign-in in progress (ChatGPT's page to say yes on, or the fallback
 *  code); how a sign-in ended (declined, the port busy, expired, failed); a plan without helpers; a work account. */
export function account(accounts: Json[] | null, key = 'chatgpt') {
  const a = accounts?.find((x) => x.account === key);
  const none = { recovery: '', signing: null, page: '', expired: false, failed: false, declined: false, busy: false, resting: '', notIncluded: false, work: '' };
  if (!a) return { state: 'checking' as const, ...none };
  const s = a.signIn;
  const phase = phaseOf({ signIn: s });
  const waiting = phase === 'waiting' || phase === 'code' || (phase === 'opening' && s?.state === 'waiting');
  const signing = phase === 'code' && s.code ? { url: s.url ?? '', code: s.code } : null;
  // Expiry stays an independent screen flag, based on the error words even when the reason also says busy or declined.
  const expired = s?.state === 'failed' && phaseOf({ signIn: { ...s, why: undefined } }) === 'expired';
  const declined = phase === 'cancelled';
  const busy = phase === 'busy';
  // 'unavailable' was the CLI missing; the engine now ships inside Crewhouse, so there is always something to sign in to.
  return { state: a.signedIn && !waiting ? 'ready' as const : 'signed-out' as const as 'ready' | 'signed-out' | 'unavailable',
    recovery: s?.why === 'locked' ? plain(s.error) : '', signing, page: waiting && !s?.code ? s?.url ?? '' : '', expired, declined, busy, failed: s?.state === 'failed' && !expired && !declined && !busy,
    resting: a.restingUntil > 0 ? `Resting until ${clock(a.restingUntil)}` : '', notIncluded: !!a.notIncluded,
    work: a.work ? (typeof a.work === 'string' ? a.work : 'a work account') : '' };
}
export const chatgpt = (accounts: Json[] | null) => account(accounts, 'chatgpt');

/** Settings' account list: the accounts signed in first (or ChatGPT, the front door, while none is), every other route
 *  under "More ways to sign in". Each row's one line says where it stands in plain words; a route nobody has signed in
 *  to here is "not set up", never connected. */
export function aiList(accounts: Json[] | null) {
  const rows = AIS.map((ai) => {
    const g = account(accounts, ai.key);
    const says = g.state === 'ready'
      ? g.notIncluded ? "Signed in, but your plan doesn't include helpers yet." : g.resting ? `Signed in. ${g.resting}.` : `Signed in${g.work ? ` as ${g.work}, a work account` : ''}. The crew uses it${ai.billing === 'api' ? ', charged per use' : ''}.`
      : g.recovery ? g.recovery : g.state === 'checking' ? 'Checking…'
      : ai.key === 'chatgpt' ? `Not signed in yet. You'll say yes once on ${ai.name}.`
      : ai.cli ? `Not set up. Needs ${ai.cli} first.`
      : ai.billing === 'api' ? `Not set up. Charged per use on your ${ai.name} account.`
      : `Not set up. Uses your own ${ai.name} plan.`;
    return { ai, g, says };
  });
  const mine = rows.filter((r) => r.g.state === 'ready');
  const front = mine.length ? mine : rows.filter((r) => r.ai.key === 'chatgpt');
  return { mine: front, more: rows.filter((r) => !front.includes(r)) };
}
/** The account the crew thinks with: the first one signed in. Null while checking, 'none' when there is none yet. */
export function thinking(accounts: Json[] | null) {
  if (!accounts) return null;
  return AIS.find((a) => account(accounts, a.key).state === 'ready') ?? 'none';
}
/** That account as the person says it: "Claude plan", "OpenRouter account" when paid per use; "AI plan" until there is one. */
export function planName(accounts: Json[] | null) {
  const ai = thinking(accounts);
  return ai && ai !== 'none' ? `${ai.name} ${ai.billing === 'api' ? 'account' : 'plan'}` : 'AI plan';
}

/** Whose sign-in page an app opens: "Google" for Gmail, Calendar and Drive. */
export const signsInWith = (app: App) => ({ gmail: 'Google', calendar: 'Google', drive: 'Google' } as Record<string, string>)[app.id] ?? app.name;
export const appById = (state: Json, id: string) => apps(state).find((a) => a.id === id);
/** Google's apps wait for the owner to switch Google on for your crew (once, in Settings). */
export const needsHouse = (state: Json, app: App) => signsInWith(app) === 'Google' && state.house?.google === false;

// v1: Drive, Calendar and Gmail on the person's own Google app, then Notion and Canva. Sharing from the phone needs no
// connection at all. Calendar and Gmail show Google's "unverified app" screen, so their card warns first.
const APPS: App[] = [
  { id: 'drive', name: 'Google Drive', mark: '▲', bg: '#fbbc04', on: false, does: 'Helpers can save copies of what they make, and open files you pick.' },
  { id: 'calendar', name: 'Google Calendar', mark: '31', bg: '#4285f4', on: false, warns: true, does: 'Helpers can see your week and add things. You can undo any change.' },
  { id: 'gmail', name: 'Gmail', mark: 'M', bg: '#ea4335', on: false, warns: true, does: 'Helpers can read your email to find things. They never send from it.' },
  { id: 'notion', name: 'Notion', mark: 'N', bg: '#2e2a40', on: false, does: 'Helpers can read and add pages you share with them.' },
  { id: 'canva', name: 'Canva', mark: 'C', bg: 'linear-gradient(135deg,#00c4cc,#7d2ae8)', on: false, does: 'Helpers can make designs in your Canva.' },
];
/** The app grid; which ones are on comes from crewd's connections once it has them. */
export const apps = (state: Json): App[] => APPS.map((a) => ({ ...a, on: !!state.connections?.includes?.(a.id) }));

/** One reviewed starter skill: its name, what it does, why it is in the set, what it needs, and whether it is on. */
export type StarterSkill = { slug: string; name: string; what: string; why: string; needs: string[]; on: boolean; reviewed: boolean };
/** The Skills screen's set: the reviewed skills as crewd lists them (`GET /api/skills`), plus catalog search rows. */
const skillName = (s: Json) => String(s.name ?? String(s.slug).split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' '));
export const starterSkills = (skills: Json): StarterSkill[] => ((skills?.starter ?? []) as Json[]).map((s) => ({
  slug: String(s.slug), name: skillName(s),
  what: String(s.summary ?? ''), why: String(s.why ?? ''), needs: ((s.needs ?? []) as Json[]).map(String), on: s.on === true, reviewed: true }));
export const skillSearch = (results: Json[], starter: StarterSkill[]): StarterSkill[] => (results as Json[]).map((r) => ({
  slug: String(r.slug), name: skillName(r),
  what: String(r.summary ?? ''), why: '', needs: [], on: starter.some((s) => s.slug === String(r.slug) && s.on),
  reviewed: starter.some((s) => s.slug === String(r.slug)) }));

// ---------- the office ----------
/** One helper in the person's office, from the plain-words adapter views. `ask` is that helper's first row in
 *  Needs you (A.needsYou), never a suggestion that lives in its chat; `second` marks another helper of a kind that
 *  came earlier in the crew, so the room and the dock can tell the two apart. */
export type OfficeMember = { id: string; name: string; kind: Kind; mood: Mood; ring: Helper['ring']; seat: Seat; status: string;
  step: string; steps: Step[]; things: FileView[]; ask?: Card; second?: boolean };
/** The one state source every office surface reads: the room, its header counts, the tray, the dock or rail roster
 *  and Needs you. `needs` is Needs you itself; `counts.needs` is its length, `working` the helpers whose seat is
 *  working (one waiting on you counts once, under needs, wherever they show), `done` what
 *  landed in the tray today. */
export type OfficeView = { chief: ChiefView; crew: OfficeMember[]; done: Thing[]; needs: Card[];
  counts: { needs: number; working: number; done: number } };

/** Where a helper is, in one word the whole office agrees on (helper()): a row of theirs in Needs you, a job stopped for
 *  an answer that lives in their chat, working, gone quiet on a job, the last job ended badly today, next in line, held
 *  for something else (a sign-in, an account back later, the person at the wheel), or free. */
export type Seat = 'needs' | 'chat' | 'working' | 'quiet' | 'failed' | 'next' | 'waiting' | 'free';
export const seatOf = (c: OfficeMember): Seat => (c.ask ? 'needs' : c.seat);
export const SEAT_WORDS: Record<Seat, string> = { needs: 'Needs you', chat: 'Waiting on your reply', working: 'Working', quiet: 'Gone quiet', failed: "Didn't finish", next: 'Up next', waiting: 'Waiting', free: 'Free' };
/** The rail's word for one helper, short enough for the rail: its seat (the panel and the chat say what a hold waits for),
 *  except that a free helper whose latest job landed today says which (Main590 6: the rail shows Reel done after a
 *  hand-off). An older finish is just free. */
export function railWord(c: OfficeMember, v: OfficeView): { word: string; seat: Seat | 'done' } {
  const seat = seatOf(c);
  const last = seat === 'free' ? v.done.filter((t) => t.helper === c.id && t.at >= midnight()).sort((a, b) => b.at - a.at)[0] : undefined;
  return last ? { word: `Done: ${last.title || 'a job'}`, seat: 'done' } : { word: seat === 'failed' && c.status === 'Not sure it worked' ? 'Not sure' : SEAT_WORDS[seat], seat };
}
/** Who comes first when there is one seat less than helpers: whoever needs you, then working, then anything held,
 *  free last. */
const SEAT_ORDER: Seat[] = ['needs', 'chat', 'working', 'quiet', 'failed', 'waiting', 'next', 'free'];
/** The whole crew, the one who matters most first (crew order inside each seat): the phone's dock and the web rail. */
export const roster = (crew: OfficeMember[]) => SEAT_ORDER.flatMap((k) => crew.filter((c) => seatOf(c) === k));

/** The question that matters most comes first: money, then anything sent in the person's name, then the rest. */
export const askRank = (c: Card) => (c.kind === 'spend' ? 0 : c.kind === 'ok' ? 1 : 2);
const tally = (crew: OfficeMember[], needs: Card[], done: Thing[]) =>
  ({ needs: needs.length, working: crew.filter((c) => seatOf(c) === 'working').length, done: done.filter((t) => t.at >= midnight()).length });
/** The member's Needs-you row: the first in Needs you's own order. */
const askFor = (needs: Card[], id: string) => needs.find((c) => c.helper === id);
export function office(state: Json): OfficeView {
  const helpers = crew(state);
  const raw = new Map((state.bots as Json[] ?? []).map((b: Json) => [b.id, b]));
  const lines = new Map(work(state).map((w) => [w.helper, w]));
  const needs = needsYou(state);
  const events = (state.events ?? []) as Json[];
  const kinds = new Set<Kind>();
  const crewRows: OfficeMember[] = helpers.map((h) => {
    const b = raw.get(h.id) ?? {};
    const task = b.task ?? null;
    const now = task ? steps(events, task.id, true) : [];
    // The desk holds the task's delivered files first (they survive the 80-event window), then any live
    // arrival the snapshot predates; a path delivered again (a first look, then the finished one) is one thing.
    const desk = deskThings(h.id, task);
    const paths = task ? events.filter((e) => e.kind === 'file.delivered' && !e.data?.photo && e.data?.task === task.id).map((e) => String(e.data?.path ?? '')) : [];
    const extra = paths.filter((p, i) => paths.lastIndexOf(p) === i && !desk.some((f) => f.url === fileView(h.id, p).url));
    const made = [...desk, ...extra.map((p) => fileView(h.id, p))];
    const w = lines.get(h.id);
    const second = kinds.has(h.kind);
    kinds.add(h.kind);
    return { id: h.id, name: h.name, kind: h.kind, mood: h.mood, ring: h.ring, seat: h.seat, status: h.status,
      step: (b.step && step(b.step)) || (w && !w.waiting ? 'Getting started…' : ''), steps: now, things: made,
      ask: askFor(needs, h.id), ...(second ? { second } : {}) };
  });
  const done = things(state);
  return { chief: chief(state), crew: crewRows, done, needs, counts: tally(crewRows, needs, done) };
}

/** Needs-you rows no helper in the room holds (Chief's own, or one left by a helper since let go): Chief carries
 *  them, so every row in Needs you has a Review somewhere in the room. */
/** Chief's state in one word, the same in the room, his profile and on the phone. */
export const chiefWord = (v: OfficeView) => (chiefAsks(v).length ? 'Needs you' : v.chief.mood === 'work' ? 'Working' : 'Here');
export const chiefAsks = (view: OfficeView) => view.needs.filter((c) => !view.crew.some((m) => m.id === c.helper));

/** The office while the home computer is out of reach: nobody claims to be busy or waiting, and nothing asks. */
export function officeAway(view: OfficeView, line = 'Out of reach for now'): OfficeView {
  const crew = view.crew.map((c) => ({ ...c, mood: 'rest' as Mood, ring: '' as const, seat: 'waiting' as const, ask: undefined, status: line, step: '', steps: [] }));
  return { ...view, chief: { ...view.chief, mood: 'rest', line }, crew, needs: [], counts: { ...tally(crew, [], view.done) } };
}

/** The office between refreshes: crewd's debounced snapshot stays the source of truth, and each live event only
 *  moves the words it carries (report §7). Pure — the passed view is never changed. A question that opens waits for
 *  the refresh to bring its Needs-you row, so Review never shows before there is something to review. */
export function officeEvent(view: OfficeView, e: Json): OfficeView {
  const next = (crew: OfficeMember[], done = view.done, needs = view.needs): OfficeView => ({ ...view, crew, done, needs, counts: tally(crew, needs, done) });
  const touch = (id: string, f: (c: OfficeMember) => OfficeMember): OfficeView => {
    const crew = view.crew.map((c) => (c.id === id ? f(c) : c));
    return crew.every((c, i) => c === view.crew[i]) ? view : next(crew);
  };
  const say = (c: OfficeMember, text: string): OfficeMember => {
    const last = c.steps.at(-1);
    const seq = typeof e.seq === 'number' ? e.seq : (last?.seq ?? 0) + 1;
    const steps = last?.text === text ? c.steps : [...c.steps, { at: e.at == null ? Date.now() : at(e.at), text, seq }].slice(-80);
    return { ...c, step: text, steps: steps.map((s, i, a) => ({ ...s, now: i === a.length - 1 })) };
  };
  const d = e.data ?? {};
  switch (e.kind) {
    case 'run.tool': {
      const text = d.words ? plain(d.words) : 'Worked on it';
      return touch(String(e.bot), (c) => say(c, text));
    }
    case 'task.progress': {
      const text = plain(d.text ?? '');
      if (!text) return view;
      return touch(String(e.bot), (c) => say(c, text));
    }
    case 'file.delivered': {
      return touch(String(e.bot), (c) => {
        const withStep = say(c, step(e) ?? c.step);
        const f = fileView(c.id, String(d.path ?? ''));
        return d.photo ? withStep : { ...withStep, things: [...withStep.things.filter((x) => x.url !== f.url), f] };
      });
    }
    case 'task.working': // a new job is only queued (task.created) until crewd starts it
      return touch(String(e.bot), (c) => ({ ...c, ring: 'working' as const, seat: 'working' as const,
        mood: ['idle', 'rest', 'error'].includes(c.mood) ? 'work' as Mood : c.mood,
        status: d.title ? plain(d.title) : c.status }));
    case 'task.paused':
      return touch(String(e.bot), (c) => ({ ...c, ring: '' as const, seat: 'waiting' as const, mood: 'rest' as Mood, step: '', steps: [], status: waitWords(d.result) }));
    case 'task.done': {
      const files = (Array.isArray(d.files) ? d.files : []).map((f: Json) => fileView(String(e.bot), String(f)));
      const thing: Thing = { id: typeof d.task === 'number' ? d.task : Date.now(), helper: String(e.bot),
        title: plain(d.title ?? ''), at: e.at ?? Date.now(), summary: teaser(d.result ?? '').slice(0, 220), files };
      const crew = view.crew.map((c) => (c.id === String(e.bot)
        ? { ...c, ring: '' as const, seat: 'free' as const, mood: 'happy' as Mood, status: 'Free to help', step: '', steps: [], things: [], ask: undefined } : c));
      return next(crew, [thing, ...view.done], view.needs.filter((c) => c.helper !== String(e.bot)));
    }
    case 'task.failed':
    case 'task.unsure':
      return touch(String(e.bot), (c) => ({ ...c, ring: '' as const, seat: 'failed' as const, mood: 'error' as Mood, step: step(e) ?? c.step,
        status: e.kind === 'task.unsure' ? 'Not sure it worked' : "Didn't finish" }));
    case 'ask.opened':
      return touch(String(e.bot), (c) => ({ ...c, ring: 'needs' as const, seat: 'chat' as const, mood: 'ask' as Mood, status: 'Needs you', step: 'Waiting for your OK' }));
    case 'ask.answered':
    case 'ask.parked': {
      // The row leaves Needs you at once; the helper goes back to the last step the refresh knew, since the snapshot
      // stays the source of truth and this only bridges the gap between refreshes.
      const needs = view.needs.filter((c) => c.id !== d.ask);
      const crew = view.crew.map((c) => {
        if (c.id !== String(e.bot)) return c;
        const ask = askFor(needs, c.id);
        if (c.ring !== 'needs' || ask) return { ...c, ask };
        const back = c.steps.at(-1);
        return { ...c, ask, ring: back ? 'working' as const : '' as const, seat: back ? 'working' as const : 'free' as const,
          mood: back ? 'work' as Mood : 'idle' as Mood, status: back ? back.text : 'Free to help', step: back ? back.text : '' };
      });
      return next(crew, view.done, needs);
    }
    default:
      return view;
  }
}

/** What On it now says when nobody is working: who waits on you, else who is held, quiet or ended badly; the crew is
 *  free only when every one of them is. */
export function idleLine(v: OfficeView) {
  const n = (k: Seat[]) => v.crew.filter((c) => k.includes(seatOf(c))).length;
  const on = n(['needs', 'chat']);
  if (on) return `Nobody is working: ${on} waiting on you.`;
  const rest = ([[n(['waiting', 'next']), 'waiting'], [n(['quiet']), 'gone quiet'], [n(['failed']), "didn't finish"]] as const).filter(([k]) => k).map(([k, w]) => `${k} ${w}`);
  return rest.length ? `Nobody is working right now: ${rest.join(', ')}.` : 'Nobody is working right now. The crew is free.';
}
/** A helper waiting on you: a row in Needs you, or a job stopped for an answer in their chat. */
export const waitsOnYou = (c: OfficeMember) => c.seat === 'chat' || !!c.ask;
/** Who handed a finished job to the tray between two views: a done row the earlier view lacked. The done list is what
 *  the tray counts, so the hand-off follows it, however the events were grouped into commits. */
export const handedIn = (was: OfficeView, now: OfficeView) => [...new Set(now.done.filter((t) => !was.done.some((w) => w.id === t.id)).map((t) => t.helper))];
export const SEATS = 5;
export type FloorPlan = { seats: OfficeMember[]; more: OfficeMember[] };
/** Who stands on the office's one floor, one rule for the web and the phone (B1): five spots in the roster's order,
 *  whoever waits on you first, then working, then anything held, free last; everyone else is counted under "+N"
 *  (`more`, roster order), never drawn smaller. The rail and the dock still name the whole crew. */
export function floorPlan(crew: OfficeMember[]): FloorPlan {
  const order = roster(crew);
  return { seats: order.slice(0, SEATS), more: order.slice(SEATS) };
}
