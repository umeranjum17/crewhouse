// What every download carries beside its launcher: its own Node (pinned, checksum-verified) and crewd with its
// production dependencies. scripts/package.mjs (the .deb and .tar.gz) and desktop/build.mjs (the desktop app) use it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const NODE = '24.21.0';
const NODE_SHA256 = 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6'; // node-v24.21.0-linux-x64.tar.xz
const repo = new URL('..', import.meta.url).pathname;
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

/** Node, as nodejs.org ships it, checked against the pinned checksum and unpacked into `dest`; the tarball is kept in `cache`. */
export function node(cache, dest) {
  const tarball = join(cache, `node-v${NODE}-linux-x64.tar.xz`);
  mkdirSync(cache, { recursive: true });
  if (!existsSync(tarball)) sh('curl', ['-fsSLo', tarball, `https://nodejs.org/dist/v${NODE}/node-v${NODE}-linux-x64.tar.xz`]);
  const sum = createHash('sha256').update(readFileSync(tarball)).digest('hex');
  if (sum !== NODE_SHA256) { rmSync(tarball); throw new Error(`Node checksum mismatch: ${sum}`); }
  mkdirSync(dest, { recursive: true });
  sh('tar', ['-xJf', tarball, '-C', dest, '--strip-components=1']);
}

/** crewd and what it reads at run time, copied into `app`; production dependencies only, installed with the bundled npm.
 *  Returns the environment that puts that Node first. */
export function crewd(app, nodeDir) {
  if (!existsSync(join(repo, 'web', 'dist', 'index.html'))) throw new Error('build the web app first: npm run build:web');
  for (const part of ['src', 'templates', 'tools', 'skills', 'relay', 'crewhouse', 'package.json', 'package-lock.json', '.npmrc']) {
    if (existsSync(join(repo, part))) cpSync(join(repo, part), join(app, part), { recursive: true });
  }
  cpSync(join(repo, 'web', 'dist'), join(app, 'web', 'dist'), { recursive: true });
  mkdirSync(join(app, 'scripts'), { recursive: true });
  for (const name of ['prepare-engine.mjs', 'headless.mjs']) cpSync(join(repo, 'scripts', name), join(app, 'scripts', name));
  const env = { ...process.env, PATH: `${join(nodeDir, 'bin')}:${process.env.PATH}` };
  sh(join(nodeDir, 'bin', 'npm'), ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: app, env });
  return env;
}

/** The AI engine, installed into `app`/runtime/openclaw so a download starts with it (Config.engineDir finds it there);
 *  `scratch` holds the kit's build-time state and is removed. `env` is what crewd() returned. */
export function engine(app, nodeDir, env, scratch) {
  const state = join(scratch, 'engine-prepare');
  // The build is an isolated run: a builder's own XDG or CREWHOUSE_* folders would overlap their Crewhouse and be refused.
  const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !/^(XDG_|CREWHOUSE_)/.test(k)));
  sh(join(nodeDir, 'bin', 'node'), ['scripts/prepare-engine.mjs', state], { cwd: app, env: { ...clean, CREWHOUSE_ENGINE_DIR: join(app, 'runtime', 'openclaw') } });
  // Since kit 0.6.2 the engine installs as a verified read-only set; audit the installed set, not the engine dir.
  const set = readFileSync(join(state, 'openclaw', 'engine-set'), 'utf8').trim();
  sh(join(nodeDir, 'bin', 'npm'), ['audit', 'signatures', '--prefix', set], { cwd: app, env });
  // The kit patches a copy of the stock set and keeps both; the engine runs only the patched one, so only it ships
  // (the stock copy is a second ~900 MB tree: it nearly doubled the download).
  for (const name of readdirSync(dirname(set)).filter((n) => join(dirname(set), n) !== set)) {
    sh('chmod', ['-R', 'u+w', join(dirname(set), name)]);
    rmSync(join(dirname(set), name), { recursive: true });
  }
  // The kit locks its engine folders to 0700 for the build user; dpkg unpacks them root-owned, and crewd runs as the
  // person, who then cannot read the engine it was given. Everyone reads it; only crewd's own state stays private.
  sh('chmod', ['-R', 'a+rX', join(app, 'runtime')]);
  rmSync(state, { recursive: true, force: true });
}
