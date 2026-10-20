// For chief-screen.sh: the scripted model (test/openclaw-stub.ts) and the library's renewal form, both on loopback.
// Writes `MODEL=<url>` (unless argv[4] is `real`) and `SITE=<url>` to the file named by argv[2]; the form's saved line goes to argv[3].
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startModelStub } from '../../test/openclaw-stub.ts';

const [, , env, saved, real] = process.argv, model = real ? undefined : await startModelStub();
const site = createServer((q, r) => {
  let body = '';
  q.on('data', (c) => { body += c; }).on('end', () => {
    if (q.method === 'POST') writeFileSync(saved, decodeURIComponent(body.replace(/\+/g, ' ')) + '\n');
    r.setHeader('content-type', 'text/html').end(q.method === 'POST' ? '<h1 style="font:28px sans-serif">Thanks, Umer. Your library card is renewed.</h1>'
      : '<body style="font:20px sans-serif;margin:24px"><h1>Riverside Library: renew your card</h1><form method="post"><p>Full name</p><input name="name" style="font:28px sans-serif;width:90%;height:160px"><p><button style="font:20px sans-serif">Renew</button></p></form></body>');
  });
}).listen(0, '127.0.0.1', () => writeFileSync(env, `${model ? `MODEL=${model.url}\n` : ''}SITE=http://127.0.0.1:${(site.address() as AddressInfo).port}/renew\n`));
