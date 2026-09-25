import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Config } from './config.ts';
import { registry, toolStatus } from './tools.ts';
import { PROVIDERS } from './accounts.ts';

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

/** "Frames" for "Reel": a template's own name swapped for the bot's, in its soul and its job. */
const renamed = (text: string, from: string, to: string) => from === to ? text : text.replaceAll(`# ${from}`, `# ${to}`).replaceAll(`You are ${from}`, `You are ${to}`);

/** Copy a template into bots/<id>/ and rename the persona. The folder is the bot; SQLite only indexes it. */
export function createBotFolder(cfg: Config, id: string, tpl: Template, display: string) {
  const dir = botDir(cfg, id);
  if (existsSync(dir)) throw new Error(`a bot folder already exists at ${dir}`);
  mkdirSync(dir, { recursive: true });
  cpSync(join(templatesDir(cfg), tpl.id), dir, { recursive: true });
  for (const f of ['AGENTS.md', 'soul.md']) {
    const p = join(dir, f);
    if (existsSync(p)) writeFileSync(p, renamed(readFileSync(p, 'utf8'), tpl.display, display));
  }
  for (const d of ['files', 'work', 'skills']) mkdirSync(join(dir, d), { recursive: true });
  // Copies, not links: the bot owns its skills and may refine them.
  for (const sk of tpl.skills ?? []) cpSync(join(cfg.repoDir, 'skills', sk), join(dir, 'skills', sk), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'work/\nbrowser/\n');
  commit(dir, ['soul.md', 'AGENTS.md'], 'Joined the crew');
  return dir;
}

/** A folder that is its own git repository, where every change to the files that matter is a commit. Without git there is simply no history. */
function commit(dir: string, files: string[], message: string): string | null {
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Crewhouse', '-c', 'user.email=crewhouse@localhost', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
  try {
    if (!existsSync(join(dir, '.git'))) git('init', '-q');
    const present = files.filter((f) => existsSync(join(dir, f)));
    if (present.length) git('add', '--', ...present);
    git('commit', '-q', '-m', message.slice(0, 200), '--', ...files.filter((f) => present.includes(f) || git('ls-files', '--', f)));
    return git('rev-parse', '--short', 'HEAD');
  } catch { return null; }
}

// ---- the soul: who the bot is, in its own file, written by the person, never by the bot ----
export const SOUL_CAP = 2000;

