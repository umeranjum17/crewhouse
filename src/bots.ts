import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Config } from './config.ts';
import { registry, toolStatus } from './tools.ts';
import { PROVIDERS } from './accounts.ts';

export const NOTES_CAP = 2500;

export interface Template {
  id: string;
  display: string;
  role: string;
  /** The AI accounts it thinks with, in fallback order: "chatgpt", "grok" or "chatgpt:<model>". */
  models?: string[];
  color: string;
  tools: string[];
  /** Skills copied from the repo's skills/ library into the new bot's own skills/ folder. */
  skills?: string[];
  /** Promises the bot makes on Home; each is shown only while every tool it needs is granted and ready. */
  ideas?: { needs: string[]; promise: string; ask: string }[];
}

/** `allow` holds the person's standing answers ("Always for Reel"), as the gate's keys. */
type BotConfig = { tools: string[]; allow?: string[]; signedIn?: string[]; models?: string[]; memory?: boolean; ideas?: Template['ideas'] };

export function botConfig(cfg: Config, id: string): BotConfig {
  const p = join(botDir(cfg, id), 'bot.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { tools: [] };
}

function patchConfig(cfg: Config, id: string, patch: Partial<BotConfig>) {
  writeFileSync(join(botDir(cfg, id), 'bot.json'), JSON.stringify({ ...botConfig(cfg, id), ...patch }, null, 2) + '\n');
}

export function setGrants(cfg: Config, id: string, tools: string[]) {
  const known = new Set(registry(cfg).map((t) => t.id));
  const bad = tools.filter((t) => !known.has(t));
  if (bad.length) throw new Error(`unknown tools: ${bad.join(', ')}`);
  patchConfig(cfg, id, { tools: [...new Set(['crew', ...tools])] });
}

/** An AI account a bot can think with, and optionally which of its models (set by Chief or a template, never shown). */
export interface Brain { provider: string; model?: string }

export function parseBrain(s: string): Brain {
  const [provider, model, extra] = String(s).trim().split(':');
  if (!PROVIDERS[provider] || extra !== undefined || (model !== undefined && !/^[A-Za-z0-9][\w.\-\/\[\]]{0,63}$/.test(model))) {
    throw Object.assign(new Error(`not an AI account: "${s}" (try ${Object.keys(PROVIDERS).slice(0, 3).join(', ')})`), { status: 400 });
  }
  return model ? { provider, model } : { provider };
}
export const brainKey = (b: Brain) => b.model ? `${b.provider}:${b.model}` : b.provider;
/** "ChatGPT", "Grok": the account's name only, never a model id. */
export const brainName = (b: Brain) => PROVIDERS[b.provider]?.name ?? b.provider;

/** The bot's accounts in fallback order. Without a list: ChatGPT. */
export function brains(cfg: Config, id: string): Brain[] {
  const c = botConfig(cfg, id);
  return dedupe((c.models?.length ? c.models : ['chatgpt']).map(parseBrain));
}

export function dedupe(list: Brain[]) {
  const seen = new Set<string>();
  return list.filter((b) => !seen.has(brainKey(b)) && !!seen.add(brainKey(b)));
}

export function setBrains(cfg: Config, id: string, models: string[]) {
  if (!Array.isArray(models) || !models.length) throw Object.assign(new Error('pick at least one model'), { status: 400 });
  const list = dedupe(models.map(parseBrain)).map(brainKey);
  const p = join(botDir(cfg, id), 'bot.json');
  writeFileSync(p, JSON.stringify({ ...botConfig(cfg, id), models: list }, null, 2) + '\n');
  return list;
}
/** The person's standing answers for a bot ("Always for Reel") and its memory switch. */
export function setSettings(cfg: Config, id: string, s: { allow?: unknown; memory?: unknown }) {
  if (s.allow !== undefined && !(Array.isArray(s.allow) && s.allow.every((a) => typeof a === 'string'))) throw new Error('allow must be a list');
  if (s.memory !== undefined && typeof s.memory !== 'boolean') throw new Error('memory is on or off');
  patchConfig(cfg, id, { ...(s.allow ? { allow: [...new Set(s.allow as string[])] } : {}), ...(s.memory !== undefined ? { memory: s.memory } : {}) });
}

/** A bot's tools, each with whether it is granted and ready here: plain words only, no commands or paths. */
export function botTools(cfg: Config, id: string) {
  const grants = new Set(botConfig(cfg, id).tools ?? []);
  return toolStatus(cfg).map((t) => ({ id: t.id, name: t.name, provides: t.provides, license: t.license, asks: t.asks, ready: t.ready,
    installable: t.installable, outdated: t.outdated, note: t.note, granted: grants.has(t.id) }));
}

/** A template's tools in plain words, for the recruit card. */
export function templateKit(cfg: Config, tpl: Template) {
  const all = new Map(toolStatus(cfg).map((t) => [t.id, t]));
  return tpl.tools.filter((id) => id !== 'crew' && all.has(id)).map((id) => {
    const t = all.get(id)!;
    return { id, name: t.name, asks: t.asks, ready: t.ready };
  });
}

/** Granted and working on this machine. */
export const canUse = (cfg: Config, id: string, tool: string) => botTools(cfg, id).some((t) => t.id === tool && t.granted && t.ready);

export const templatesDir = (cfg: Config) => join(cfg.repoDir, 'templates');
export const botDir = (cfg: Config, id: string) => join(cfg.crewDir, 'bots', id);

export function listTemplates(cfg: Config): Template[] {
  return readdirSync(templatesDir(cfg))
    .filter((t) => t !== 'chief' && existsSync(join(templatesDir(cfg), t, 'bot.json')))
    .map((t) => loadTemplate(cfg, t));
}

export function loadTemplate(cfg: Config, id: string): Template {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`bad template ${id}`);
  const file = join(templatesDir(cfg), id, 'bot.json');
  if (!existsSync(file)) throw new Error(`no template named ${id}`);
  return { id, ...JSON.parse(readFileSync(file, 'utf8')) };
}

