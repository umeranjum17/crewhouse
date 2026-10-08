// What a bot may do without asking. Safe work in its own space runs silently; sending, spending, deleting and touching the
// person's own files stop for one plain sentence first. Decided here from the tool and its input, never by the model's words.
import { homedir } from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';

export type Effect =
  | { kind: 'safe' }
  | { kind: 'refuse'; why: string }
  /** `key` is what "For this task" and "Always" remember (spending has none, so it asks every time); `cost` caps a spend in dollars when stated up front. */
  | { kind: 'files' | 'send' | 'spend' | 'delete'; words: string; key?: string; covers?: string; cost?: number;
      preview?: { head: string; body: string }; press?: boolean; fill?: boolean };

export interface Seen {
  bot: string;
  space: string;
  /** The page the bot's browser is on, from its own tool results. */
  page?: string;
  /** Sites the person signed the bot in to (its browser acts there as them). */
  signedIn?: string[];
  /** The host of the page where the helper typed lines nobody has approved yet (a claim form waiting for its submit). */
  filledHost?: string;
  /** Command-line tools that run with the person's own sign-in: argument prefixes that are free, and those that spend. */
  run?: Record<string, { name: string; free: string[]; spend: string[] }>;
  /** Folders no bot may open at all: sign-ins and keys, the engine's own and every other program's. */
  secret: string[];
  /** Tools from the person's connected apps, with what each does to the world. */
  apps?: Record<string, { app: string; title: string; readOnly: boolean; destructive: boolean }>;
}

const READS = new Set(['read', 'ls', 'grep', 'find']);
const WRITES = new Set(['write', 'edit']);
/** Whether a call that goes through does something out in the world (sends, buys, deletes, or presses and types on a web
 *  page): a job that did has to say whether it worked. */
export function acts(tool: string, input: Record<string, any>, e: Effect) {
  return e.kind === 'send' || e.kind === 'spend' || e.kind === 'delete' || (tool === 'browser' && BROWSER_ACTS.has(String(input.args?.[0] ?? '')));
}

/** Always safe: they only touch the bot's own space, the web, or Crewhouse itself. bash runs in the sandbox. The
 *  crew's file tools are NOT here: a write outside the bot's folder asks, exactly as it always did. */
const SAFE = new Set(['bash', 'web_search', 'web_fetch', 'crew_web_search', 'crew_web_fetch', 'memory_search', 'memory_get', 'view_image', 'pdf', 'image_generate',
  'crew_connect', 'crew_outcome', 'crew_report', 'crew_deliver', 'crew_workbook', 'crew_document', 'crew_remember', 'crew_draft',
  'crew_verify', 'crew_learn', 'crew_routine', 'crew_pass', 'crew_batch', 'crew_add_phone', 'crew_roster', 'crew_recruit', 'crew_assign',
  'crew_routines', 'crew_status', 'crew_suggest', 'crew_create', 'crew_import', 'crew_call_me', 'crew_profile']);
/** The file tools keep their old names' effects under their crew_ names: same asks, same keys, same words. */
const baseName = (tool: string) => tool.startsWith('crew_') ? tool.slice(5) : tool;
// The browser AXI's commands: looking never asks, acting follows the "asks first" rules, anything else is refused
// (attaching elsewhere, running page scripts, reading or setting cookies and storage, the session's own lifecycle).
const BROWSER_LOOKS = new Set(['goto', 'snapshot', 'find', 'go-back', 'go-forward', 'reload', 'tab-list', 'tab-new', 'tab-select', 'tab-close',
  'console', 'requests', 'request', 'request-headers', 'hover', 'mousemove', 'mousewheel', 'resize', 'dialog-dismiss', 'screenshot', 'pdf']);
const BROWSER_ACTS = new Set(['click', 'dblclick', 'fill', 'type', 'press', 'keydown', 'keyup', 'select', 'check', 'uncheck', 'drag', 'drop', 'upload',
  'dialog-accept', 'mousedown', 'mouseup']);
/** Flags that would pick another browser, profile or session: crewd picks those, never the model. */
const BROWSER_OWN = /^(-s|--(session|config|browser|profile|persistent|cdp|endpoint|extension|headed|device|mobile))(=|$)/;
const PAYMENT = /checkout|payment|billing|purchase|\/cart\b|\/pay\b|paypal\.|pay\.google/i;
/** A flag's values in an argument list, as `--flag v` or `--flag=v`. */
const valuesOf = (args: string[], flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1] ?? ''] : a.startsWith(flag + '=') ? [a.slice(flag.length + 1)] : []));

