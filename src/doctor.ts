// `./crewhouse doctor`: is this machine ready? Never reads a sign-in.
import './isolate.ts'; // first: before anything loads the engine
import { loadConfig } from './config.ts';
import { toolStatus, which } from './tools.ts';
import { browserBin, missing } from './desktop.ts';
import { sandboxReady } from './engine.ts';
import { VERSION } from '@earendil-works/pi-coding-agent';

const cfg = loadConfig();
let problems = 0;
const line = (ok: boolean | null, what: string, detail = '') => {
  if (ok === false) problems++;
  console.log(`${ok === null ? '·' : ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const [maj, min] = process.versions.node.split('.').map(Number);
line(maj > 22 || (maj === 22 && min >= 19), `Node ${process.versions.node}`, 'needs 22.19 or later (built-in TypeScript and node:sqlite)');
line(true, `Engine: Pi ${VERSION}, bundled`, `its own folder in ${cfg.stateDir}/engine; your own pi and ~/.pi are never used`);
line(sandboxReady() || null, sandboxReady() ? "Bots' shell runs in a sandbox (bubblewrap)" : 'no sandbox here: bots work without a shell',
  sandboxReady() ? '' : 'install bubblewrap (apt install bubblewrap, dnf install bubblewrap, pacman -S bubblewrap), and allow unprivileged user namespaces');
console.log('AI accounts: each person signs in from the app, under Settings, AI accounts.');

console.log('\nTool kit:');
for (const t of toolStatus(cfg)) {
  if (t.source === 'planned') { line(null, t.name, `planned: ${t.install.system ?? ''}`); continue; }
  if (!t.ready) { line(null, t.name, `missing ${t.missing.join(', ')}: ${t.howto}`); continue; }
  const where = !t.bins.length ? 'built in' : which(cfg, t.bins[0])!.startsWith(cfg.toolsDir) ? 'pinned in Crewhouse' : 'found on PATH';
  line(true, t.name, `${t.license}, ${where}${t.outdated ? '; new pin available: ./crewhouse tools install ' + t.id : ''}`);
}
console.log('\nBot desktops (the Computer tool):');
const gaps = missing();
line(gaps.length ? null : true, gaps.length ? `not available: needs ${gaps.join('; ')}` : 'Xvfb and the desklink engine are ready');
line(browserBin() ? true : null, browserBin() ? `Chromium for bots: ${browserBin()}` : 'no Chromium found: bot desktops start without a browser (install chromium)');
console.log(`\nData: ${cfg.stateDir} (database, engine, sign-ins), ${cfg.crewDir} (bots), ${cfg.toolsDir} (tools)`);
console.log(problems ? `\n${problems} problem(s) above.` : '\nReady.');
process.exit(problems ? 1 : 0);
