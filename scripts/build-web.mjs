// Bundles web/src into web/dist. The daemon serves web/dist; nothing here runs at request time.
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
const root = new URL('../web/', import.meta.url).pathname;
mkdirSync(root + 'dist', { recursive: true });
cpSync(root + 'index.html', root + 'dist/index.html');
await build({
  entryPoints: [root + 'src/main.tsx', root + 'src/styles.css'],
  outdir: root + 'dist', bundle: true, minify: true, sourcemap: true, target: 'es2022', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
});
console.log('web UI built into web/dist');
