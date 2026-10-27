// `./crewhouse doctor`: is this machine ready? Never reads a sign-in.
import { loadConfig } from './config.ts';
import { toolStatus } from './tools.ts';
import { browserBin, missing, probeEngine } from './desktop.ts';
import { sandboxReady } from './engine.ts';
import { pickRuntime } from './engines.ts';

const cfg = loadConfig(), { name, version } = pickRuntime(cfg).identity;
let problems = 0;
const line = (ok: boolean | null, what: string, detail = '') => {
  if (ok === false) problems++;
  console.log(`${ok === null ? '·' : ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const [maj, min] = process.versions.node.split('.').map(Number);
line(maj === 24 && min >= 16 || maj === 26 && min >= 1 || maj > 26, `Node ${process.versions.node}`, 'needs 24.16 or later on 24, or 26.1 or later');
line(true, `Engine: ${name} ${version}, Crewhouse's own copy`, `it runs under ${cfg.stateDir}/${name.toLowerCase()}; your own ${name} and ~/.${name.toLowerCase()} are never used`);
line(sandboxReady() || null, sandboxReady() ? "Bots' shell runs in a sandbox (bubblewrap)" : 'no sandbox here: bots work without a shell',
  sandboxReady() ? '' : 'install bubblewrap (apt install bubblewrap, dnf install bubblewrap, pacman -S bubblewrap), and allow unprivileged user namespaces');
console.log('AI accounts: sign in from the app, under Settings, AI accounts.');

console.log('\nTool kit (a helper fetches its own the first time it needs it):');
for (const t of toolStatus(cfg)) {
  if (t.source === 'planned') { line(null, t.name, 'planned'); continue; }
  if (!t.ready) { line(null, t.name, t.installable ? 'arrives on first use' : `missing ${t.missing.join(', ')}`); continue; }
  line(true, t.name, t.outdated ? `a newer pin is available — ${process.env.CREWHOUSE_CMD ?? './crewhouse'} tools install ${t.id}` : '');
}
console.log('\nBot desktops (the Computer tool):');
const gaps = missing();
line(gaps.length ? (probeEngine().refused ? false : null) : true, gaps.length ? `not available: needs ${gaps.join('; ')}` : 'Xvfb and the desklink engine are ready');
line(browserBin() ? true : null, browserBin() ? `Chromium for bots: ${browserBin()}` : 'no Chromium found: bot desktops start without a browser (install chromium)');
console.log(`\nData: ${cfg.stateDir} (database, engine, sign-ins), ${cfg.crewDir} (bots), ${cfg.toolsDir} (tools)`);
console.log(problems ? `\n${problems} problem(s) above.` : '\nReady.');
process.exit(problems ? 1 : 0);
