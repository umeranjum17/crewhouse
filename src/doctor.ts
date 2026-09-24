// `./crewhouse doctor`: is this machine ready? Uses only the vendors' own status commands; never reads credentials.
import { execFileSync } from 'node:child_process';
import { loadConfig } from './config.ts';
import { toolStatus, which } from './tools.ts';

const TESTED_HERDR = '0.9.1';
const cfg = loadConfig();
let problems = 0;
const line = (ok: boolean | null, what: string, detail = '') => {
  if (ok === false) problems++;
  console.log(`${ok === null ? '·' : ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
};
const run = (cmd: string, args: string[]) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; }
};

const [maj, min] = process.versions.node.split('.').map(Number);
line(maj > 22 || (maj === 22 && min >= 18), `Node ${process.versions.node}`, 'needs 22.18 or later (built-in TypeScript and node:sqlite)');

const herdr = run('herdr', ['--version']);
line(!!herdr, 'Herdr', herdr ? `${herdr}${herdr.includes(TESTED_HERDR) ? '' : ` (tested with ${TESTED_HERDR})`}` : 'not found: see https://herdr.dev');
if (herdr) {
  // Same command prefix and session as crewd, so a lab wrapper stays in charge of which session is asked.
  const [cmd, ...pre] = cfg.herdrCmd;
  const st = run(cmd, [...pre, 'status', '--json', ...(cfg.herdrSession ? ['--session', cfg.herdrSession] : [])]);
  const s = st ? JSON.parse(st) : null;
  line(null, `Herdr session "${cfg.herdrSession || s?.client?.session || '?'}"`, s?.server?.running ? `running, ${s.server.compatible ? 'compatible' : 'INCOMPATIBLE'}` : 'not running (crewd starts it)');
}

const claude = run('claude', ['--version']);
if (claude) {
  const auth = run('claude', ['auth', 'status']);
  const signedIn = auth ? JSON.parse(auth).loggedIn === true : false;
  line(signedIn, `Claude Code ${claude.split(' ')[0]}`, signedIn ? 'signed in' : 'run `claude` once and sign in with your own account');
} else line(false, 'Claude Code', 'not found: https://claude.com/claude-code');
const codex = run('codex', ['--version']);
if (codex) {
  const st = run('codex', ['login', 'status']);
  line(null, codex, st ?? 'not signed in: run `codex login`');
} else line(null, 'Codex', 'not installed (optional)');

console.log('\nTool kit:');
for (const t of toolStatus(cfg)) {
  if (t.source === 'planned') { line(null, t.name, `planned: ${t.install.system ?? ''}`); continue; }
  if (!t.ready) { line(null, t.name, `missing ${t.missing.join(', ')}: ${t.howto}`); continue; }
  const where = t.bins.length && which(cfg, t.bins[0])!.startsWith(cfg.toolsDir) ? 'pinned in Crewhouse' : t.source === 'bundled' ? 'built in' : 'found on PATH';
  line(true, t.name, `${t.license}, ${where}${t.outdated ? '; new pin available: ./crewhouse tools install ' + t.id : ''}`);
}
console.log(`\nData: ${cfg.stateDir} (database), ${cfg.crewDir} (bots), ${cfg.toolsDir} (tools)`);
console.log(problems ? `\n${problems} problem(s) above.` : '\nReady.');
process.exit(problems ? 1 : 0);
