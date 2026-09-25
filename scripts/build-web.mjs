// Bundles web/src into web/dist. The daemon serves web/dist; nothing here runs at request time.
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
const root = new URL('../web/', import.meta.url).pathname;
mkdirSync(root + 'dist', { recursive: true });
cpSync(root + 'index.html', root + 'dist/index.html');
cpSync(root + 'fonts', root + 'dist/fonts', { recursive: true });
cpSync(root + 'icon.svg', root + 'dist/icon.svg');
await build({
  entryPoints: [root + 'src/main.tsx', root + 'src/styles.css'],
  outdir: root + 'dist', bundle: true, minify: true, sourcemap: true, target: 'es2022', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
  // @desklink/react-native's browser build: its *.web.* files, with the few react-native names it needs shimmed.
  resolveExtensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.json'],
  alias: { 'react-native': root + 'src/rn-web.tsx' },
  external: ['/fonts/*'],
});
console.log('web UI built into web/dist');
