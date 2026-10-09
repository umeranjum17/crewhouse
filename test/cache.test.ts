// An update must show on the next normal load: the shell is revalidated every time (a matching ETag is a 304),
// and the bundles are content-named so a new shell can never meet yesterday's JavaScript.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import type { Json } from '../web/src/api.ts';

const repo = join(import.meta.dirname, '..');
const build = (web: string) => spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), web], { encoding: 'utf8' });
const bundleRef = (html: string, name: 'main' | 'styles') => new RegExp(`${name}-[\\w-]{8}\\.${name === 'main' ? 'js' : 'css'}`).exec(html)?.[0];

test('a changed build gets new bundle names, and the built shell points at them', () => {
  // Build a copy of the web tree, so the checkout's own dist stays as the last real build. The copy sits beside a
  // symlink to the repo's src, which web/src/demo.ts imports across the tree, and esbuild finds packages through nodePaths.
  const parent = mkdtempSync(join(tmpdir(), 'crewhouse-web-'));
  cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
  symlinkSync(join(repo, 'src'), join(parent, 'src'), 'dir');
  const web = join(parent, 'web');
  assert.equal(build(web).status, 0, build(web).stderr);
  const shell = () => readFileSync(join(web, 'dist', 'index.html'), 'utf8');
  const js = bundleRef(shell(), 'main'), css = bundleRef(shell(), 'styles');
  assert.ok(js && css, `shell names hashed bundles, got: ${shell().match(/(?:src|href)="\/[^"]+"/g)?.join(' ')}`);

  writeFileSync(join(web, 'src', 'styles.css'), readFileSync(join(web, 'src', 'styles.css'), 'utf8') + '\n.root { top: 1px }\n');
  assert.equal(build(web).status, 0);
  const fresh = shell();
  assert.ok(css && !fresh.includes(css), 'the css reference changed with the content');
  assert.ok(fresh.includes(bundleRef(fresh, 'styles')!), 'the shell references the new bundle');
});

test('crewd serves the shell with no-cache and an ETag, and hashed bundles as immutable', async () => {
  if (!existsSync(join(repo, 'web', 'dist', 'index.html'))) assert.equal(build(repo + '/web').status, 0);
  const port = await new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
  const root = temp('crewhouse-cache');
  const env = { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') };
  const daemon: ChildProcess = spawn(process.execPath, [join(repo, 'src', 'main.ts')], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    let home!: Response;
    for (let end = Date.now() + 20_000; Date.now() < end; home = await fetch(base + '/').catch(() => home)) if (home?.ok) break;
    assert.ok(home?.ok, 'crewd answered');
    for (const path of ['/', '/index.html']) {
      const res = await fetch(base + path);
      assert.match(res.headers.get('cache-control') ?? '', /no-cache/, `${path} is revalidated`);
      assert.ok(res.headers.get('etag'), `${path} carries a validator`);
    }
    // The unchanged shell answers a revalidation with a 304; the changed one gets picked up whole.
    const same = await fetch(base + '/', { headers: { 'if-none-match': home.headers.get('etag')! } });
    assert.equal(same.status, 304);
    // The shell names a content-hashed bundle, and that bundle is cached forever.
    const html = await home.text();
    const js = bundleRef(html, 'main');
    assert.ok(js, `shell references a hashed bundle: ${html.match(/<script[^>]*>/g)?.join(' ')}`);
    const bundle = await fetch(`${base}/${js}`);
    assert.equal(bundle.status, 200);
    assert.match(bundle.headers.get('cache-control') ?? '', /immutable/);
    // The home-screen app: every launch screen the shell links and every picture its manifest names is served.
    const manifest = await (await fetch(base + '/manifest.webmanifest')).json();
    const assets = [...html.matchAll(/apple-touch-startup-image" href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(assets.length, 26, 'one launch screen per device size, day and night');
    assets.push(...[...manifest.icons, ...manifest.screenshots, ...manifest.shortcuts.flatMap((s: Json) => s.icons)].map((i: Json) => i.src));
    // A missing file would come back as the shell itself (the app's own routes), so the type is what tells.
    for (const src of assets) assert.match((await fetch(base + src)).headers.get('content-type') ?? '', /^image\//, src);
  } finally { daemon.kill(); }
});
