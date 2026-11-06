#!/usr/bin/env node
// Brings @byokit/pi in by its committed ref until it publishes: BYOKit at REF, at runtime/byokit (git-ignored, so no copy is
// kept in this repo), with the kit built and the one Pi its lockfile pins beside it. package.json's dev-only file: reference
// lands on that folder. A git reference cannot do this alone: npm's `#ref::path:packages/pi` keeps only the package's `files`,
// and BYOKit commits no dist. Only CREWHOUSE_ENGINE=pi needs it. Once the kit is on npm, this file and that reference go.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const REF = 'c3860d7f40f620e1fe4fcae0618ebe3fd7c982e7', URL = 'https://github.com/umeranjum17/byokit.git';
const dir = join(import.meta.dirname, '..', 'runtime', 'byokit'), built = join(dir, 'packages', 'pi', 'dist', 'index.js');
const sh = (cmd, ...args) => execFileSync(cmd, args, { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim();
const at = () => { try { return sh('git', 'rev-parse', 'HEAD'); } catch { return ''; } };

mkdirSync(dir, { recursive: true });
if (at() !== REF || !existsSync(built)) {
  if (!existsSync(join(dir, '.git'))) sh('git', 'init', '-q');
  sh('git', 'fetch', '-q', '--depth', '1', URL, REF);
  sh('git', 'checkout', '-q', '--detach', '--force', 'FETCH_HEAD');
  sh('npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '-w', 'packages/pi', '--include-workspace-root');
  sh('npx', 'tsc', '-b', 'packages/pi');
}
console.log(`@byokit/pi ready at ${REF.slice(0, 7)}`);
