// Bundles web/src into web/dist. The daemon serves web/dist; nothing here runs at request time.
// An optional web-tree argument (tests) builds a copy of the tree instead of the checkout's own.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
const root = process.argv[2] ? resolve(process.argv[2]) + '/' : new URL('../web/', import.meta.url).pathname;
// A fresh dist each time: yesterday's bundles must not linger under names nothing references any more.
rmSync(root + 'dist', { recursive: true, force: true });
mkdirSync(root + 'dist', { recursive: true });
cpSync(root + 'index.html', root + 'dist/index.html');
cpSync(root + 'fonts', root + 'dist/fonts', { recursive: true });
// Each app/plugin's own official logo (web/marks/), served as-is at /marks/.
cpSync(root + 'marks', root + 'dist/marks', { recursive: true });
// Icons are drawn from Chief's bitmaps by scripts/icons.mjs.
for (const f of ['icon.svg', 'favicon.svg', 'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'notify.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icon-maskable-192.png', 'apple-touch-icon.png', 'notify-96.png']) cpSync(root + f, root + 'dist/' + f);
cpSync(root + 'manifest.webmanifest', root + 'dist/manifest.webmanifest'); // "Share to Crewhouse" from the phone's Share sheet
// iOS launch screens and the install sheet's screenshots, both drawn and captured ahead of time (scripts/icons.mjs, web/shots/).
for (const d of ['splash', 'shots']) cpSync(root + d, root + 'dist/' + d, { recursive: true });
// Content-named bundles: the browser caches each build forever, and a changed build simply gets a new name.
const built = await build({
  entryPoints: [root + 'src/main.tsx', root + 'src/styles.css'],
  // Split so a dynamic import() is its own file: the ?demo crew loads only when asked for.
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
// Each launch screen matches one device size and the phone's light or dark setting by its file name (WxH@density-look).
html = html.replace('</head>', readdirSync(root + 'splash').map((f) => {
  const [, w, h, d, look] = /^(\d+)x(\d+)@(\d)-(day|night)\.png$/.exec(f) ?? [];
  return `  <link rel="apple-touch-startup-image" href="/splash/${f}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${d}) and (prefers-color-scheme: ${look === 'night' ? 'dark' : 'light'})" />\n`;
}).join('') + '</head>');
writeFileSync(root + 'dist/index.html', html);

// The service worker: it precaches the whole shell at install, so a cold offline reload serves the app itself. The
// list and cache name are known only here and injected; the worker bundles no app code (web/src/sw.ts is standalone).
const dist = root + 'dist';
const precache = ['/']; // every navigation, deep links included, is answered by the cached index at '/'
// The precache is the app shell the running app itself fetches. The iOS launch screens (splash/), the install
// sheet's screenshots (shots/), the notification glyph's source svg and the font licence texts are served but fetched
// on demand (or never by the app at all), so they cost a cold install nothing.
const digest = createHash('sha256'); // any changed file, precached or not, gives the worker a new cache name and so an update
const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) {
  const p = dir + '/' + e.name, url = '/' + relative(dist, p).split(sep).join('/');
  if (e.isDirectory()) walk(p);
  else if (e.name !== 'sw.js' && !e.name.endsWith('.map')) { digest.update(url).update(readFileSync(p)); if (e.name !== 'index.html' && !/^\/(?:splash|shots)\//.test(url) && e.name !== 'notify.svg' && !e.name.endsWith('.txt')) precache.push(url); }
} };
walk(dist);
await build({
  entryPoints: [root + 'src/sw.ts'], outfile: dist + '/sw.js', bundle: true, format: 'iife', minify: true, target: 'es2022', logLevel: 'warning',
  nodePaths: [new URL('../node_modules/', import.meta.url).pathname],
  define: { __PRECACHE__: JSON.stringify(precache), __CACHE__: JSON.stringify('crewhouse-' + digest.digest('hex').slice(0, 8)) },
});
console.log('web UI built into ' + dist);
