// Serve the built web shell (web/dist) from a public-style origin for PWA verification.
// crewd answers only loopback (src/server.ts), so the published shell's situation is a
// *.localhost host — loopback to the browser, but not a loopback name to the app's own
// boot decision (web/src/api.ts). Usage: node serve-web.mjs <dir> [port]
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const dir = normalize(process.argv[2] ?? 'web/dist');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json' };
const handler = (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  const file = join(dir, p);
  if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
};

// Bind both loopback stacks so a browser resolving *.localhost to either one still connects.
// One port for both: reserve an OS-assigned free port first when none is given (never a fixed one).
const one = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => resolve(s)); });
const port = Number(process.argv[3]) || one.address().port;
await new Promise((resolve) => one.close(resolve));
let bound = 0;
const done = () => { if (++bound === 2) console.log(`serving ${dir} on http://crewhouse.localhost:${port}/`); };
for (const host of ['127.0.0.1', '::1']) createServer(handler).listen(port, host, done);
