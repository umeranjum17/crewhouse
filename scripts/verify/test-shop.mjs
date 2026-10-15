// A local test shop with a sign-in page, for the site sign-in proof (features/site-signin.md). Usage: node test-shop.mjs <port>
// Any email and password signs in; nothing is stored. Serves its own icon at /favicon.ico.
import { createServer } from 'node:http';

const port = Number(process.argv[2]);
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#E4572E"/><path d="M18 26h28l-3 22H21z" fill="#fff"/><path d="M25 26a7 7 0 0 1 14 0" stroke="#fff" stroke-width="4" fill="none"/></svg>`;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>Corner Shop</title><link rel="icon" href="/favicon.ico">
<style>body{font:18px system-ui,sans-serif;background:#faf7f2;margin:0}header{background:#E4572E;color:#fff;padding:18px 40px;font-weight:700;font-size:24px}
main{max-width:420px;margin:60px auto;background:#fff;padding:32px;border-radius:14px;box-shadow:0 4px 24px #0002}
input{display:block;width:100%;box-sizing:border-box;font-size:18px;padding:10px;margin:6px 0 16px;border:1px solid #ccc;border-radius:8px}
button{font-size:18px;padding:12px 20px;background:#E4572E;color:#fff;border:0;border-radius:8px;width:100%}</style></head>
<body><header>Corner Shop</header><main>${body}</main></body></html>`;

createServer((req, res) => {
  const signed = /(^|; )who=/.test(req.headers.cookie ?? '');
  if (req.url === '/favicon.ico') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(icon); }
  if (req.method === 'POST' && req.url === '/login') {
    let b = ''; req.on('data', (c) => { b += c; });
    return req.on('end', () => { res.writeHead(303, { location: '/orders', 'set-cookie': 'who=umer; Path=/; HttpOnly' }); res.end(); });
  }
  if (req.url === '/logout') { res.writeHead(303, { location: '/login', 'set-cookie': 'who=; Path=/; Max-Age=0' }); return res.end(); }
  if (req.url === '/orders' && signed) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page('<h2>Hi Umer</h2><p>Your orders: 3</p><p>Desk lamp · arriving Tuesday</p>')); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page('<h2>Sign in</h2><form method="post" action="/login"><label>Email<input name="email" type="email" autocomplete="username"></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form>'));
}).listen(port, '127.0.0.1', () => console.log(`site on http://shop.localhost:${port}/login`));
