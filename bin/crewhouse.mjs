#!/usr/bin/env node
// The `crewhouse` command of the two installs that have no checkout: `npm install -g crewhouse`, and install.sh (a
// download that carries its own Node and engine). Both run the same launcher script, `crewhouse` beside this folder.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.CREWHOUSE_RUN_MODE ??= 'product';
process.env.CREWHOUSE_CMD ??= 'crewhouse';
process.env.CREWHOUSE_PACKAGED ??= '1';
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd = 'start', ...args] = process.argv.slice(2);
const version = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version;
const fail = (words, code = 1) => { (code ? console.error : console.log)(words); process.exit(code); };
const USAGE = `Crewhouse ${version}
  crewhouse start     starts Crewhouse in the background, opens it in your browser and prints a phone pairing code
  crewhouse stop      stops it
  crewhouse status    says whether it is running, and where
  crewhouse link      prints the link that adds a phone
  crewhouse update    installs the newest version and restarts Crewhouse if it was running
  crewhouse doctor    shows what is installed and what is missing`;
if (['--version', '-v', 'version'].includes(cmd)) fail(`Crewhouse ${version}`, 0);
if (['help', '--help', '-h'].includes(cmd)) fail(USAGE, 0);
const node = process.versions.node.split('.').map(Number);
if (!(node[0] === 24 && node[1] >= 16 || node[0] === 26 && node[1] >= 1 || node[0] > 26)) {
  fail(`Crewhouse needs Node 24.16 or later on 24, or 26.1 or later (found ${process.version}).`);
}

// A download keeps Node, crewd and the engine beside this folder; the npm package gets its own copy of itself with
// its dependencies, once per version, because the launcher builds and writes inside the folder it runs from.
const download = existsSync(join(here, '..', 'node', 'bin', 'node'));
const { loadConfig } = await import(join(here, existsSync(join(here, 'dist/config.js')) ? 'dist/config.js' : 'src/config.ts'));
const config = loadConfig();
const app = join(dirname(config.toolsDir), 'app', version);
const current = download ? here : join(app, 'node_modules/crewhouse');
const launcher = (home, action, rest = args, stdio = 'inherit', env = process.env) => spawnSync('bash', [join(home, 'crewhouse'), action, ...rest], { stdio, cwd: home, env });

if (cmd === 'update') await update();

if (!existsSync(current)) {
  // Nothing has run on this computer yet: say so without installing anything.
  if (cmd === 'status') fail(`Crewhouse ${version} is not running. Start it with crewhouse start.`, 3);
  if (cmd === 'stop') fail('Crewhouse is not running.', 0);
}
if (!download && process.env.CREWHOUSE_NPM_HOME !== current) {
  if (!existsSync(current)) {
    console.log(`Setting up Crewhouse ${version} for the first time (it downloads its parts, which takes a few minutes, once per version).`);
    mkdirSync(app, { recursive: true });
    const packed = spawnSync('npm', ['pack', '--loglevel=error', '--ignore-scripts', '--pack-destination', app, here], { stdio: 'inherit' });
    if (packed.status !== 0) process.exit(packed.status ?? 1);
    const tarball = join(app, `crewhouse-${version}.tgz`);
    const install = spawnSync('npm', ['install', '--loglevel=error', '--prefix', app, '--no-audit', '--no-fund', tarball], { stdio: 'inherit' });
    unlinkSync(tarball);
    if (install.status !== 0) process.exit(install.status ?? 1);
  }
  const run = spawnSync(process.execPath, [join(current, 'bin/crewhouse.mjs'), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, CREWHOUSE_NPM_HOME: current } });
  process.exit(run.status ?? 1);
}

if (['setup', 'doctor', 'stop', 'status', 'link', 'phones', 'open', 'tools', 'autostart'].includes(cmd)) process.exit(launcher(here, cmd).status ?? 1);
if (cmd !== 'start') fail(`${USAGE}\n\nUnknown command: ${cmd}`, 2);

