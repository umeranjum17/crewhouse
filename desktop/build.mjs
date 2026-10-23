// Builds the desktop app for Linux x64: dist/desktop/Crewhouse-<version>-x86_64.AppImage and
// dist/desktop/crewhouse-desktop_<version>_amd64.deb. Electron shows the window and the tray; crewd runs on the Node the
// app carries (packaging/bundle.mjs), never on Electron's own. The engine is inside (crewd/runtime/openclaw, as in the runner's download), so a first open downloads nothing.
// Run after `npm run build:web` (repo root) and `npm ci` (here). Needs curl, tar and xz.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { build as bundle } from 'esbuild';
import { build } from 'electron-builder';
import { crewd, engine, node } from '../packaging/bundle.mjs';

const here = import.meta.dirname, repo = join(here, '..');
const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const dist = join(repo, 'dist'), stage = join(dist, 'desktop-stage'), out = join(dist, 'desktop');

// The engine set ships read-only, so an earlier build's stage needs write access back before it goes.
if (existsSync(stage)) execFileSync('chmod', ['-R', 'u+w', stage]);
for (const dir of [stage, out, join(here, 'out')]) { if (existsSync(dir)) chmodSync(dir, 0o755); rmSync(dir, { recursive: true, force: true }); }
node(dist, join(stage, 'node'));
engine(join(stage, 'crewd'), join(stage, 'node'), crewd(join(stage, 'crewd'), join(stage, 'node')), stage);

// The main process, bundled with what it reads from crewd's source (config, the tray's counts, the plain screen).
// ESM, so loadConfig's import.meta.dirname stays defined; CommonJS dependencies get a require of their own. The pairing
// code's sodium is the pure-JS one the web app runs (sodium-universal's browser mapping): no native addon in Electron.
await bundle({
  entryPoints: [join(here, 'main.mjs')], outfile: join(here, 'out', 'main.mjs'), bundle: true, platform: 'node', format: 'esm',
  target: 'node22', external: ['electron'], alias: { 'sodium-native': 'sodium-javascript' }, logLevel: 'warning',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
cpSync(join(repo, 'packaging', 'icons', 'crewhouse-32.png'), join(here, 'out', 'tray.png'));
cpSync(join(repo, 'packaging', 'icons', 'crewhouse-256.png'), join(here, 'out', 'icon.png'));

await build({
  projectDir: here, publish: 'never', linux: ['AppImage', 'deb'], x64: true,
  config: {
    appId: 'dev.crewhouse.desktop', productName: 'Crewhouse', executableName: 'crewhouse-desktop', extraMetadata: { version, desktopName: 'crewhouse-desktop.desktop' },
    directories: { output: out }, files: ['out/**', 'package.json'], asar: true,
    // crewd and its Node stay outside the asar: a real Node reads them from disk. A `from` folder's own top-level
    // node_modules is always left out, so crewd's dependencies are a resource of their own.
    extraResources: [{ from: join(stage, 'node'), to: 'node' }, { from: join(stage, 'crewd'), to: 'crewd' },
      { from: join(stage, 'crewd', 'node_modules'), to: 'crewd/node_modules' }],
    linux: {
      icon: join(repo, 'packaging', 'icons', 'crewhouse-512.png'), category: 'Utility', synopsis: 'Your crew of helpers, at home',
      description: 'Chief and his helpers work on this computer, on the AI plan you already have; the phone app pairs with it.',
    },
    appImage: { artifactName: 'Crewhouse-${version}-x86_64.AppImage' },
    // Helpers' shells need bubblewrap and their screens Xvfb, as the .deb from scripts/package.mjs.
    deb: {
      artifactName: 'crewhouse-desktop_${version}_amd64.deb', recommends: ['xvfb'],
      depends: ['bubblewrap', 'libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libsecret-1-0'],
    },
  },
});
for (const f of [`Crewhouse-${version}-x86_64.AppImage`, `crewhouse-desktop_${version}_amd64.deb`]) {
  console.log(`${join(out, f)} (${Math.round(statSync(join(out, f)).size / 1048576)} MB)`);
}
