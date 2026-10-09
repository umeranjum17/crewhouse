import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Everything the daemon needs to know about where it lives. All overridable by env,
 *  because the tests need their own data dir. Never inside the repo. */
export interface Config {
  /** SQLite, the endpoint file, the engine's own folder and the person's sign-ins live here. */
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
  /** A relay the person runs themselves (relay/), for phones away from home. None by default: there is no hosted one.
   *  Settings, Phones overrides it. */
  relay: string;
  /** 'openclaw' for the real engine, 'stub' for tests: the scripted model, no quota. */
  engine: 'openclaw' | 'stub';
  /** Max concurrent bot runs. */
  maxConcurrent: number;
  /** A custom OpenAI-compatible model provider for the engine (the tests' scripted model; a self-hosted gateway later). */
  engineProvider?: { baseUrl: string; apiKey: string };
  repoDir: string;
}

function envPath(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? resolve(v.trim().replace(/^~(?=\/|$)/, homedir())) : fallback;
}

export function loadConfig(): Config {
  const home = homedir(), xdgState = process.env.XDG_STATE_HOME?.trim() || join(home, '.local', 'state');
  return {
    stateDir: envPath('CREWHOUSE_STATE_DIR', join(xdgState, 'crewhouse')),
    crewDir: envPath('CREWHOUSE_CREW_DIR', join(home, 'Crewhouse')),
    toolsDir: envPath('CREWHOUSE_TOOLS_DIR', join(process.env.XDG_DATA_HOME?.trim() || join(home, '.local', 'share'), 'crewhouse', 'tools')),
    host: process.env.CREWHOUSE_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.CREWHOUSE_PORT || 7711),
    linkHost: process.env.CREWHOUSE_LINK_HOST?.trim() || '',
    linkPort: Number(process.env.CREWHOUSE_LINK_PORT ?? 7712),
    relay: process.env.CREWHOUSE_RELAY?.trim() ?? '',
    engine: process.env.CREWHOUSE_ENGINE === 'stub' ? 'stub' : 'openclaw',
    maxConcurrent: Number(process.env.CREWHOUSE_MAX_CONCURRENT || 3),
    engineProvider: process.env.CREWHOUSE_ENGINE_BASE_URL && process.env.CREWHOUSE_ENGINE_API_KEY
      ? { baseUrl: process.env.CREWHOUSE_ENGINE_BASE_URL, apiKey: process.env.CREWHOUSE_ENGINE_API_KEY } : undefined,
    repoDir: resolve(import.meta.dirname, '..'),
  };
}

export const CHIEF = 'chief';
