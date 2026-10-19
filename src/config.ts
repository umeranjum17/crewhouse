import { spawnSync } from 'node:child_process'; import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs'; import { appDir } from './paths.ts'; export { appDir }; import { homedir, tmpdir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** Product launchers keep the installed crew; tests and unmarked scripts get a private home. */
export interface Config {
  stateDir: string;
  crewDir: string;
  toolsDir: string;
  engineDir: string;
  host: string;
  port: number;
  linkHost: string;
  linkPort: number;
  relay: string;
  relayPublic: string;
  engine: 'openclaw' | 'stub';
  maxConcurrent: number;
  engineProvider?: { baseUrl: string; apiKey: string };
  googleClient: string;
  repoDir: string;
}

function envPath(name: string, fallback: string): string { const v = process.env[name]; return v && v.trim() ? resolve(v.trim().replace(/^~(?=\/|$)/, homedir())) : fallback; }

export function relayOrigin(value: string | null): string | null {
  if (value && (!URL.canParse(value) || !/^(https?|wss?):$/.test(new URL(value).protocol))) throw Object.assign(new Error('a relay address starts with https:// or wss://'), { status: 400 });
  return value && new URL(value).origin;
}

// Unmarked lab/proof scripts are isolated even when they select the stub only after loadConfig.
export const isolatedRun = (engine = process.env.CREWHOUSE_ENGINE) => !!process.env.NODE_TEST_CONTEXT || process.env.CREWHOUSE_ENGINE === 'stub' || engine === 'stub' || (process.env.CREWHOUSE_RUN_MODE !== 'product' && !(process.env.CREWHOUSE_RUN_MODE === undefined && process.platform === 'linux' && /\/crewhouse(?:-headless)?\.service(?:\/|$)/m.test(readFileSync('/proc/self/cgroup', 'utf8'))));
const physical = (p: string): string => lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink() ? physical(resolve(dirname(p), readlinkSync(p))) : existsSync(p) ? realpathSync(p) : join(physical(dirname(p)), basename(p));
export function assertSafeConfig(cfg: Config) {
  if ([cfg.stateDir, cfg.crewDir].some(p => (physical(resolve(p)) + '/').startsWith(physical(cfg.repoDir) + '/'))) throw new Error('crewd: data must live outside the repo; set CREWHOUSE_STATE_DIR / CREWHOUSE_CREW_DIR elsewhere');
  if (!isolatedRun(cfg.engine)) return;
  const owner = userInfo().homedir, roots = ['Crewhouse', '.local/state/crewhouse', '.local/share/crewhouse', '.config/byokit'].map(p => physical(join(owner, p)));
  for (const p of [cfg.stateDir, cfg.crewDir, cfg.toolsDir, cfg.engineDir, cfg.googleClient]) {
    const target = physical(resolve(p));
    if (roots.some(r => target === r || target.startsWith(r + '/') || r.startsWith(target + '/'))) throw new Error(`crewd: refusing isolated start: ${p} overlaps the owner's Crewhouse; set isolated CREWHOUSE_* directories`);
  }
}
export function removeOnExit(dir: string): string { if (process.env.CREWHOUSE_KEEP_RUN_HOME) return dir; const remove = () => { try { spawnSync('chmod', ['-R', 'u+w', dir]); rmSync(dir, { recursive: true, force: true }); } catch (error) { console.error(`crewhouse: could not remove ${dir}: ${(error as Error).message}`); } }; process.once('exit', remove); for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, () => { remove(); if (!process.listenerCount(signal)) process.kill(process.pid, signal); }); return dir; } // Removes a run home this process created on exit or on a signal no other listener handles; the kit's engine files are read-only, so the tree is made writable first. The launcher's config probe sets CREWHOUSE_KEEP_RUN_HOME, since crewd inherits that home.
export function loadConfig(): Config {
  const product = !isolatedRun(), home = product ? homedir() : process.env.CREWHOUSE_RUN_HOME ||= removeOnExit(mkdtempSync(join(tmpdir(), 'crewhouse-run-')));
  const xdgState = process.env.XDG_STATE_HOME?.trim() || join(home, '.local', 'state'), xdgData = process.env.XDG_DATA_HOME?.trim() || join(home, '.local', 'share'), repoDir = appDir, own = join(repoDir, 'runtime', 'openclaw');
  const cfg: Config = {
    stateDir: envPath('CREWHOUSE_STATE_DIR', join(xdgState, 'crewhouse')),
    crewDir: envPath('CREWHOUSE_CREW_DIR', join(home, 'Crewhouse')),
    toolsDir: envPath('CREWHOUSE_TOOLS_DIR', join(xdgData, 'crewhouse', 'tools')),
    engineDir: envPath('CREWHOUSE_ENGINE_DIR', product && (existsSync(join(repoDir, '.git')) || existsSync(own)) ? own : join(xdgData, 'crewhouse', 'engine')),
    host: process.env.CREWHOUSE_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.CREWHOUSE_PORT || (product ? 7711 : 0)),
    linkHost: process.env.CREWHOUSE_LINK_HOST?.trim() || '',
    linkPort: Number(process.env.CREWHOUSE_LINK_PORT ?? (product ? 7712 : 0)),
    relay: process.env.CREWHOUSE_RELAY?.trim() ?? '',
    relayPublic: relayOrigin(process.env.CREWHOUSE_RELAY_PUBLIC?.trim() || null) ?? '',
    engine: process.env.CREWHOUSE_ENGINE === 'stub' ? 'stub' : 'openclaw',
    maxConcurrent: Number(process.env.CREWHOUSE_MAX_CONCURRENT || 3),
    engineProvider: process.env.CREWHOUSE_ENGINE_BASE_URL && process.env.CREWHOUSE_ENGINE_API_KEY
      ? { baseUrl: process.env.CREWHOUSE_ENGINE_BASE_URL, apiKey: process.env.CREWHOUSE_ENGINE_API_KEY } : undefined,
    googleClient: envPath('CREWHOUSE_GOOGLE_CLIENT', join((product && process.env.XDG_CONFIG_HOME?.trim()) || join(home, '.config'), 'byokit', 'google-oauth-client.json')),
    repoDir,
  };
  assertSafeConfig(cfg);
  return cfg;
}

export const CHIEF = 'chief';
