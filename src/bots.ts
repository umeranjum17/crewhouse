import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Config } from './config.ts';
import type { LaunchSpec } from './runner.ts';
import { registry, resolveGrants, toolBin, toolStatus } from './tools.ts';

export const NOTES_CAP = 2500;

export interface Template {
  id: string;
  display: string;
  role: string;
  runtime: string;
  model?: string;
  color: string;
  tools: string[];
  allow?: string[];
  /** Skills copied from the repo's skills/ library into the new bot's own skills/ folder. */
  skills?: string[];
}

export function botConfig(cfg: Config, id: string): { tools: string[]; allow?: string[]; signedIn?: string[]; runtime?: string; model?: string; models?: string[] } {
  const p = join(botDir(cfg, id), 'bot.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { tools: [] };
}

export function setGrants(cfg: Config, id: string, tools: string[]) {
  const known = new Set(registry(cfg).map((t) => t.id));
  const bad = tools.filter((t) => !known.has(t));
  if (bad.length) throw new Error(`unknown tools: ${bad.join(', ')}`);
  const p = join(botDir(cfg, id), 'bot.json');
  writeFileSync(p, JSON.stringify({ ...botConfig(cfg, id), tools: [...new Set(['crew', ...tools])] }, null, 2) + '\n');
}

/** A CLI and model a bot can think with, written "claude:opus" or just "codex" for the CLI's own default. */
export interface Brain { runtime: string; model?: string }
export const RUNTIMES: Record<string, string> = { claude: 'Claude', codex: 'ChatGPT' };

export function parseBrain(s: string): Brain {
  const [runtime, model, extra] = String(s).trim().split(':');
  if (!RUNTIMES[runtime] || extra !== undefined || (model !== undefined && !/^[A-Za-z0-9][\w.\-\[\]]{0,63}$/.test(model))) {
    throw Object.assign(new Error(`not a model choice: "${s}" (try claude:opus or codex:gpt-5.5)`), { status: 400 });
  }
  return model ? { runtime, model } : { runtime };
}
export const brainKey = (b: Brain) => b.model ? `${b.runtime}:${b.model}` : b.runtime;
/** "Claude Opus", "ChatGPT gpt-5.5", "ChatGPT". */
export const brainName = (b: Brain) => `${RUNTIMES[b.runtime] ?? b.runtime}${!b.model ? '' : /^[a-z]+$/.test(b.model) ? ' ' + b.model[0].toUpperCase() + b.model.slice(1) : ' ' + b.model}`;

/** The bot's models in fallback order. Without a list: the template's own, then ChatGPT (plan 3, 3.10). */
export function brains(cfg: Config, id: string): Brain[] {
  const c = botConfig(cfg, id);
  const list = c.models?.length ? c.models : [[c.runtime ?? cfg.runtime, c.model].filter(Boolean).join(':'), 'codex'];
  return dedupe(list.map(parseBrain));
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

/** A bot's granted tools, each with whether it is ready here. */
export function botTools(cfg: Config, id: string) {
  const grants = new Set(botConfig(cfg, id).tools ?? []);
  return toolStatus(cfg).map((t) => ({ id: t.id, name: t.name, provides: t.provides, license: t.license, asks: t.asks, ready: t.ready, missing: t.missing,
    howto: t.howto, installable: t.installable, outdated: t.outdated, source: t.source, note: t.note, granted: grants.has(t.id) }));
}

/** A template's tools in plain words, for the recruit card. */
export function templateKit(cfg: Config, tpl: Template) {
  const all = new Map(toolStatus(cfg).map((t) => [t.id, t]));
  return tpl.tools.filter((id) => id !== 'crew' && all.has(id)).map((id) => {
    const t = all.get(id)!;
    return { id, name: t.name, asks: t.asks, ready: t.ready };
  });
}

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
  for (const d of ['files', 'work', 'skills', '.claude', '.agents', '.crewhouse']) mkdirSync(join(dir, d), { recursive: true });
  // Copies, not links: the bot owns its skills and may refine them.
  for (const sk of tpl.skills ?? []) cpSync(join(cfg.repoDir, 'skills', sk), join(dir, 'skills', sk), { recursive: true });
  writeFileSync(join(dir, 'notes.md'), '');
  // Claude reads CLAUDE.md, Codex and others read AGENTS.md. Imports load memory deterministically at start.
  writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\n@notes.md\n@.crewhouse/person.md\n');
  // One skills folder, seen by each CLI in its own project location (agentskills SKILL.md format).
  symlinkSync('../skills', join(dir, '.claude', 'skills'));
  symlinkSync('../skills', join(dir, '.agents', 'skills'));
  writeFileSync(join(dir, '.gitignore'), 'work/\nbrowser/\n.crewhouse/\n.claude/settings.local.json\n');
  return dir;
}

export function readNotes(cfg: Config, id: string) {
  const p = join(botDir(cfg, id), 'notes.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

/** Capped memory: a write that would overflow is refused, so the bot must consolidate. */
export function remember(cfg: Config, id: string, line: string) {
  const clean = line.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('nothing to remember');
  const notes = readNotes(cfg, id);
  const next = `${notes}${notes && !notes.endsWith('\n') ? '\n' : ''}- ${clean}\n`;
  if (next.length > NOTES_CAP) throw new Error(`notes are full (${notes.length}/${NOTES_CAP}); rewrite notes.md shorter first`);
  writeFileSync(join(botDir(cfg, id), 'notes.md'), next);
  return next;
}

export function writeNotes(cfg: Config, id: string, text: string) {
  if (text.length > NOTES_CAP) throw new Error(`notes are over the ${NOTES_CAP} character cap`);
  writeFileSync(join(botDir(cfg, id), 'notes.md'), text);
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

/** Per-person facts every run sees; how to address them is the one that matters most. */
export function writePerson(cfg: Config, id: string, address: string | null) {
  const text = address ? `# The person you serve\n${addressLine(address)}\n` : '';
  writeFileSync(join(botDir(cfg, id), '.crewhouse', 'person.md'), text);
}

const CREDENTIAL_DENY = ['~/.claude/**', '~/.claude.json', '~/.codex/**', '~/.pi/**', '~/.ssh/**', '~/.config/gh/**', '~/.aws/**', '~/.treg/**'];

/** Everything needed to launch the bot's real CLI. Claude gets its hooks and policy via settings.local.json. */
export function launchSpec(cfg: Config, bot: { id: string; display: string; runtime: string; model?: string; token: string }, url: string): LaunchSpec {
  const dir = botDir(cfg, bot.id);
  const conf = botConfig(cfg, bot.id);
  // Grants become the CLI's own allow list and MCP servers; a granted tool that is missing here simply is not offered.
  const g = resolveGrants(cfg, conf.tools ?? [], { 'bot.dir': dir, 'bot.id': bot.id });
  const allow = [...g.allow, ...(conf.allow ?? [])];
  const env = {
    ...g.env,
    CREWHOUSE_URL: url,
    CREWHOUSE_TOKEN: bot.token,
    PATH: `${join(cfg.repoDir, 'bin')}:${toolBin(cfg)}:${process.env.PATH}`,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  };
  if (bot.runtime === 'codex') {
    return {
      bot: bot.id, kind: 'codex', cwd: dir, label: bot.display, env,
      // No update prompt: it blocks an unattended start, and its default answer installs globally.
      args: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request', '-c', 'notify=["crew","hook","codex"]', '-c', 'check_for_update_on_startup=false',
        ...(g.tools.includes('web') ? ['--search'] : []),
        ...Object.entries(g.mcp).flatMap(([id, m]) => ['-c', `mcp_servers.${id}.command=${JSON.stringify(m.command)}`, '-c', `mcp_servers.${id}.args=${JSON.stringify(m.args)}`,
          '-c', `mcp_servers.${id}.env={${Object.entries(m.env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',')}}`]),
        ...(bot.model ? ['--model', bot.model] : [])],
    };
  }
  const hook = (sub: string, timeout = 30) => [{ hooks: [{ type: 'command', command: `${JSON.stringify(join(cfg.repoDir, 'bin', 'crew'))} hook ${sub}`, timeout }] }];
  const settings = {
    permissions: {
      allow,
      ask: g.ask,
      deny: [...CREDENTIAL_DENY.flatMap((p) => [`Read(${p})`, `Edit(${p})`]), 'CronCreate', 'ScheduleWakeup', 'RemoteTrigger'],
    },
    statusLine: { type: 'command', command: `${JSON.stringify(join(cfg.repoDir, 'bin', 'crew'))} hook statusline` },
    hooks: {
      SessionStart: hook('session'),
      // The browser's "asks first" rules: crewd knows the page each bot is on.
      PreToolUse: [{ matcher: 'mcp__browser__.*', ...hook('pretool')[0] }],
      PostToolUse: hook('tool', 10),
      Stop: hook('stop'),
      // A turn that ends on an API error (rate_limit, overloaded...) never fires Stop; this is how crewd hears of it.
      StopFailure: hook('failure'),
      // Holds up to 3 minutes for an answer from the app, then falls back to the CLI's own dialog.
      PermissionRequest: hook('permission', 190),
      Notification: hook('notify'),
    },
  };
  writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify(settings, null, 2));
  // Only the granted MCP servers; --strict keeps the person's own MCP servers out.
  const mcpFile = join(dir, '.crewhouse', 'mcp.json');
  writeFileSync(mcpFile, JSON.stringify({ mcpServers: g.mcp }, null, 2));
  return {
    bot: bot.id, kind: 'claude', cwd: dir, label: bot.display, env,
    args: ['--setting-sources', 'project,local', '--mcp-config', mcpFile, '--strict-mcp-config', ...(bot.model ? ['--model', bot.model] : [])],
  };
}
