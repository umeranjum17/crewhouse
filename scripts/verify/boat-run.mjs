// A real boat.dev run for the cloud connect (docs/verification/where-cloud.md) on the one long-lived fleet key in
// $BOAT_KEY_FILE (mode 600). With no file yet, it makes the one claim (the kit's claim(): a link and code a person
// approves, for $BOAT_EMAIL) and saves the key there. The key is never printed, never revoked; each run deletes the
// computer it made. Driver control uses <out>/ctrl.sock (mode 600):
//   GET /list, /make, /deliver, /cost, /cleanup, /me, /stop
//   /stop cleans up and exits (also on SIGTERM/SIGINT)
//   curl --unix-socket <out>/ctrl.sock http://x/<action>
//   BOAT_KEY_FILE=… [BOAT_EMAIL=…] node scripts/verify/boat-run.mjs <adb server port> <serial> <out dir>
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const [adbPort, serial, out] = process.argv.slice(2);
const socket = join(out, 'ctrl.sock');
const need = createRequire(`${process.cwd()}/package.json`);
const { claim } = await import(need.resolve('@byokit/cloud'));
const { provider, BOAT } = await import(new URL('web/src/cloud.ts', `file://${process.cwd()}/`).href);
const file = process.env.BOAT_KEY_FILE, email = process.env.BOAT_EMAIL; delete process.env.BOAT_EMAIL;
if (!file) { console.error('BOAT_KEY_FILE unset'); process.exit(2); }
const log = (o) => { const line = JSON.stringify({ at: new Date().toISOString(), ...o }); console.log(line); };
const started = new Date();
let key = existsSync(file) ? readFileSync(file, 'utf8').trim() : '', mine = null;
if (!key) {
  if (!email) { console.error('no key file yet and BOAT_EMAIL unset'); process.exit(2); }
  for await (const s of claim({ baseUrl: BOAT.api, email })) {
    if (s.step === 'done') { key = s.key; writeFileSync(file, key + '\n', { mode: 0o600, flag: 'wx' }); log({ step: 'done', saved: file, expires: s.expires, scopes: s.scopes }); break; }
    log(s.step === 'failed' ? s : { step: s.step, url: s.url, code: s.code });
    if (s.step === 'failed') process.exit(1);
  }
}
const p = provider(async () => key);
const raw = (method, path) => fetch(`${BOAT.api}${path}`, { method, headers: { authorization: `Bearer ${key}`, accept: 'application/json' } });
const acts = {
  list: async () => (await p.list()).map((r) => ({ id: r.id, mine: r.id === mine?.id })),
  make: async () => {
    if (mine) return { id: mine.id, already: true };
    mine = await p.create({ name: 'crewhouse-proof', size: 'small', keepCopies: false, idempotencyKey: `crewhouse-proof-${started.getTime()}` });
    writeFileSync(`${out}/mine.json`, JSON.stringify({ id: mine.id, made: new Date().toISOString() }) + '\n');
    return { id: mine.id };
  },
  // adb shell re-parses its arguments on the device: deliver only a key of plain characters, quoted.
  deliver: async () => {
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) return { delivered: false, why: 'the key has characters adb input cannot carry', length: key.length };
    try { execFileSync('adb', ['-P', adbPort, '-s', serial, 'shell', `input text '${key}'`], { stdio: 'ignore' }); }
    catch { return { delivered: false, why: 'adb input failed' }; } // its message would carry the command line
    return { delivered: true, length: key.length };
  },
  cost: async () => mine ? p.usage(mine, started.toISOString()) : { none: true },
  cleanup: async () => {
    if (!mine) return { none: true };
    const cost = await p.usage(mine, started.toISOString()).catch((e) => ({ error: String(e.message) }));
    await p.remove(mine, mine.id); const gone = mine.id; mine = null;
    return { removed: gone, cost };
  },
  me: async () => ({ me: (await raw('GET', '/me')).status }),
};
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  for (const a of ['cleanup']) { try { log({ [a]: await acts[a]() }); } catch (e) { log({ [a]: 'error', why: String(e?.message ?? e) }); } }
  key = ''; process.exit(0);
};
process.on('SIGTERM', stop); process.on('SIGINT', stop);
try { unlinkSync(socket); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const server = http.createServer(async (q, r) => {
  const a = acts[q.url.slice(1)];
  if (q.url === '/stop') { r.end('stopping\n'); return void stop(); }
  try { const v = a ? await a() : { unknown: q.url }; log({ [q.url.slice(1)]: v }); r.end(JSON.stringify(v) + '\n'); }
  catch (e) { const v = { error: String(e?.code ?? ''), why: String(e?.message ?? e) }; log({ [q.url.slice(1)]: v }); r.end(JSON.stringify(v) + '\n'); }
});
const mask = process.umask(0o177);
server.listen(socket, () => { chmodSync(socket, 0o600); process.umask(mask); log({ ready: socket }); });