/** The browser's "asks first" rules for one command, as a reason to ask, or null to let the call through. */
export function browserAsk(command: string, url: string, signedIn: string[], filledHost?: string): { spend: boolean; host: string } | null {
  if (!BROWSER_ACTS.has(command)) return null;
  let host = '';
  // The card names the shop the way a person would: no www, no path.
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* no page yet */ }
  if (PAYMENT.test(url)) return { spend: true, host: host || 'a shop' };
  if (host && signedIn.some((d) => host === d || host.endsWith(`.${d}`))) return { spend: false, host };
  // Submitting a form the helper typed into asks wherever it is, signed in or not: it files the person's own words.
  // More typing on that same form stays free — the lines ride the submit card.
  if (host && host === filledHost && /^(click|dblclick|press)$/.test(command)) return { spend: false, host };
  return null;
}

/** "your Documents folder", never a full path. */
function folderWords(path: string) {
  const home = homedir();
  const dir = dirname(path);
  if (dir === home) return 'your home folder';
  return dir.startsWith(home + '/') ? `your ${relative(home, dir)} folder` : 'a folder outside your home';
}

const inside = (root: string, p: string) => p === root || p.startsWith(root + '/');

export function effectOf(tool: string, input: Record<string, any>, s: Seen): Effect {
  // A copy of the bot's own work into the person's folders is a write there.
  if (tool === 'crew_copy') {
    const e = effectOf('write', { path: input.to }, s);
    return e.kind === 'files' ? { ...e, words: `${s.bot} wants to put a copy of “${basename(String(input.to))}” in ${e.covers}.` } : e;
  }
  if (SAFE.has(tool)) return { kind: 'safe' };
  const base = baseName(tool);
  if (READS.has(base) || WRITES.has(base)) {
    const path = resolve(s.space, String(input.path ?? '.'));
    if (inside(s.space, path)) return { kind: 'safe' };
    if (s.secret.some((d) => inside(d, path))) return { kind: 'refuse', why: 'That folder holds sign-ins and keys; no bot may open it.' };
    // A folder to look in (ls, grep, find) is the folder itself; a file is in its parent.
    const folder = base === 'read' || WRITES.has(base) ? folderWords(path) : folderWords(path + '/x');
    const key = `files:${base === 'read' || WRITES.has(base) ? dirname(path) : path}`;
    const what = WRITES.has(base) ? `change a file in ${folder}: “${basename(path)}”` : base === 'read' ? `look at a file in ${folder}: “${basename(path)}”` : `look through ${folder}`;
    return { kind: 'files', words: `${s.bot} wants to ${what}.`, key, covers: `${folder}` };
  }
  if (tool === 'browser') {
    const [cmd = '', ...rest] = (Array.isArray(input.args) ? input.args : []).map(String);
    if ((!BROWSER_LOOKS.has(cmd) && !BROWSER_ACTS.has(cmd)) || rest.some((a) => BROWSER_OWN.test(a))) {
      return { kind: 'refuse', why: "Your browser can't do that here. Use goto, snapshot, find, click, fill, type, press, select or screenshot." };
    }
    // Web pages only: a file:// or chrome:// address would read the person's disk or the browser's own settings.
    const to = cmd === 'goto' || cmd === 'tab-new' ? rest.find((a) => !a.startsWith('-')) : undefined;
    if (to && /^[a-z][\w+.-]*:/i.test(to) && !/^(https?:|about:blank$)/i.test(to)) return { kind: 'refuse', why: 'Your browser opens web pages only (http or https).' };
    // Files it uploads or saves stay in its own space: the person's folders are reached only through the files asks.
    const files = cmd === 'upload' ? rest.filter((a) => !a.startsWith('-')) : valuesOf(rest, cmd === 'drop' ? '--path' : '--filename');
    if (files.some((f) => !inside(s.space, resolve(s.space, f)))) return { kind: 'refuse', why: 'Browser files stay in your own space: use work/ or files/.' };
    const act = browserAsk(cmd, s.page ?? '', s.signedIn ?? [], s.filledHost);
    if (!act) return { kind: 'safe' };
    // Acting as the person on a site they signed the bot in to (a claim button, a returns form) has no key, the way
    // spending has none: every press is its own card, and there is no standing answer for it. The card's own words,
    // read from the page by crewd, are added in the gate (src/crew.ts `press`).
    return act.spend ? { kind: 'spend', words: `${s.bot} wants to act on a checkout or payment page at ${act.host}.` }
      : { kind: 'send', press: true, words: `${s.bot} wants to act as you on ${act.host}, a site you signed it in to.` };
  }
  if (tool === 'calendar') {
    const [cmd = 'today', ...rest] = (Array.isArray(input.args) ? input.args : []).map(String);
    const words = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--')).map((w) => w.replace(/\s+/g, ' ').trim().slice(0, 80));
    if (['today', 'week', 'free', 'next'].includes(cmd)) return { kind: 'safe' };
    const key = `app:Google Calendar:${cmd} an event`;
    if (cmd === 'add') return { kind: 'send', words: `${s.bot} wants to add “${words[0] ?? ''}” to your Google Calendar, ${words[1] ?? ''}.`, key, covers: coversOf(key) };
    if (cmd === 'move') return { kind: 'send', words: `${s.bot} wants to move an event on your Google Calendar to ${words[1] ?? ''}.`, key, covers: coversOf(key) };
    if (cmd === 'cancel') return { kind: 'delete', words: `${s.bot} wants to cancel an event on your Google Calendar.`, key, covers: coversOf(key) };
    return { kind: 'refuse', why: 'Your calendar can: next, today, week, free, add, move or cancel.' };
  }
  // mail-axi (src/mail.ts) only reads: its token is gmail.readonly, and nothing here can send or change mail.
  if (tool === 'mail') return ['inbox', 'search', 'read'].includes(String(input.args?.[0] ?? 'inbox')) ? { kind: 'safe' } : { kind: 'refuse', why: 'Your email can: search or read (it cannot send or change mail).' };
  // The engine's skill workshop writes skills; that is the reviewer's job, not a run's. A run may read.
  if (tool === 'skill_workshop') {
    const action = String(input.action ?? '');
    if (['read', 'list', 'status'].includes(action)) return { kind: 'safe' };
    return { kind: 'refuse', why: 'Skills that write come from how you work, reviewed between jobs; keep one with crew_learn.' };
  }
  const app = s.apps?.[tool];
  if (app) {
    if (app.readOnly) return { kind: 'safe' };
    const key = `app:${app.app}:${app.title}`;
    return { kind: app.destructive ? 'delete' : 'send', words: `${s.bot} wants to use your ${app.app}: ${app.title}.`, key, covers: coversOf(key) };
  }
  const cli = s.run?.[tool];
  if (cli) {
    const args = (Array.isArray(input.args) ? input.args : []).map(String).join(' ');
    const starts = (p: string) => args === p || args.startsWith(p + ' ');
    if (cli.spend.some(starts)) {
      const cap = /max-cost:\s*\$?([\d.]+)/i.exec(args)?.[1];
      return { kind: 'spend', words: `${s.bot} wants to make a paid lookup with ${cli.name}${cap ? `, up to $${cap}` : ''}.`, ...(cap ? { cost: Number(cap) } : {}) };
    }
    if (cli.free.some(starts)) return { kind: 'safe' };
    return { kind: 'refuse', why: `That is not something a bot may do with ${cli.name}. Ask the person to do it themselves.` };
  }
  return { kind: 'refuse', why: 'Unknown tool.' };
}

