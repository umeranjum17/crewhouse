// What a bot may do without asking. Safe work in its own space runs silently; sending, spending, deleting and touching the
// person's own files stop for one plain sentence first. Decided here from the tool and its input, never by the model's words.
import { homedir } from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';

export type Effect =
  | { kind: 'safe' }
  | { kind: 'refuse'; why: string }
  /** `key` is what "For this task" and "Always" remember; spending has none, so it asks every time. */
  | { kind: 'files' | 'send' | 'spend' | 'delete'; words: string; key?: string; covers?: string };

export interface Seen {
  bot: string;
  space: string;
  /** The page the bot's browser is on, from its own tool results. */
  page?: string;
  /** Sites the person signed the bot in to (its browser acts there as them). */
  signedIn?: string[];
  /** Command-line tools that run with the person's own sign-in: argument prefixes that are free, and those that spend. */
  run?: Record<string, { name: string; free: string[]; spend: string[] }>;
  /** Folders no bot may open at all: sign-ins and keys, the engine's own and every other program's. */
  secret: string[];
  /** Tools from the person's connected apps, with what each does to the world. */
  apps?: Record<string, { app: string; title: string; readOnly: boolean; destructive: boolean }>;
}

const READS = new Set(['read', 'ls', 'grep', 'find']);
const WRITES = new Set(['write', 'edit']);
/** Always safe: they only touch the bot's own space, the web, or Crewhouse itself. bash runs in the sandbox. */
const SAFE = /^(bash|web_search|web_fetch|crew_\w+)$/;
const BROWSER_ACTS = /^browser_(click|type|fill_form|press_key|select_option|file_upload|drag|hover|evaluate|run_code|handle_dialog)$/;
const PAYMENT = /checkout|payment|billing|purchase|\/cart\b|\/pay\b|paypal\.|pay\.google/i;

/** The browser's "asks first" rules, as a reason to ask, or null to let the call through. */
export function browserAsk(tool: string, url: string, signedIn: string[]): { spend: boolean; host: string } | null {
  if (!BROWSER_ACTS.test(tool)) return null;
  let host = '';
  try { host = new URL(url).hostname; } catch { /* no page yet */ }
  if (PAYMENT.test(url)) return { spend: true, host: host || 'a shop' };
  if (host && signedIn.some((d) => host === d || host.endsWith(`.${d}`))) return { spend: false, host };
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
  if (SAFE.test(tool)) return { kind: 'safe' };
  if (READS.has(tool) || WRITES.has(tool)) {
    const path = resolve(s.space, String(input.path ?? '.'));
    if (inside(s.space, path)) return { kind: 'safe' };
    if (s.secret.some((d) => inside(d, path))) return { kind: 'refuse', why: 'That folder holds sign-ins and keys; no bot may open it.' };
    // A folder to look in (ls, grep, find) is the folder itself; a file is in its parent.
    const folder = tool === 'read' || WRITES.has(tool) ? folderWords(path) : folderWords(path + '/x');
    const key = `files:${tool === 'read' || WRITES.has(tool) ? dirname(path) : path}`;
    const what = WRITES.has(tool) ? `change a file in ${folder}: “${basename(path)}”` : tool === 'read' ? `look at a file in ${folder}: “${basename(path)}”` : `look through ${folder}`;
    return { kind: 'files', words: `${s.bot} wants to ${what}.`, key, covers: `${folder}` };
  }
  if (tool.startsWith('browser_')) {
    const act = browserAsk(tool, s.page ?? '', s.signedIn ?? []);
    if (!act) return { kind: 'safe' };
    return act.spend ? { kind: 'spend', words: `${s.bot} wants to act on a checkout or payment page at ${act.host}.` }
      : { kind: 'send', words: `${s.bot} wants to act as you on ${act.host}, a site you signed it in to.`, key: `send:${act.host}`, covers: `acting as you on ${act.host}` };
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
      return { kind: 'spend', words: `${s.bot} wants to make a paid lookup with ${cli.name}${cap ? `, up to $${cap}` : ''}.` };
    }
    if (cli.free.some(starts)) return { kind: 'safe' };
    return { kind: 'refuse', why: `That is not something a bot may do with ${cli.name}. Ask the person to do it themselves.` };
  }
  return { kind: 'refuse', why: 'Unknown tool.' };
}

/** What "For this task" or "Always" covers, from the gate's key, in plain words. */
export function coversOf(key: string) {
  const [kind, ...rest] = key.split(':');
  const what = rest.join(':');
  if (kind === 'app') { const [app, ...title] = rest; return `“${title.join(':')}” in your ${app}`; }
  return kind === 'files' ? folderWords(what + '/x') : kind === 'send' ? `acting as you on ${what}` : 'this';
}

const PROGRAMS: Record<string, string> = { ffmpeg: 'Worked on a video', ffprobe: 'Checked a video', magick: 'Worked on an image', markitdown: 'Read a document',
  'yt-dlp': 'Downloaded a video', rg: 'Searched its files', jq: 'Read some data', python3: 'Ran a small program', node: 'Ran a small program' };
const host = (u: unknown) => { try { return new URL(String(u)).hostname; } catch { return 'a page'; } };

/** A line for the "What I did" trail. No commands, no paths: what a person would say they saw. Empty for the crew's own tools. */
export function toolWords(tool: string, input: Record<string, any>): string {
  const file = basename(String(input.path ?? ''));
  switch (tool) {
    case 'read': return `Read ${file}`;
    case 'write': return `Saved ${file}`;
    case 'edit': return `Changed ${file}`;
    case 'ls': case 'find': case 'grep': return 'Looked through its files';
    case 'bash': return PROGRAMS[String(input.command ?? '').trim().split(/\s+/)[0]] ?? 'Worked in its own space';
    case 'web_search': return `Searched the web for “${String(input.query ?? '').slice(0, 80)}”`;
    case 'web_fetch': return `Read ${host(input.url)}`;
    case 'browser_navigate': return `Opened ${host(input.url)} in its browser`;
  }
  if (tool.startsWith('crew_')) return '';
  if (tool.startsWith('browser_')) return 'Used its browser';
  return `Used ${tool.replace(/_/g, ' ')}`;
}