/** Stable id from a display name; ids authorize, names are display only. */
export function slug(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'bot';
}

/** Copy a template into bots/<id>/ and rename the persona. The folder is the bot; SQLite only indexes it. */
export function createBotFolder(cfg: Config, id: string, tpl: Template, display: string) {
  const dir = botDir(cfg, id);
  if (existsSync(dir)) throw new Error(`a bot folder already exists at ${dir}`);
  mkdirSync(dir, { recursive: true });
  cpSync(join(templatesDir(cfg), tpl.id), dir, { recursive: true });
  if (display !== tpl.display) {
    const p = join(dir, 'AGENTS.md');
    writeFileSync(p, readFileSync(p, 'utf8').replaceAll(`# ${tpl.display}`, `# ${display}`).replaceAll(`You are ${tpl.display}`, `You are ${display}`));
  }
  for (const d of ['files', 'work', 'skills']) mkdirSync(join(dir, d), { recursive: true });
  // Copies, not links: the bot owns its skills and may refine them.
  for (const sk of tpl.skills ?? []) cpSync(join(cfg.repoDir, 'skills', sk), join(dir, 'skills', sk), { recursive: true });
  writeFileSync(join(dir, 'notes.md'), '');
  commitNotes(cfg, id, 'Joined the crew');
  writeFileSync(join(dir, '.gitignore'), 'work/\nbrowser/\n');
  return dir;
}

export function readNotes(cfg: Config, id: string) {
  const p = join(botDir(cfg, id), 'notes.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

/** The bot's folder is its own git repository and every memory change is a commit. Without git there is simply no history. */
function commitNotes(cfg: Config, id: string, message: string): string | null {
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Crewhouse', '-c', 'user.email=crewhouse@localhost', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null', ...args], { cwd: botDir(cfg, id), stdio: 'pipe' }).toString().trim();
  try {
    if (!existsSync(join(botDir(cfg, id), '.git'))) git('init', '-q');
    git('add', 'notes.md');
    git('commit', '-q', '-m', message.slice(0, 200), '--', 'notes.md');
    return git('rev-parse', '--short', 'HEAD');
  } catch { return null; }
}

function saveNotes(cfg: Config, id: string, lines: string[], message: string) {
  const text = lines.join('\n').replace(/\n*$/, '\n').replace(/^\n$/, '');
  if (text.length > NOTES_CAP) throw new Error(`notes are full (${text.length}/${NOTES_CAP}); rewrite notes.md shorter first, or use --replaces`);
  writeFileSync(join(botDir(cfg, id), 'notes.md'), text);
  return commitNotes(cfg, id, message);
}

const noteLines = (cfg: Config, id: string) => { const t = readNotes(cfg, id).replace(/\n$/, ''); return t ? t.split('\n') : []; };

