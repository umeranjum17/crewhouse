#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../dist/config.js';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd = 'start', ...args] = process.argv.slice(2);
const node = process.versions.node.split('.').map(Number);
if (node[0] < 22 || node[0] === 22 && (node[1] < 22 || node[1] === 22 && node[2] < 3)) {
  console.error(`Crewhouse needs Node 22.22.3 or later (found ${process.version}).`);
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version;
const app = join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'crewhouse/app', version);
const current = join(app, 'node_modules/crewhouse');
if (process.env.CREWHOUSE_NPM_HOME !== current) {
  mkdirSync(app, { recursive: true });
  const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', app, here], { stdio: 'inherit' });
  if (packed.status !== 0) process.exit(packed.status ?? 1);
  const tarball = join(app, `crewhouse-${version}.tgz`);
  const install = spawnSync('npm', ['install', '--prefix', app, '--no-audit', '--no-fund', tarball], { stdio: 'inherit' });
  unlinkSync(tarball);
  if (install.status !== 0) process.exit(install.status ?? 1);
  const run = spawnSync(process.execPath, [join(current, 'bin/crewhouse.mjs'), ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, CREWHOUSE_NPM_HOME: current },
  });
  process.exit(run.status ?? 1);
}

const launch = (action) => spawnSync('bash', [join(here, 'crewhouse'), action, ...args], { stdio: 'inherit', cwd: here, env: process.env });
if (cmd === 'setup') process.exit(launch('setup').status ?? 1);
if (cmd === 'doctor') process.exit(launch('doctor').status ?? 1);
if (cmd !== 'start') {
  console.error('Usage: crewhouse [start|setup|doctor]');
  process.exit(2);
}
const setup = launch('setup');
if (setup.status !== 0) process.exit(setup.status ?? 1);
const child = spawn('bash', [join(here, 'crewhouse'), 'start'], { cwd: here, env: process.env, detached: true, stdio: 'ignore' });
child.unref();
const config = loadConfig();
const key = join(config.stateDir, 'person.key');
let authority;
for (let i = 0; i < 240; i++) {
  if (existsSync(key)) {
    authority = readFileSync(key, 'utf8');
    try {
      const r = await fetch(`http://${process.env.CREWHOUSE_HOST || '127.0.0.1'}:${process.env.CREWHOUSE_PORT || 7711}/api/state`, {
        headers: { 'x-crewhouse': '1', authorization: `Bearer ${authority}` },
      });
      if (r.ok) break;
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!authority) throw new Error('Crewhouse did not start; check ~/.local/state/crewhouse/crewd.log.');
const port = config.port;
const pair = await fetch(`http://127.0.0.1:${port}/api/phones/pair`, {
  method: 'POST', headers: { 'x-crewhouse': '1', authorization: `Bearer ${authority}`, 'content-type': 'application/json' },
  body: JSON.stringify({ role: 'control' }),
});
if (!pair.ok) throw new Error(`Could not create a phone pairing code: ${await pair.text()}`);
const offer = await pair.json();
const { qrText } = await import('@byokit/ui-core/link');
console.log(`Crewhouse is running at http://127.0.0.1:${port}/`);
console.log(`Phone pairing code: ${offer.typed}\n${qrText(offer.qr)}`);
