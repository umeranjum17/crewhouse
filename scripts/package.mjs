// Builds the one download: dist/crewhouse_<version>_amd64.deb (Debian and Ubuntu: open it and the software centre
// installs it, bubblewrap and Xvfb included) and dist/crewhouse-<version>-linux-x64.tar.gz (the same folder, anywhere).
// Both carry their own Node (pinned, checksum-verified), crewd, the built web app and the launcher, under /opt/crewhouse.
// Run after `npm run build:web`. Needs curl, tar, xz and ar (binutils).
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { crewd, engine, node } from '../packaging/bundle.mjs';

const repo = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const dist = resolve(process.argv[2] || join(repo, 'dist'));
const stage = join(dist, 'stage');
const opt = join(stage, 'opt', 'crewhouse');
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

// The engine set ships read-only, so an earlier build's stage needs write access back before it goes.
if (existsSync(stage)) sh('chmod', ['-R', 'u+w', stage]);
rmSync(stage, { recursive: true, force: true });
node(dist, join(opt, 'node'));
const app = join(opt, 'app');
const bundledEnv = crewd(app, join(opt, 'node'));
engine(app, join(opt, 'node'), bundledEnv, stage);

// The launcher, the menu entry and the icon.
for (const name of ['launch.mjs', 'trouble.mjs']) cpSync(join(repo, 'packaging', name), join(opt, name));
mkdirSync(join(stage, 'usr', 'share', 'applications'), { recursive: true });
cpSync(join(repo, 'packaging', 'crewhouse.desktop'), join(stage, 'usr', 'share', 'applications', 'crewhouse.desktop'));
for (const px of [16, 24, 32, 48, 64, 128, 256, 512]) {
  const dir = join(stage, 'usr', 'share', 'icons', 'hicolor', `${px}x${px}`, 'apps');
  mkdirSync(dir, { recursive: true });
  cpSync(join(repo, 'packaging', 'icons', `crewhouse-${px}.png`), join(dir, 'crewhouse.png'));
}
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
  `Installed-Size: ${kb}`, 'Depends: bubblewrap', 'Recommends: xvfb, poppler-utils', 'Section: utils', 'Priority: optional',
  'Homepage: https://github.com/umeranjum17/crewhouse',
  'Description: Your crew of AI helpers, at home, on the AI plan you already have',
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
