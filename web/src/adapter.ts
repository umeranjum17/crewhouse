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

/** A file's name as a person would say it: "files/mum-birthday_v2.mp4" → "Mum birthday v2". */
export function pretty(path: string) {
  const b = (path.split('/').pop() ?? path).replace(/\.[a-z0-9]+$/i, '').replace(/[-_.]+/g, ' ').trim();
  return b ? b[0].toUpperCase() + b.slice(1) : 'A file';
}
/** The bot and path a file view came from, for the phone's photo fetch: `/files/<bot>/<path under files/>`. */
export const fileSource = (url: string) => { const m = /^\/files\/([a-z0-9-]+)\/(.+)$/.exec(url); return m ? { bot: m[1], path: `files/${decodeURIComponent(m[2])}` } : null; };

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

/** Settings, Phones, "Reach it from anywhere": one of three states in plain words, and the steps still to do. Tailscale
 *  is free for a family; each person gets this computer shared with them, never an invitation into the owner's network. */
export function anywhere(link: Json) {
  const state: 'home' | 'anywhere' | 'signin' = link?.anywhere === 'anywhere' || link?.anywhere === 'signin' ? link.anywhere : 'home';
  const words = {
    home: 'Only at home. Phones reach this computer on the home Wi-Fi. To reach it from anywhere, set up Tailscale, a free app:',
    anywhere: "Reachable from anywhere. A phone that has this computer shared with it in Tailscale opens Crewhouse on mobile data too. To add someone:",
    signin: "Tailscale needs signing in again on this computer. Until then, phones reach it only on the home Wi-Fi. Open Tailscale here and sign in.",
  }[state];
  const steps = [
    'Install Tailscale on this computer and sign in with Google.',
    'For each person, open this computer in Tailscale, tap Share, and send them the link.',
    'On their phone: install Tailscale, sign in with Google, and tap Accept on the link. Then pair the phone here.',
  ];
  return { state, words, steps: state === 'home' ? steps : state === 'anywhere' ? steps.slice(1) : [] };
}

/** The phone can't reach the home computer: which step is missing, from what the phone can see for itself (`home`: on
 *  the same Wi-Fi as the computer's home address; `tailnet`: it knows the computer's Tailscale address; `vpn`: Tailscale
 *  is on on the phone) and what the computer last said about its own Tailscale. */
export function away(f: { home?: boolean; tailnet?: boolean; vpn?: boolean; anywhere?: string }) {
  if (f.home) return "You're on the home Wi-Fi, but the home computer isn't answering. Check it's switched on and awake.";
  if (!f.tailnet) return "Away from home, this phone reaches the home computer through Tailscale, and that isn't set up yet. Ask whoever set up Crewhouse to share the computer with you in Tailscale.";
  if (!f.vpn) return 'Tailscale is off on this phone. Open the Tailscale app and switch it on.';
  if (f.anywhere === 'signin') return "The home computer's Tailscale needs signing in again. Ask whoever set up Crewhouse to open Tailscale there and sign in.";
  return "Tailscale is on, but the home computer isn't answering. It may be asleep or switched off.";
}

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

/** The owner's steps to switch Google on for the house, each with the Google page it happens on (docs/google-setup.md). */
export const GOOGLE_STEPS = [
  { title: 'Make a project', url: 'https://console.cloud.google.com/projectcreate', says: 'Sign in with your own Google account and name it “Crewhouse (family)”. No billing is needed.' },
  { title: 'Switch on Calendar, Gmail and Drive', url: 'https://console.cloud.google.com/apis/library', says: 'Search for each of “Google Calendar API”, “Gmail API” and “Google Drive API”, and press Enable on each.' },
  { title: 'Describe the app', url: 'https://console.cloud.google.com/auth/overview', says: 'Choose External, name it “Crewhouse” with your email as the contact. Under Data access add calendar.events, gmail.readonly and drive.file. Under Audience press Publish app, so it says “In production”.' },
  { title: 'Make the key', url: 'https://console.cloud.google.com/apis/credentials', says: 'Create credentials, OAuth client ID, type “Desktop app”, named “Crewhouse home computer”. Copy the Client ID and the Client secret, and paste them below.' },
];

