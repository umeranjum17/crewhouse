import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Everything the daemon needs to know about where it lives. All overridable by env,
 *  because the tests and the Herdr lab need their own data dir. Never inside the repo. */
export interface Config {
  /** SQLite + endpoint file live here. */
  stateDir: string;
  /** Human-visible crew folder: bots/<name>/, crew/. */
  crewDir: string;
  host: string;
  port: number;
  /** Command used to talk to Herdr. A prefix so the Herdr lab helper can wrap it. */
  herdrCmd: string[];
  /** crewd's own Herdr session. Empty when a wrapper (the Herdr lab) supplies the session itself. */
  herdrSession: string;
  /** Default CLI kind for new bots. */
  runtime: string;
  /** 'herdr' for real CLIs, 'stub' for tests (no model quota). */
  runner: 'herdr' | 'stub';
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
    host: process.env.CREWHOUSE_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.CREWHOUSE_PORT || 7711),
    // e.g. CREWHOUSE_HERDR_CMD="/path/fm-herdr-lab.sh run fm-lab-x" keeps us off the live session.
    herdrCmd: (process.env.CREWHOUSE_HERDR_CMD?.trim() || 'herdr').split(/\s+/),
    herdrSession: process.env.CREWHOUSE_HERDR_CMD?.trim() ? '' : process.env.CREWHOUSE_HERDR_SESSION?.trim() || 'crewhouse',
    runtime: process.env.CREWHOUSE_RUNTIME?.trim() || 'claude',
    runner: process.env.CREWHOUSE_RUNNER === 'stub' ? 'stub' : 'herdr',
    maxConcurrent: Number(process.env.CREWHOUSE_MAX_CONCURRENT || 3),
    repoDir: resolve(import.meta.dirname, '..'),
  };
}

export const CHIEF = 'chief';