const log = join(config.stateDir, 'crewd.log');
// The first start installs the AI engine (setup); after that start just starts.
if (!existsSync(download ? join(config.stateDir, 'person.key') : join(config.stateDir, 'npm-ready'))) {
  const setup = launcher(here, 'setup', [], 'inherit', { ...process.env, CREWHOUSE_STARTING: '1' });
  if (setup.status !== 0) fail(`Setup did not finish; run crewhouse setup again once the cause above is fixed.`, setup.status ?? 1);
}
mkdirSync(config.stateDir, { recursive: true });
const out = openSync(log, 'a');
spawn('bash', [join(here, 'crewhouse'), 'start'], { cwd: here, env: process.env, detached: true, stdio: ['ignore', out, out] }).unref();
const key = join(config.stateDir, 'person.key');
const endpoint = join(config.stateDir, 'endpoint');
let authority, base;
for (let i = 0; i < 240 && !base; i++) {
  if (existsSync(key) && existsSync(endpoint)) {
    authority = readFileSync(key, 'utf8');
    const at = readFileSync(endpoint, 'utf8').trim();
    try {
      if ((await fetch(`${at}/api/state`, { headers: { 'x-crewhouse': '1', authorization: `Bearer ${authority}` } })).ok) base = at;
    } catch {}
  }
  if (!base) await new Promise((r) => setTimeout(r, 500));
}
if (!base) fail(`Crewhouse did not start. Its log is ${log}.`);
const pair = await fetch(`${base}/api/phones/pair`, {
  method: 'POST', headers: { 'x-crewhouse': '1', authorization: `Bearer ${authority}`, 'content-type': 'application/json' },
  body: JSON.stringify({ role: 'control' }),
});
if (!pair.ok) fail(`Crewhouse is running at ${base}/ but could not make a phone pairing code: ${await pair.text()}`);
const offer = await pair.json();
const { qrText } = await import('@byokit/ui-core/link');
console.log(`Crewhouse is running at ${base}/ (open it any time with crewhouse open).`);
console.log(`Phone pairing code: ${offer.typed}\n${qrText(offer.qr)}`);

// Stop, install the newest version the way this one was installed, and start again if it was running.
async function update() {
  const running = launcher(current, 'status', [], 'ignore').status === 0;
  // Back the way it ran: through its login service when it has one (the service points into the folder that was replaced), else as a plain start.
  const unit = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', 'crewhouse.service');
  const restart = () => running && spawnSync(download ? join(here, '..', 'node', 'bin', 'node') : 'crewhouse', [...(download ? [join(here, 'bin/crewhouse.mjs')] : []), ...(existsSync(unit) ? ['autostart', 'on'] : ['start'])], { stdio: 'inherit' });
  if (download) {
    const check = spawnSync('sh', [join(here, 'install.sh'), '--check'], { encoding: 'utf8' });
    if (check.status !== 0) fail(check.stderr.trim() || 'Could not find the newest version of Crewhouse.');
    if (check.stdout.trim() === version) fail(`Crewhouse ${version} is the newest version.`, 0);
    if (running && launcher(here, 'stop').status !== 0) fail('Crewhouse did not stop, so it was not updated.');
    const installed = spawnSync('sh', [join(here, 'install.sh')], { stdio: 'inherit', env: { ...process.env, CREWHOUSE_INSTALL_DIR: dirname(here), CREWHOUSE_UPDATING: '1' } });
    restart();
    if (installed.status !== 0) fail('Crewhouse was not updated; the cause is above. The version that was installed is still in place.');
    process.exit(0);
  }
  const view = spawnSync('npm', ['view', 'crewhouse', 'version'], { encoding: 'utf8' });
  const latest = view.stdout.trim();
  if (view.status !== 0 || !latest) fail(`Could not ask npm for the newest version of Crewhouse:\n${view.stderr.trim() || 'no answer'}`);
  if (latest === version) fail(`Crewhouse ${version} is the newest version.`, 0);
  console.log(`Updating Crewhouse ${version} to ${latest}.`);
  if (running && launcher(current, 'stop').status !== 0) fail('Crewhouse did not stop, so it was not updated.');
  const installed = spawnSync('npm', ['install', '-g', '--no-audit', '--no-fund', `crewhouse@${latest}`], { stdio: 'inherit' });
  if (installed.status !== 0) {
    if (running) restart();
    fail('Crewhouse was not updated; the cause is above. The version that was installed is still in place.');
  }
  // The new version sets itself up on its next start (engine included); this version's copy of itself is no longer needed.
  rmSync(join(config.stateDir, 'npm-ready'), { force: true });
  rmSync(app, { recursive: true, force: true });
  console.log(`Crewhouse is now ${latest}.`);
  restart();
  process.exit(0);
}
