import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Everything the daemon needs to know about where it lives. All overridable by env,
 *  because the tests need their own data dir. Never inside the repo. */
export interface Config {
  /** SQLite, the endpoint file, the engine's own folder and each member's sign-ins live here. */
  stateDir: string;
  /** Human-visible crew folder: bots/<name>/, crew/. */
  crewDir: string;
  /** Pinned tool installs (npm, pip, single binaries): Crewhouse's own folder, never global. */
  toolsDir: string;
  host: string;
  port: number;
  /** The phone link (src/link.ts). Empty host: loopback and Tailscale, plus the LAN when the owner turns
   *  it on in Settings, Phones. A comma list pins the addresses instead. Port 0 turns the link off. */
  linkHost: string;
  linkPort: number;
  /** A relay the family runs themselves (relay/), for phones away from home. None by default: there is no hosted one.
   *  Settings, Phones overrides it. */
  relay: string;
  /** 'pi' for the real AI accounts, 'stub' for tests: a scripted model inside the same engine, no quota. */
  engine: 'pi' | 'stub';
  /** Max concurrent bot runs. */
  maxConcurrent: number;
  repoDir: string;
}

function envPath(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? resolve(v.trim().replace(/^~(?=\/|$)/, homedir())) : fallback;
}

export function loadConfig(): Config {
  const home = homedir();
  const xdgState = process.env.XDG_STATE_HOME?.trim() || join(home, '.local', 'state');
  return {
    stateDir: envPath('CREWHOUSE_STATE_DIR', join(xdgState, 'crewhouse')),
    crewDir: envPath('CREWHOUSE_CREW_DIR', join(home, 'Crewhouse')),
    toolsDir: envPath('CREWHOUSE_TOOLS_DIR', join(process.env.XDG_DATA_HOME?.trim() || join(home, '.local', 'share'), 'crewhouse', 'tools')),
    host: process.env.CREWHOUSE_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.CREWHOUSE_PORT || 7711),
    linkHost: process.env.CREWHOUSE_LINK_HOST?.trim() || '',
    linkPort: Number(process.env.CREWHOUSE_LINK_PORT ?? 7712),
    relay: process.env.CREWHOUSE_RELAY?.trim() ?? '',
    engine: process.env.CREWHOUSE_ENGINE === 'stub' ? 'stub' : 'pi',
    maxConcurrent: Number(process.env.CREWHOUSE_MAX_CONCURRENT || 3),
    repoDir: resolve(import.meta.dirname, '..'),
  };
}

export const CHIEF = 'chief';