// ---- a checkout page, read from the browser tool's own page snapshot (tool output, never the model's words) ----
const MONEY = /([$£€])\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)/;
const NOT_ITEM = /sub\s?-?total|\btotal\b|tax|vat|shipping|delivery|discount|saving|you save|\bfee|\btip\b|balance|gift card|coupon|promo|points/i;
const BEST_TOTAL = /order total|grand total|estimated total|total due|total to pay|amount due|total \(|pay now/i;

/** One snapshot line as a person reads it: `- listitem "Garlic" [ref=e5]: 2 kg — $3.10` → "Garlic 2 kg — $3.10". */
function readable(line: string) {
  const m = /^\s*-\s*(?:[a-z][\w-]*)?(?:\s+"((?:[^"\\]|\\.)*)")?((?:\s*\[[^\]]*\])*)\s*:?\s*(.*)$/i.exec(line);
  if (!m) return '';
  const rest = m[3].replace(/^"(.*)"$/, '$1');
  return [m[1] ?? '', rest].filter(Boolean).join(' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();
}

/** What a checkout page says it will charge: its line items as the page writes them (up to eight) and the order total.
 *  `total` is null when no total can be read. `capped` is true only when that total is in dollars — the money cap is
 *  a dollar figure, so a price in another currency is shown as what it is and never counted against it. */
export function orderOf(snapshot: string): { items: string[]; more: number; total: number | null; shown: string; currency: string; capped: boolean } {
  const lines = snapshot.split('\n').filter((l) => /^\s*-\s/.test(l)).map(readable).filter((t) => MONEY.test(t) && t.length < 200);
  const totals = lines.filter((t) => /total|amount due|pay now/i.test(t) && !/sub\s?-?total/i.test(t));
  const pick = totals.find((t) => BEST_TOTAL.test(t)) ?? totals.at(-1);
  const m = pick ? MONEY.exec(pick) : null;
  const items = [...new Set(lines.filter((t) => !NOT_ITEM.test(t)))];
  const currency = m ? m[1] : '';
  return { items: items.slice(0, 8), more: Math.max(0, items.length - 8), total: m ? Number(m[2].replace(/,/g, '')) : null, shown: m ? `${m[1]}${m[2]}` : '', currency, capped: !!m && m[1] === '$' };
}

