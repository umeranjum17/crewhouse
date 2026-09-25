// The kit: one manifest per tool in tools/<id>/tool.json, pinned installs into Crewhouse's own tool folder.
// `node src/tools.ts install [ids...]` installs; never globally, never with sudo.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, type Config } from './config.ts';

export interface Install {
  /** Pinned npm spec, installed with its own node_modules under tools/<id>/. */
  npm?: string;
  /** Pinned pip spec, installed into its own venv under tools/<id>/. */
  pip?: string;
  /** One file, checked against its sha256 before it is kept. */
  download?: { url: string; sha256: string };
  /** Commands run after the package lands, e.g. fetching the browser. argv[0] resolves in the tool's own bin. */
  then?: string[][];
  /** System packages are detected, never installed: this is the line shown to the person. */
  system?: string;
}

export interface Tool {
  id: string; name: string; provides: string; kind: string; bins: string[]; license: string;
  /** bundled: ships with Crewhouse. pinned: Crewhouse installs it. system: detected. planned: not yet. */
  source: 'bundled' | 'pinned' | 'system' | 'planned';
  install: Install;
  /** "Asks you first when…", in plain words, for the recruit card and bot settings. */
  asks: string[];
  /** A command-line tool that runs with the person's own sign-in, on this computer rather than in the bot's sandbox.
   *  The bot calls it with a list of arguments: `free` prefixes run at once, `spend` prefixes ask every time, anything else is refused. */
  run?: { free: string[]; spend: string[] };
  /** An MCP server the bot's session starts, named after the tool id. */
  mcp?: { command: string; args: string[]; env?: Record<string, string> };
  env?: Record<string, string>;
  grant?: { default: boolean };
  note?: string;
}

export function registry(cfg: Config): Tool[] {
  const dir = join(cfg.repoDir, 'tools');
  return readdirSync(dir).sort().filter((t) => existsSync(join(dir, t, 'tool.json')))
    .map((t) => JSON.parse(readFileSync(join(dir, t, 'tool.json'), 'utf8')));
}

/** The pin a tool is installed at: the manifest's own install spec, so a changed pin reads as an update. */
const pinOf = (t: Tool) => JSON.stringify({ npm: t.install.npm, pip: t.install.pip, download: t.install.download, then: t.install.then });
const pinFile = (cfg: Config, id: string) => join(cfg.toolsDir, id, '.pin');
export const toolBin = (cfg: Config) => join(cfg.toolsDir, 'bin');

/** Where a binary is: Crewhouse's own copy first, then the person's PATH. */
export function which(cfg: Config, bin: string) {
  for (const d of [toolBin(cfg), ...(process.env.PATH ?? '').split(':')]) if (d && existsSync(join(d, bin))) return join(d, bin);
  return null;
}

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{([a-z.]+)\}/g, (m, k) => vars[k] ?? m);

/** Registry plus whether each tool works on this machine right now. */
export function toolStatus(cfg: Config) {
  return registry(cfg).map((t) => {
    const missing = t.source === 'planned' ? [] : t.bins.filter((b) => !which(cfg, b));
    const pinned = existsSync(pinFile(cfg, t.id)) ? readFileSync(pinFile(cfg, t.id), 'utf8') : null;
    return {
      ...t, missing,
      ready: t.source !== 'planned' && !missing.length,
      /** Installed by Crewhouse at an older pin than the manifest asks for. */
      outdated: pinned !== null && pinned !== pinOf(t),
      installable: t.source === 'pinned',
      howto: t.source === 'pinned' ? `./crewhouse tools install ${t.id}` : t.install.system ?? '',
    };
  });
}

export type ToolState = ReturnType<typeof toolStatus>[number];

/** What a bot's grants turn into: ready tools, MCP servers and env. Missing tools are not offered. */
export function resolveGrants(cfg: Config, grants: string[], vars: Record<string, string>) {
  const all = new Map(toolStatus(cfg).map((t) => [t.id, t]));
  const wanted = [...new Set(['crew', ...grants])].map((g) => all.get(g)).filter((t) => t) as ToolState[];
  const tools = wanted.filter((t) => t.ready);
  const v = { tools: cfg.toolsDir, ...vars };
  const mcp = Object.fromEntries(tools.filter((t) => t.mcp).map((t) => [t.id, {
    command: which(cfg, t.mcp!.command) ?? t.mcp!.command,
    args: t.mcp!.args.map((a) => fill(a, v)),
    env: Object.fromEntries(Object.entries(t.mcp!.env ?? {}).map(([k, x]) => [k, fill(x, v)])),
  }]));
  return {
    tools: tools.map((t) => t.id),
    missing: wanted.filter((t) => !t.ready && t.source !== 'planned').map((t) => t.id),
    env: Object.fromEntries(tools.flatMap((t) => Object.entries(t.env ?? {})).map(([k, x]) => [k, fill(x, v)])),
    mcp,
  };
}