/** Settings, Phones: whether phones reach this computer from anywhere, in one sentence. */
export function reach(link: Json) {
  let where = '';
  try { where = link?.relay ? new URL(link.relay).host : ''; } catch { /* kept as typed */ }
  const words: Record<string, string> = {
    online: `On. Phones reach this computer from anywhere through ${where}, which passes along what they say without being able to read it.`,
    connecting: `Getting in touch with ${where}…`,
    offline: `Can't reach ${where} right now. Trying again by itself.`,
    refused: `${where} didn't let this computer in. Ask whoever runs it for a new invitation and paste it below.`,
    replaced: 'Another copy of Crewhouse took over this address, so this one stepped back.',
  };
  const on = !!link?.relay && link.relayStatus !== 'off';
  return { on, online: link?.relayStatus === 'online', words: on ? words[link.relayStatus] ?? words.connecting : 'Off.' };
}

/** The crew's share of the viewer's ChatGPT, as three choices and one sentence about today. Never a number. */
export const SHARES = [
  { key: 'light', label: 'Light', says: 'Leave most of my ChatGPT for me' },
  { key: 'normal', label: 'Normal', says: 'Share it evenly' },
  { key: 'full', label: 'As much as it needs', says: 'Use what the work takes' },
];
/** The small line at the bottom of the side rail: how the crew's share of ChatGPT stands today. */
export const meter = (state: Json) => (state.share?.used ? 'ChatGPT: the crew has had its share today' : resting(state) ? `${resting(state)}` : 'ChatGPT: plenty left for you today');
export function share(state: Json) {
  const s = state.share ?? { choice: 'light', used: false };
  const part: Record<string, string> = { small: 'a small part', fair: 'a fair part', most: 'most' };
  return { choice: s.choice as string, week: part[s.week] ? `This week the crew has used ${part[s.week]} of what it may use of your ChatGPT.` : '', today: s.used ? 'The crew has had its share for today. Routines and check-ins start again tomorrow morning; anything you ask for still goes ahead.'
    : s.choice === 'full' ? 'When ChatGPT needs a rest, the crew waits and says so.' : 'Plenty left for you today.' };
}

/** The house's monthly money cap, owner only: "This month: nothing spent yet" or "$4 of $20 spent". */
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
  return last.author === 'person' ? `You: ${text.replace(/\s+/g, ' ')}` : plain(text.replace(/\s+/g, ' '));
}
export function chats(state: Json): Chat[] {
  const bot = (id: string) => state.bots.find((b: Json) => b.id === id) ?? {};
  const c = chief(state);
  const lead: Chat = { id: 'chief', name: 'Chief', who: 'chief', line: preview(bot('chief').last, c.line), at: at(bot('chief').last?.at ?? 0) || 0, unread: bot('chief').unread ?? 0, ring: c.mood === 'ask' ? 'needs' : '' };
  const rest = crew(state).map((h): Chat => {
    const b = bot(h.id);
    // Working or waiting on the person says more than the last line did.
    const line = h.ring === 'needs' ? 'Needs you' : h.driving ? h.status : h.ring === 'working' ? `Working on: ${h.status}` : preview(b.last, h.role);
    return { id: h.id, name: h.name, who: h, line, at: at(b.last?.at ?? 0) || 0, unread: b.unread ?? 0, ring: h.ring };
  }).sort((a, b) => b.at - a.at);
  return [lead, ...rest];
}
export const unreadBadge = (n: number) => (n > 9 ? '9+' : String(n));