/** What the shop's own page says the person would get back: the money on its "paid" line minus the price it shows
 *  today, both read by crewd from the page. null when the page doesn't write both — then the card says nothing about
 *  money at all (src/crew.ts `press` puts this line on the claim card). */
export function claimOf(snapshot: string): { shown: string } | null {
  const lines = snapshot.split('\n').map(readable).filter((t) => t.length > 0 && t.length < 200);
  const amount = (t: string) => { const m = MONEY.exec(t); return m ? { sign: m[1], n: Number(m[2].replace(/,/g, '')) } : null; };
  const sum = (re: RegExp) => { const t = lines.find((l) => re.test(l)); return t ? amount(t) : null; };
  const paid = sum(/\bpaid\b|you paid|bought for|price paid/i);
  const today = sum(/\btoday\b|now |current price|price now|item total/i);
  if (!paid || !today || paid.sign !== today.sign || today.n >= paid.n || today.n <= 0) return null;
  return { shown: `${paid.sign}${(paid.n - today.n).toFixed(2)}` };
}

/** What "For this task" or "Always" covers, from the gate's key, in plain words. */
export function coversOf(key: string) {
  const [kind, ...rest] = key.split(':');
  const what = rest.join(':');
  if (kind === 'app') { const [app, ...title] = rest; return `“${title.join(':')}” in your ${app}`; }
  return kind === 'files' ? folderWords(what + '/x') : 'this';
}

/** The element a browser press targets, read out of the page's own snapshot: its name as the page writes it, and the
 *  page's lines around it. crewd puts these on the card (the model's words about the button are never the preview).
 *  Returns null when the snapshot says nothing about that target — a selector, or a page crewd hasn't read. */
export function pressOf(snapshot: string, target: string): { label: string; body: string } | null {
  if (!target) return null;
  const lines = snapshot.split('\n');
  const at = lines.findIndex((l) => l.includes(`[ref=${target}]`));
  if (at < 0) return null;
  const label = (/"((?:[^"\\]|\\.)*)"/.exec(lines[at])?.[1] ?? readable(lines[at])).replace(/\\"/g, '"').trim();
  const here = lines.slice(Math.max(0, at - 3), at + 1).map(readable).filter(Boolean);
  return { label, body: [...new Set(here)].join('\n') };
}

const PROGRAMS: Record<string, string> = { ffmpeg: 'Worked on a video', ffprobe: 'Checked a video', magick: 'Worked on an image', markitdown: 'Read a document',
  'yt-dlp': 'Downloaded a video', rg: 'Searched its files', jq: 'Read some data', python3: 'Ran a small program', node: 'Ran a small program' };
const host = (u: unknown) => { try { return new URL(String(u)).hostname || 'a page'; } catch { return 'a page'; } };

/** A line for the "What I did" trail. No commands, no paths: what a person would say they saw. Empty for the crew's own tools. */
export function toolWords(tool: string, input: Record<string, any>): string {
  tool = baseName(tool);
  const file = basename(String(input.path ?? ''));
  switch (tool) {
    case 'read': return `Read ${file}`;
    case 'write': return `Saved ${file}`;
    case 'edit': return `Changed ${file}`;
    case 'ls': case 'find': case 'grep': return 'Looked through its files';
    case 'bash': return PROGRAMS[String(input.command ?? '').trim().split(/\s+/)[0]] ?? 'Worked in its own space';
    case 'web_search': return `Searched the web for “${String(input.query ?? '').slice(0, 80)}”`;
    case 'web_fetch': return `Read ${host(input.url)}`;
    case 'calendar': return ({ add: `Added “${String(input.args?.[1] ?? '').slice(0, 60)}” to the calendar`, move: 'Moved a calendar event', cancel: 'Cancelled a calendar event' } as Record<string, string>)[input.args?.[0]] ?? 'Looked at the calendar';
    case 'mail': return input.args?.[0] === 'search' ? `Searched the email for “${String(input.args[1] ?? '').slice(0, 60)}”` : input.args?.[0] === 'read' ? 'Read an email' : 'Looked at the email';
    case 'browser': return input.args?.[0] === 'goto' ? `Opened ${host(input.args[1])} in its browser` : 'Used its browser';
    case 'report': return String(input.text ?? '').trim().slice(0, 200); // the note names its own object; folds with it
  }
  return `Used ${tool.replace(/_/g, ' ')}`;
}
