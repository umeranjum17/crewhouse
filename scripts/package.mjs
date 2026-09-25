// Builds the one download: dist/crewhouse_<version>_amd64.deb (Debian and Ubuntu: open it and the software centre
// installs it, bubblewrap and Xvfb included) and dist/crewhouse-<version>-linux-x64.tar.gz (the same folder, anywhere).
// Both carry their own Node (pinned, checksum-verified), crewd, the built web app and the launcher, under /opt/crewhouse.
// Run after `npm run build:web`. Needs curl, tar, xz and ar (binutils).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NODE = '24.21.0';
const NODE_SHA256 = 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6'; // node-v24.21.0-linux-x64.tar.xz

const repo = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const dist = join(repo, 'dist');
const stage = join(dist, 'stage');
const opt = join(stage, 'opt', 'crewhouse');
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
if (!existsSync(join(repo, 'web', 'dist', 'index.html'))) throw new Error('build the web app first: npm run build:web');

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(opt, 'node'), { recursive: true });

// Node, as nodejs.org ships it, checked against the pinned checksum.
const tarball = join(dist, `node-v${NODE}-linux-x64.tar.xz`);
if (!existsSync(tarball)) sh('curl', ['-fsSLo', tarball, `https://nodejs.org/dist/v${NODE}/node-v${NODE}-linux-x64.tar.xz`]);
const sum = createHash('sha256').update(readFileSync(tarball)).digest('hex');
if (sum !== NODE_SHA256) { rmSync(tarball); throw new Error(`Node checksum mismatch: ${sum}`); }
sh('tar', ['-xJf', tarball, '-C', join(opt, 'node'), '--strip-components=1']);

// crewd and what it reads at run time; production dependencies only, installed with the bundled npm.
const app = join(opt, 'app');
for (const part of ['src', 'templates', 'tools', 'skills', 'package.json', 'package-lock.json', '.npmrc']) {
  if (existsSync(join(repo, part))) cpSync(join(repo, part), join(app, part), { recursive: true });
}
cpSync(join(repo, 'web', 'dist'), join(app, 'web', 'dist'), { recursive: true });
sh(join(opt, 'node', 'bin', 'npm'), ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: app, env: { ...process.env, PATH: `${join(opt, 'node', 'bin')}:${process.env.PATH}` } });

// The launcher, the menu entry and the icon.
cpSync(join(repo, 'packaging', 'launch.mjs'), join(opt, 'launch.mjs'));
mkdirSync(join(stage, 'usr', 'share', 'applications'), { recursive: true });
cpSync(join(repo, 'packaging', 'crewhouse.desktop'), join(stage, 'usr', 'share', 'applications', 'crewhouse.desktop'));
mkdirSync(join(stage, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps'), { recursive: true });
cpSync(join(repo, 'web', 'icon-512.png'), join(stage, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps', 'crewhouse.png'));
mkdirSync(join(stage, 'usr', 'bin'), { recursive: true });
writeFileSync(join(stage, 'usr', 'bin', 'crewhouse-app'), '#!/bin/sh\nexec /opt/crewhouse/node/bin/node /opt/crewhouse/launch.mjs "$@"\n');
chmodSync(join(stage, 'usr', 'bin', 'crewhouse-app'), 0o755);

// The portable folder.
const tgz = join(dist, `crewhouse-${version}-linux-x64.tar.gz`);
sh('tar', ['-czf', tgz, '--owner=0', '--group=0', '-C', join(stage, 'opt'), 'crewhouse']);

// The .deb: debian-binary, control.tar.gz and data.tar.xz, in that order, in an ar archive.
const deb = join(dist, 'deb');
rmSync(deb, { recursive: true, force: true });
mkdirSync(join(deb, 'control'), { recursive: true });
const kb = Math.ceil(Number(execFileSync('du', ['-sk', stage]).toString().split('\t')[0]));
writeFileSync(join(deb, 'control', 'control'), [
  'Package: crewhouse', `Version: ${version}`, 'Architecture: amd64', 'Maintainer: Crewhouse <crewhouse@users.noreply.github.com>',
  `Installed-Size: ${kb}`, 'Depends: bubblewrap', 'Recommends: xvfb', 'Section: utils', 'Priority: optional',
  'Homepage: https://github.com/umeranjum17/crewhouse',
  'Description: Your crew of AI helpers, at home, on the ChatGPT you already have',
  ' Chief and his helpers work on this computer; the phone app pairs with it.', '',
].join('\n'));
writeFileSync(join(deb, 'debian-binary'), '2.0\n');
sh('tar', ['-czf', join(deb, 'control.tar.gz'), '--owner=0', '--group=0', '-C', join(deb, 'control'), '.']);
sh('tar', ['-cJf', join(deb, 'data.tar.xz'), '--owner=0', '--group=0', '-C', stage, 'opt', 'usr']);
const out = join(dist, `crewhouse_${version}_amd64.deb`);
rmSync(out, { force: true });
sh('ar', ['rc', out, join(deb, 'debian-binary'), join(deb, 'control.tar.gz'), join(deb, 'data.tar.xz')]);
rmSync(deb, { recursive: true, force: true });
for (const f of [out, tgz]) console.log(`${f} (${Math.round(statSync(f).size / 1048576)} MB)`);