/** What Search found: lines from the member's chats and finished things, each opening its chat. */
export function found(state: Json, r: Json | null) {
  if (!r) return [];
  const name = (id: string) => (id === 'chief' ? 'Chief' : state.bots.find((b: Json) => b.id === id)?.display ?? id);
  return [
    ...(r.things ?? []).map((t: Json) => ({ key: `t${t.id}`, bot: t.bot as string, name: name(t.bot), text: `Made “${plain(t.title)}”`, at: at(t.at) })),
    ...(r.messages ?? []).map((m: Json) => ({ key: `m${m.id}`, bot: m.bot as string, name: name(m.bot), text: preview(m), at: at(m.at) })),
  ];
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
  if (a.kind === 'propose') {
    // A suggestion: a skill a helper would like to keep, or a new personality from Chief. Nothing changes without a yes.
    return { ...base, kind: 'ok', head: a.bot === 'chief' ? 'Chief has a suggestion' : `${name} learned something`, words: plain(d.words ?? `${name} has a suggestion.`),
      preview: d.preview ? { head: d.preview.head ? plain(d.preview.head) : undefined, body: plain(d.preview.body ?? '') } : undefined,
      choices: [{ label: d.yes ? plain(d.yes) : a.bot === 'chief' ? 'Yes, change it' : 'Yes, keep it', body: { answer: 'allow', scope: 'once' }, primary: true }, { label: 'Not now', body: { answer: 'deny' } }] };
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

/** Chief's three first-run ideas: one tap is both "hello" and the first job. */
export const FIRST_IDEAS = [
  { icon: '🍲', label: "Plan this week's dinners, with a shopping list" },
  { icon: '🎂', label: 'Write a birthday message for Mum' },
  { icon: '📅', label: "What's on this week?" },
];

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
    case 'file.delivered': return d.photo ? 'You sent a photo' : `Made “${pretty(d.path)}”`;
    case 'memory.learned': return `${d.everyone ? 'Learned, for the whole crew' : 'Learned'}: ${plain(d.text)}`;
    case 'memory.undone': return `You undid: ${plain(d.text)}`;
    case 'skill.learned': return `Learned how to: ${plain(d.says ?? d.name)}`;
    case 'skill.removed': return `You put away: ${plain(d.says || d.name)}`;
    case 'soul.changed': return d.by === 'chief' ? 'Took on the personality Chief suggested' : d.reset ? 'Went back to how it started' : 'You changed how it comes across';
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
/** Photos sent with a message ride in its text as `[photo <bot>] files/photos/…` lines: pictures, not words. */
const PHOTO = /\n?\[photo ([a-z0-9-]+)\] (files\/\S+)/g;
const photos = (text: string) => [...text.matchAll(PHOTO)].map((m) => fileView(m[1], m[2]));

export function lines(page: Json, bot: string): Line[] {
  return (page?.messages ?? []).map((m: Json) => {
    const pics = photos(String(m.text ?? ''));
    const text = String(m.text ?? '').replace(PHOTO, '').trim();
    if (m.author === 'system') {
      const f = /^Delivered (files\/.+?)(?::\s|$)/.exec(text);
      return f ? { id: m.id, from: 'note', text: plain(text.slice(f[0].length)) || `Here's “${pretty(f[1])}”`, files: [fileView(bot, f[1])], choices: [] }
        : { id: m.id, from: 'note', text: plain(text), files: [], choices: [] };
    }
    // Another helper handing this one a job: a note in its words, "Reel asked: …".
    if (!['person', 'bot', 'chief'].includes(m.author)) return { id: m.id, from: 'note', text: `${String(m.author).replace(/^./, (c) => c.toUpperCase())} asked: ${plain(text)}`, files: [], choices: [] };
    return { id: m.id, from: m.author === 'person' ? 'me' : m.author === 'chief' && bot !== 'chief' ? 'chief' : 'them',
      text: m.author === 'person' ? (pics.length && /^Here (is a photo|are some photos)\.$/.test(text) ? '' : text) : plain(text), files: pics, choices: (m.choices ?? []).map(plain) };
  }).filter((l: Line) => l.text || l.files.length);
}

/** What a helper remembers about you (or the whole crew knows about you), one line each, from its notes. */
export const memories = (notes = '') => notes.split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter((l) => l && !l.startsWith('#')).map(plain);
/** The notes with one more line, or without the i-th: what Add and Forget send back. */
export const withMemory = (notes = '', line: string) => `${notes.replace(/\n*$/, '\n').replace(/^\n$/, '')}- ${line.replace(/\s+/g, ' ').trim()}\n`;
export function withoutMemory(notes = '', i: number) {
  let n = -1;
  return notes.split('\n').filter((l) => { if (!l.replace(/^[-*]\s*/, '').trim() || l.trim().startsWith('#')) return true; n++; return n !== i; }).join('\n');
}

/** Who a helper is, as plain lines: its own name heading dropped, section headings and bullets read as sentences. */
export const personality = (soul = '') => soul.split('\n').slice(soul.startsWith('# ') ? 1 : 0)
  .map((l) => l.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim()).filter(Boolean).map(plain);
/** The text a person edits: everything but the name heading, which crewd keeps. */
export const soulDraft = (soul = '') => soul.split('\n').slice(soul.startsWith('# ') ? 1 : 0).join('\n').trim();
export const soulText = (name: string, draft: string) => `# ${name}\n\n${draft.trim()}\n`;
/** What a helper knows how to do, from its skills: their own descriptions, in plain words. */
export const knows = (skills: Json[] = []) => skills.map((k) => ({ name: String(k.name), says: plain(k.says || String(k.name).replace(/-/g, ' ')), learned: !!k.learned }));

// ---------- routines, people, accounts, apps ----------
export function routines(state: Json, bot?: string) {
  return state.routines.filter((r: Json) => !bot || r.bot === bot).map((r: Json) => ({
    id: r.id, name: plain(r.name), helper: r.kind === 'digest' ? 'chief' : r.bot, when: r.words, paused: r.state === 'paused', next: clock(r.next_at), digest: r.kind === 'digest',
    quiet: !!r.quiet, watching: r.watch ? host(r.watch) : '',
    last: r.history?.[0] ? lastRun(r.history[0]) : '',
    changes: (r.history ?? []).filter((h: Json) => h.watch === 'changed').length,
  }));
}
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'a page'; } };
/** A routine's latest run in words; a watch says whether the page changed. */
function lastRun(h: Json) {
  const at = clock(h.at);
  if (h.kind === 'routine.skipped') return `Last ran ${at}, skipped while busy`;
  if (h.watch === 'same') return `Checked ${at}, no change`;
  if (h.watch === 'started') return `Started watching ${at}`;
  if (h.watch === 'unreachable') return `Couldn't open the page ${at}; I'll try again next time`;
  if (h.watch === 'changed') return `Changed ${at}${h.clear ? ", nothing you'd want to hear about" : ''}`;
  return `Last ran ${at}${h.clear ? ', all clear' : ''}`;
}