async function download(url: string, sha256: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== sha256) throw new Error(`checksum mismatch for ${url}: got ${got}`);
  return buf;
}

/** Install one pinned tool into tools/<id>/ and link its bins into tools/bin/. Idempotent at the same pin. */
export async function installTool(cfg: Config, id: string, log: (s: string) => void = () => {}) {
  const t = registry(cfg).find((x) => x.id === id);
  if (!t) throw new Error(`unknown tool ${id}`);
  if (t.source !== 'pinned') throw new Error(`${t.name} is not installed by Crewhouse${t.install.system ? `: ${t.install.system}` : ''}`);
  const dir = join(cfg.toolsDir, id);
  if (existsSync(pinFile(cfg, id)) && readFileSync(pinFile(cfg, id), 'utf8') === pinOf(t) && t.bins.every((b) => existsSync(join(toolBin(cfg), b)))) {
    log(`${t.name}: already installed`);
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  mkdirSync(toolBin(cfg), { recursive: true });
  const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
    execFileSync(cmd, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, maxBuffer: 64 << 20 });
  let binDir = dir;
  if (t.install.npm) {
    log(`${t.name}: npm ${t.install.npm}`);
    run('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', '--no-save', t.install.npm]);
    binDir = join(dir, 'node_modules', '.bin');
  } else if (t.install.pip) {
    log(`${t.name}: pip ${t.install.pip}`);
    run('python3', ['-m', 'venv', join(dir, 'venv')]);
    run(join(dir, 'venv', 'bin', 'pip'), ['install', '--quiet', '--disable-pip-version-check', t.install.pip]);
    binDir = join(dir, 'venv', 'bin');
  } else if (t.install.download) {
    log(`${t.name}: ${t.install.download.url}`);
    const file = join(dir, t.bins[0]);
    writeFileSync(file, await download(t.install.download.url, t.install.download.sha256));
    chmodSync(file, 0o755);
  }
  const vars = { tools: cfg.toolsDir, 'tool.dir': dir };
  for (const [cmd, ...args] of t.install.then ?? []) {
    log(`${t.name}: ${cmd} ${args.join(' ')}`);
    run(existsSync(join(binDir, cmd)) ? join(binDir, cmd) : cmd, args.map((a) => fill(a, vars)),
      Object.fromEntries(Object.entries(t.mcp?.env ?? {}).map(([k, x]) => [k, fill(x, vars)])));
  }
  for (const b of t.bins) {
    if (!existsSync(join(binDir, b))) throw new Error(`${t.name} installed but ${b} is missing`);
    rmSync(join(toolBin(cfg), b), { force: true });
    symlinkSync(join(binDir, b), join(toolBin(cfg), b));
  }
  writeFileSync(pinFile(cfg, id), pinOf(t));
  log(`${t.name}: installed`);
}

if (process.argv[1] === import.meta.filename) {
  const cfg = loadConfig();
  const [cmd, ...ids] = process.argv.slice(2);
  const kit = toolStatus(cfg);
  if (cmd === 'install') {
    const pick = ids.length ? ids : kit.filter((t) => t.installable && (!t.ready || t.outdated)).map((t) => t.id);
    let failed = 0;
    for (const id of pick) await installTool(cfg, id, console.log).catch((e) => { failed++; console.error(`✗ ${id}: ${e.message}`); });
    if (!pick.length) console.log('Nothing to install: every pinned tool is ready.');
    process.exit(failed ? 1 : 0);
  }
  for (const t of kit) console.log(`${t.ready ? '✓' : '·'} ${t.id.padEnd(15)} ${t.name} (${t.license})${t.ready ? '' : ` — ${t.howto || t.source}`}`);
  console.log(`\nInstall the pinned kit into ${cfg.toolsDir}: ./crewhouse tools install [ids...]`);
}