export function readSoul(cfg: Config, id: string) {
  const p = join(botDir(cfg, id), 'soul.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

export function writeSoul(cfg: Config, id: string, text: string, message = 'Personality changed by the person') {
  const clean = String(text).replace(/\r/g, '').trim();
  if (!clean) throw Object.assign(new Error('say a few words about how it should come across'), { status: 400 });
  if (clean.length > SOUL_CAP) throw Object.assign(new Error(`that is longer than ${SOUL_CAP} characters; say it shorter`), { status: 400 });
  writeFileSync(join(botDir(cfg, id), 'soul.md'), clean + '\n');
  return commit(botDir(cfg, id), ['soul.md'], message);
}

/** The template's soul under the bot's own name: "Put back how Scout started". */
export function templateSoul(cfg: Config, tpl: Template, display: string) {
  const p = join(templatesDir(cfg), tpl.id, 'soul.md');
  return existsSync(p) ? renamed(readFileSync(p, 'utf8'), tpl.display, display) : '';
}

// ---- memory: everything the crew knows about a person lives in that person's own folder ----
// people/<member>/about.md is what every helper knows about them; people/<member>/notes/<bot>.md is what one helper
// learned doing its work for them. Other members' notes are never in a bot's folder, prompt or screens.
export const NOTES_CAP = 2500;
export const ABOUT_CAP = 1500;

/** Whose memory, and which: one helper's notes (`bot`), or what the whole crew knows about them (`bot` null). */
export interface Memory { member: number; bot: string | null }

export const personDir = (cfg: Config, member: number) => join(cfg.crewDir, 'people', String(member));
const memoryFile = (m: Memory) => m.bot ? `notes/${m.bot}.md` : 'about.md';
const capOf = (m: Memory) => m.bot ? NOTES_CAP : ABOUT_CAP;

export function readNotes(cfg: Config, m: Memory) {
  const p = join(personDir(cfg, m.member), memoryFile(m));
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

function saveNotes(cfg: Config, m: Memory, text: string, message: string) {
  if (text.length > capOf(m)) throw new Error(`notes are full (${text.length}/${capOf(m)}); fold two notes into one with \`replaces\` first`);
  const p = join(personDir(cfg, m.member), memoryFile(m));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return commit(personDir(cfg, m.member), [memoryFile(m)], message);
}

const noteLines = (cfg: Config, m: Memory) => { const t = readNotes(cfg, m).replace(/\n$/, ''); return t ? t.split('\n') : []; };
const joinLines = (lines: string[]) => lines.join('\n').replace(/\n*$/, '\n').replace(/^\n$/, '');

/** A memory change, enough to undo it: the line added and the one it replaced. */
export interface Learned { added: string; removed: string | null; commit: string | null }

/** Remembered lines go into every later prompt, so they stay plain words about the person: a web page a bot read can't plant a link or a command in them. */
const RISKY = /https?:|www\.|[\w.+-]+@[\w-]+\.[a-z]|(^|\s)~?\/[\w.-]*\/|`|\$\(|&&/i;

/** Capped memory: rewrite, don't append. `replaces` names words of the old note a correction replaces. Over the cap is refused, so the bot must consolidate. */
export function remember(cfg: Config, m: Memory, line: string, replaces = ''): Learned {
  const clean = line.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('nothing to remember');
  if (RISKY.test(clean)) throw new Error('notes are plain words about the person: no links, email addresses, file locations or commands');
  const lines = noteLines(cfg, m);
  const old = replaces.trim() ? lines.findIndex((l) => l.includes(replaces.trim())) : -1;
  if (replaces.trim() && old < 0) throw new Error(`no note mentions "${replaces.trim()}"; your notes are in your prompt`);
  const added = `- ${clean}`;
  const removed = old >= 0 ? lines[old] : null;
  if (old >= 0) lines[old] = added; else lines.push(added);
  return { added, removed, commit: saveNotes(cfg, m, joinLines(lines), `Learned: ${clean}`) };
}

/** Undo one memory change: take the added line out and put back the one it replaced. Also a commit. */
export function forget(cfg: Config, m: Memory, change: Learned) {
  const lines = noteLines(cfg, m);
  const i = lines.indexOf(change.added);
  if (i < 0 && !change.removed) throw new Error('that note is no longer there');
  if (i >= 0 && change.removed) lines[i] = change.removed;
  else if (i >= 0) lines.splice(i, 1);
  else lines.push(change.removed!);
  return saveNotes(cfg, m, joinLines(lines), `Undo: ${change.added.slice(2)}`);
}

export function writeNotes(cfg: Config, m: Memory, text: string) {
  if (text.length > capOf(m)) throw new Error(`notes are over the ${capOf(m)} character cap`);
  saveNotes(cfg, m, text, 'Edited by the person');
}

/** Before notes were each person's, a bot kept one notes.md for the whole house. It becomes the owner's, history kept in both folders;
 *  a soul still written into the job file moves into its own file. Runs at every start; a no-op once done. */
export function upgradeFolder(cfg: Config, id: string, tpl: Template | null, display: string, owner: number) {
  const dir = botDir(cfg, id);
  const old = join(dir, 'notes.md');
  if (existsSync(old)) {
    const text = readFileSync(old, 'utf8');
    const m = { member: owner, bot: id };
    if (text.trim() && !readNotes(cfg, m).trim()) saveNotes(cfg, m, text.slice(0, NOTES_CAP), `Kept from ${display}'s notes`);
    rmSync(old);
    commit(dir, ['notes.md'], 'Notes now live in each person\'s own folder');
  }
  if (tpl && !existsSync(join(dir, 'soul.md')) && templateSoul(cfg, tpl, display)) {
    writeFileSync(join(dir, 'soul.md'), templateSoul(cfg, tpl, display));
    const job = join(dir, 'AGENTS.md');
    // Chief's voice used to be a section of his job; it is his soul now, so it is said once.
    if (existsSync(job)) writeFileSync(job, readFileSync(job, 'utf8').replace(/\n## Voice\n[\s\S]*?(?=\n## |$)/, ''));
    commit(dir, ['soul.md', 'AGENTS.md'], 'A soul of its own');
  }
}

/** A frontmatter value: plain, or quoted as a learned skill writes it. */
const field = (text: string, key: string) => {
  const v = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(text)?.[1] ?? '';
  try { return v.startsWith('"') ? String(JSON.parse(v)) : v; } catch { return v; }
};

export function listSkills(cfg: Config, id: string) {
  const dir = join(botDir(cfg, id), 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((s) => existsSync(join(dir, s, 'SKILL.md'))).map((s) => {
    const text = readFileSync(join(dir, s, 'SKILL.md'), 'utf8');
    // `says` is the skill in the person's words, for the app; `description` is for the model.
    return { name: s, description: field(text, 'description'), says: field(text, 'says'), learned: field(text, 'learned') === 'yes' };
  });
}

// ---- skills a bot learns: it proposes one, and it is written only after the person says yes ----
export const SKILL_CAP = 4000;
export interface SkillDraft { slug: string; says: string; steps: string; text: string }

export function draftSkill(cfg: Config, id: string, p: { name?: unknown; description?: unknown; says?: unknown; steps?: unknown }): SkillDraft {
  const one = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const name = slug(one(p.name)), description = one(p.description), says = one(p.says);
  const steps = String(p.steps ?? '').replace(/\r/g, '').trim();
  if (!one(p.name) || !description || !says || !steps) throw new Error('a skill needs a name, a description, what it does in the person\'s words (`says`) and its steps');
  // A skill is kept instructions, like a note: a page the bot read must not be able to plant an address in it.
  if (/https?:|www\.|[\w.+-]+@[\w-]+\.[a-z]/i.test(`${description} ${says} ${steps}`)) throw new Error('a skill has no links or email addresses in it; describe the steps in plain words');
  const have = join(botDir(cfg, id), 'skills', name, 'SKILL.md');
  if (existsSync(have) && field(readFileSync(have, 'utf8'), 'learned') !== 'yes') throw new Error(`you already have a skill called ${name}; choose another name`);
  // Quoted, so a colon in the model's words can't break the header.
  const text = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\nsays: ${JSON.stringify(says)}\nlearned: yes\n---\n\n${steps}\n`;
  if (text.length > SKILL_CAP) throw new Error(`that skill is over ${SKILL_CAP} characters; keep the steps short`);
  return { slug: name, says, steps, text };
}

export function saveSkill(cfg: Config, id: string, d: SkillDraft) {
  const dir = join(botDir(cfg, id), 'skills', d.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), d.text);
  return commit(botDir(cfg, id), [`skills/${d.slug}/SKILL.md`], `Learned how to: ${d.says}`);
}

/** "Remove" puts a learned skill away in skills/.archive (the engine skips dot folders), never deletes it. Bundled skills stay. */
export function archiveSkill(cfg: Config, id: string, name: string) {
  const skill = listSkills(cfg, id).find((k) => k.name === name);
  if (!skill) throw Object.assign(new Error('no such skill'), { status: 404 });
  if (!skill.learned) throw Object.assign(new Error('only a skill it learned can be removed'), { status: 400 });
  const dir = join(botDir(cfg, id), 'skills');
  mkdirSync(join(dir, '.archive'), { recursive: true });
  renameSync(join(dir, name), join(dir, '.archive', `${name}-${Date.now()}`));
  commit(botDir(cfg, id), [`skills/${name}/SKILL.md`], `Put away: ${skill.says || name}`);
  return skill;
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

/** What the engine is told about the bot for a whole session: who it is (its soul), its job, then how Crewhouse works. */
export function systemPrompt(cfg: Config, id: string, chief: boolean) {
  const dir = botDir(cfg, id);
  const persona = ['soul.md', 'AGENTS.md'].map((f) => existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim() : '').filter(Boolean).join('\n\n');
  return `${persona}\n\n## Crewhouse\nYour id in Crewhouse is ${id}. Your working folder is your own space: work in \`work/\`, put finished things in \`files/\`, ` +
    'and use relative paths. Anything you do there needs nobody\'s leave; sending, paying, deleting or opening the person\'s own files stops for their answer, ' +
    'which the app asks for you. If a tool call is refused, adapt and carry on, or say plainly what you need.\n' +
    `The person's own folders are in ${homedir()} (Documents, Pictures, Downloads…). Your shell can't see them; reach them with read and write, ` +
    'or crew_copy to put a copy of something you made there. Crewhouse asks the person first, so just go ahead and call the tool.\n' +
    'Talk to the person in plain words: call what you made by what it is ("the birthday video"), never by a file path, a command or code.\n' +
    `Your crew tools: crew_report (a one-line progress note), crew_deliver (register a finished file), crew_copy (a copy into the person's folders), crew_remember (a lasting preference of the person), crew_learn (ask to keep a way of doing a job you will need again)${chief ? ', and for running the crew: crew_roster, crew_recruit, crew_assign, crew_routine, crew_routines, crew_status, crew_suggest and crew_call_me' : ''}.`;
}
