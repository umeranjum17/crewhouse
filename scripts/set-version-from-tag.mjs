// A release build ships the version its tag names: cloud-vX.Y.Z / linux-vX.Y.Z[-suffix] sets package.json (and the lockfile, and the desktop app's).
// Usage: node scripts/set-version-from-tag.mjs <tag> [dir]. A tag in any other shape fails the build before anything is written.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const tag = process.argv[2] ?? '';
const dir = process.argv[3] ?? new URL('..', import.meta.url).pathname;
const version = /^(?:cloud|linux)-v(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(tag)?.[1];
if (!version) { console.error(`release tag "${tag}" is not cloud-vX.Y.Z or linux-vX.Y.Z`); process.exit(1); }
for (const f of ['package.json', 'package-lock.json', 'desktop/package.json']) {
  const p = join(dir, f);
  if (!existsSync(p)) continue;
  const j = JSON.parse(readFileSync(p, 'utf8'));
  j.version = version;
  if (j.packages?.['']) j.packages[''].version = version;
  writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}
console.log(`version ${version} from tag ${tag}`);
