// `./crewhouse doctor`: is this machine ready? Never reads a sign-in.
import { loadConfig } from './config.ts';
import { toolStatus } from './tools.ts';
import { browserBin, missing } from './desktop.ts';
import { sandboxReady } from './engine.ts'; import { pickRuntime } from './engines.ts'; import { why } from '../bin/why.mjs';

// The one tool for a broken machine must not crash on one: an engine that won't build is the finding.
const cfg = loadConfig(), engine = (() => { try { return pickRuntime(cfg).identity; } catch (e) { return why((e as Error).message); } })();
let problems = 0, extras = 0; // ✗ stops Crewhouse running; · is an optional part that is missing, and never fails doctor.
const line = (ok: boolean | null, what: string, detail = '', fix = '') => {
  if (ok === false) problems++; else if (ok === null) extras++;
  console.log(`${ok === null ? '·' : ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}${fix ? `\n    fix: ${fix}` : ''}`);
};

console.log('Needed to run:');
const [maj, min] = process.versions.node.split('.').map(Number);
line(maj === 24 && min >= 16 || maj === 26 && min >= 1 || maj > 26, `Node ${process.versions.node}`, 'needs 24.16 or later on 24, or 26.1 or later');
if ('name' in engine) line(true, `Engine: ${engine.name} ${engine.version}, Crewhouse's own copy`, `it runs under ${cfg.stateDir}/${engine.name.toLowerCase()}; your own ${engine.name} and ~/.${engine.name.toLowerCase()} are never used`); else line(false, `Engine: ${engine.cause}`, engine.next && `next: ${engine.next}`);
console.log('AI accounts: sign in from the app, under Settings, AI accounts.\n\nOptional (Crewhouse runs without these):');
line(sandboxReady() || null, sandboxReady() ? "Bots' shell runs in a sandbox (bubblewrap)" : 'no sandbox here: bots work without a shell', '',
  sandboxReady() ? '' : 'install bubblewrap (apt install bubblewrap, dnf install bubblewrap, pacman -S bubblewrap), and allow unprivileged user namespaces');

console.log('\nTool kit (a helper fetches its own the first time it needs it):');
for (const t of toolStatus(cfg)) {
  if (t.source === 'planned' || !t.ready && t.installable) { console.log(`· ${t.name} — ${t.source === 'planned' ? 'planned' : 'arrives on first use'}`); continue; }
  if (!t.ready) { line(null, t.name, `missing ${t.missing.join(', ')}`, t.howto); continue; }
  line(true, t.name, t.outdated ? `a newer pin is available — ${process.env.CREWHOUSE_CMD ?? './crewhouse'} tools install ${t.id}` : '');
}
console.log('\nBot desktops (the Computer tool):');
const gaps = missing();
line(gaps.length ? null : true, gaps.length ? `not available: needs ${gaps.join('; ')}` : 'Xvfb and the desklink engine are ready');
line(browserBin() ? true : null, browserBin() ? `Chromium for bots: ${browserBin()}` : 'no Chromium found: bot desktops start without a browser', '', browserBin() ? '' : 'install chromium');
console.log(`\nData: ${cfg.stateDir} (database, engine, sign-ins), ${cfg.crewDir} (bots), ${cfg.toolsDir} (tools)\n\n${problems ? `${problems} thing(s) stop Crewhouse running: fix the ✗ above.` : `Crewhouse is ready.${extras ? ` ${extras} optional part(s) missing: each · above says how to add it.` : ''}`}`);
process.exit(problems ? 1 : 0);