/** The AI accounts a person can think with, in the order the app offers them. Never another brand, and never Claude. */
export const AIS = [{ key: 'chatgpt', name: 'ChatGPT' }]; // the one front door; crewd keeps other accounts as quiet paths

/** One of the person's own AI accounts: signed in; a sign-in in progress (ChatGPT's page to say yes on, or the fallback
 *  code); how a sign-in ended (declined, the port busy, expired, failed); a plan without helpers; a work account. */
export function account(accounts: Json[] | null, member: number, key = 'chatgpt') {
  const a = accounts?.find((x) => x.member === member && x.account === key);
  const none = { signing: null, page: '', expired: false, failed: false, declined: false, busy: false, resting: '', notIncluded: false, work: '' };
  if (!a) return { state: 'checking' as const, ...none };
  const s = a.signIn;
  const waiting = s?.state === 'waiting';
  const signing = waiting && s.code ? { url: s.url ?? '', code: s.code } : null;
  const expired = s?.state === 'failed' && /expired|too long/i.test(s.error ?? '');
  const declined = s?.state === 'failed' && s.why === 'declined';
  const busy = s?.state === 'failed' && s.why === 'busy';
  // 'unavailable' was the CLI missing; the engine now ships inside Crewhouse, so there is always something to sign in to.
  return { state: a.signedIn ? 'ready' as const : 'signed-out' as const as 'ready' | 'signed-out' | 'unavailable',
    signing, page: waiting && !s.code ? s.url ?? '' : '', expired, declined, busy, failed: s?.state === 'failed' && !expired && !declined && !busy,
    resting: a.restingUntil > 0 ? `Resting until ${clock(a.restingUntil)}` : '', notIncluded: !!a.notIncluded,
    work: a.work ? (typeof a.work === 'string' ? a.work : 'a work account') : '' };
}
export const chatgpt = (accounts: Json[] | null, member: number) => account(accounts, member, 'chatgpt');
/** The account the crew thinks with: the first one signed in. Null while checking, 'none' when there is none yet. */
export function thinking(accounts: Json[] | null, member: number) {
  if (!accounts) return null;
  return AIS.find((a) => account(accounts, member, a.key).state === 'ready') ?? 'none';
}

/** Whose sign-in page an app opens: "Google" for Gmail, Calendar and Drive. */
export const signsInWith = (app: App) => ({ gmail: 'Google', calendar: 'Google', drive: 'Google' } as Record<string, string>)[app.id] ?? app.name;
export const appById = (state: Json, id: string) => apps(state).find((a) => a.id === id);
/** Google's apps wait for the owner to switch Google on for the house (once, in Settings). */
export const needsHouse = (state: Json, app: App) => signsInWith(app) === 'Google' && state.house?.google === false;

// v1: Drive, Calendar and Gmail on the household's Google app, then Notion and Canva. Sharing from the phone needs no
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
