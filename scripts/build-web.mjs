// Bundles web/src into web/dist. The daemon serves web/dist; nothing here runs at request time.
// An optional web-tree argument (tests) builds a copy of the tree instead of the checkout's own.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
const root = process.argv[2] ? resolve(process.argv[2]) + '/' : new URL('../web/', import.meta.url).pathname;
// A fresh dist each time: yesterday's bundles must not linger under names nothing references any more.
rmSync(root + 'dist', { recursive: true, force: true });
mkdirSync(root + 'dist', { recursive: true });
cpSync(root + 'index.html', root + 'dist/index.html');
cpSync(root + 'fonts', root + 'dist/fonts', { recursive: true });
// Icons are drawn from Chief's bitmaps by scripts/icons.mjs.
for (const f of ['icon.svg', 'favicon.svg', 'notify.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'notify-96.png']) cpSync(root + f, root + 'dist/' + f);
cpSync(root + 'manifest.webmanifest', root + 'dist/manifest.webmanifest'); // "Share to Crewhouse" from the phone's Share sheet
// Content-named bundles: the browser caches each build forever, and a changed build simply gets a new name.
const built = await build({
  entryPoints: [root + 'src/main.tsx', root + 'src/styles.css'],
  // Split so a dynamic import() is its own file: three.js (the office's 3D room) loads only once Home has painted.
  entryNames: '[name]-[hash]', chunkNames: 'chunk-[hash]', splitting: true, format: 'esm', metafile: true,
  nodePaths: [new URL('../node_modules/', import.meta.url).pathname], // a copy of the tree built from elsewhere still resolves this checkout's packages
  outdir: root + 'dist', bundle: true, minify: true, sourcemap: true, target: 'es2022', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
  // @desklink/react-native's browser build: its *.web.* files, with the few react-native names it needs shimmed.
  resolveExtensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.json'],
  alias: { 'react-native': root + 'src/rn-web.tsx' },
  external: ['/fonts/*'],
});
// The shell must name the hashed entry bundles, or the browser would never find them; chunks are found by import().
let html = readFileSync(root + 'dist/index.html', 'utf8');
for (const [f, o] of Object.entries(built.metafile.outputs)) {
  if (o.entryPoint?.endsWith('styles.css') && /\.css$/.test(f)) html = html.replace('/styles.css', '/' + basename(f));
  if (o.entryPoint?.endsWith('main.tsx') && /\.js$/.test(f)) html = html.replace('/main.js', '/' + basename(f));
}
writeFileSync(root + 'dist/index.html', html);
console.log('web UI built into ' + root + 'dist');