/** A memory change, enough to undo it: the line added and the one it replaced. */
export interface Learned { added: string; removed: string | null; commit: string | null }

/** Capped memory: rewrite, don't append. `replaces` names words of the old note a correction replaces. Over the cap is refused, so the bot must consolidate. */
export function remember(cfg: Config, id: string, line: string, replaces = ''): Learned {
  const clean = line.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('nothing to remember');
  if (botConfig(cfg, id).memory === false) throw new Error('memory is off for this bot; the person turned it off');
  const lines = noteLines(cfg, id);
  const old = replaces.trim() ? lines.findIndex((l) => l.includes(replaces.trim())) : -1;
  if (replaces.trim() && old < 0) throw new Error(`no note mentions "${replaces.trim()}"; read notes.md`);
  const added = `- ${clean}`;
  const removed = old >= 0 ? lines[old] : null;
  if (old >= 0) lines[old] = added; else lines.push(added);
  return { added, removed, commit: saveNotes(cfg, id, lines, `Learned: ${clean}`) };
}

/** Undo one memory change: take the added line out and put back the one it replaced. Also a commit. */
export function forget(cfg: Config, id: string, change: Learned) {
  const lines = noteLines(cfg, id);
  const i = lines.indexOf(change.added);
  if (i < 0 && !change.removed) throw new Error('that note is no longer in notes.md');
  if (i >= 0 && change.removed) lines[i] = change.removed;
  else if (i >= 0) lines.splice(i, 1);
  else lines.push(change.removed!);
  return saveNotes(cfg, id, lines, `Undo: ${change.added.slice(2)}`);
}

export function writeNotes(cfg: Config, id: string, text: string) {
  if (text.length > NOTES_CAP) throw new Error(`notes are over the ${NOTES_CAP} character cap`);
  writeFileSync(join(botDir(cfg, id), 'notes.md'), text);
  commitNotes(cfg, id, 'Edited by the person');
}

export function listSkills(cfg: Config, id: string) {
  const dir = join(botDir(cfg, id), 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((s) => existsSync(join(dir, s, 'SKILL.md'))).map((s) => {
    const text = readFileSync(join(dir, s, 'SKILL.md'), 'utf8');
    return { name: s, description: /^description:\s*(.+)$/m.exec(text)?.[1] ?? '' };
  });
}

export function listFiles(cfg: Config, id: string) {
  const root = join(botDir(cfg, id), 'files');
  const out: { path: string; size: number; mtime: number }[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p); else out.push({ path: relative(root, p), size: st.size, mtime: st.mtimeMs });
    }
  };
  walk(root);
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 200);
}

/** Resolve a path inside a bot folder, refusing anything that escapes it. */
export function insideBot(cfg: Config, id: string, p: string) {
  const dir = botDir(cfg, id);
  const full = resolve(dir, p);
  if (full !== dir && !full.startsWith(dir + '/')) throw new Error('path is outside the bot folder');
  return full;
}

/** How every model turn is told to address the person. A chosen name must not drift back to "sir". */
export function addressLine(address: string | null) {
  if (!address) return 'You do not yet know how to address the person; use no honorific.';
  return /^(sir|ma'?am)$/i.test(address)
    ? `Address the person as "${address.toLowerCase()}".`
    : `Address the person by their chosen name, "${address}", never as "sir" or "ma'am".`;
}

/** What the engine is told about the bot for a whole session: its persona, then how Crewhouse works. */
export function systemPrompt(cfg: Config, id: string, chief: boolean) {
  const dir = botDir(cfg, id);
  const persona = existsSync(join(dir, 'AGENTS.md')) ? readFileSync(join(dir, 'AGENTS.md'), 'utf8').trim() : '';
  return `${persona}\n\n## Crewhouse\nYour id in Crewhouse is ${id}. Your working folder is your own space: work in \`work/\`, put finished things in \`files/\`, ` +
    'and use relative paths. Anything you do there needs nobody\'s leave; sending, paying, deleting or opening the person\'s own files stops for their answer, ' +
    'which the app asks for you. If a tool call is refused, adapt and carry on, or say plainly what you need.\n' +
    `Your crew tools: crew_report (a one-line progress note), crew_deliver (register a finished file), crew_remember (a lasting preference of the person)${chief ? ', and for running the crew: crew_roster, crew_recruit, crew_assign, crew_routine, crew_routines, crew_status and crew_call_me' : ''}.`;
}
