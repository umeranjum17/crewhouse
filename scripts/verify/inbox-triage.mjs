// A real crewd HTTP/chat drive on synthetic recorded Gmail + StubRuntime, never live Gmail/model judgement.
// done-done run inbox-triage; evidence goes only to the run's DEFAULT evidence root.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeSteps } from './steps.mjs';

const out = resolve(process.argv[2]), lab = mkdtempSync(join(tmpdir(), 'triage-'));
const fixture = JSON.parse(readFileSync(new URL('../../test/fixtures/inbox-stripe.json', import.meta.url), 'utf8'));
let arrived = false;
const requests = [], gmail = createServer((req, res) => {
  requests.push({ method: req.method, path: req.url });
  res.setHeader('content-type', 'application/json');
  const path = new URL(req.url, 'http://localhost').pathname, message = { threadId: fixture.thread, payload: { headers: [{ name: 'From', value: fixture.from }, { name: 'Subject', value: fixture.subject }], mimeType: 'text/html', body: { data: Buffer.from(fixture.html).toString('base64url') } } };
  if (path === '/oauth2/token') return res.end(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly' }));
  const data = path.endsWith('/profile') ? { historyId: '1' } : path.endsWith('/history') ? { historyId: arrived ? '2' : '1', history: arrived && req.url.includes('startHistoryId=1') ? [{ messagesAdded: [{ message: { id: '18c0000000000099', labelIds: ['INBOX'] } }] }] : [] }
    : path.includes('/messages/') ? message : { messages: [message] };
  res.end(JSON.stringify(data));
});
await new Promise((r) => gmail.listen(0, '127.0.0.1', r));
const exec = promisify(execFile), path = `/usr/bin:/bin:${process.env.PATH}`;
for (const d of ['home', 'state', 'crew', 'tools', 'run']) mkdirSync(join(lab, d));
process.env = { PATH: path, LANG: 'C.UTF-8', HOME: join(lab, 'home'), TMPDIR: lab,
  XDG_CONFIG_HOME: join(lab, 'config'), XDG_DATA_HOME: join(lab, 'data'), XDG_STATE_HOME: join(lab, 'state'), XDG_CACHE_HOME: join(lab, 'cache'), XDG_RUNTIME_DIR: join(lab, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${lab}/no-bus`,
  CREWHOUSE_ENGINE: 'stub', CREWHOUSE_STUB_GOLDEN: '1', CREWHOUSE_PORT: '0', CREWHOUSE_STATE_DIR: join(lab, 'state'), CREWHOUSE_CREW_DIR: join(lab, 'crew'), CREWHOUSE_TOOLS_DIR: join(lab, 'tools'), CREWHOUSE_GOOGLE_CLIENT: join(lab, 'absent-client'),
  CREWHOUSE_GOOGLE_EMULATOR: `http://127.0.0.1:${gmail.address().port}` };
const [{ loadConfig }, { Store }, { Crew }, { startServer }, { signInApp }] = await Promise.all([
  import('../../src/config.ts'), import('../../src/db.ts'), import('../../src/crew.ts'), import('../../src/server.ts'), import('../../test/connect-fixture.ts')]);
const cfg = loadConfig(), db = new Store(cfg.stateDir), crew = new Crew(cfg, db);
let server;
try {
  crew.init(); server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${server.address().port}`, key = readFileSync(join(cfg.stateDir, 'person.key'), 'utf8').trim();
  const api = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${key}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); assert.ok(r.ok, `${path}: ${r.status}`); return r.json(); };
  await api('POST', '/api/onboard', { address: 'Umer' });
  await signInApp(crew.connections, 'gmail'); // local synthetic provider only, no real sign-in or device code
  crew.schedule();
  const routine = db.get('SELECT id FROM routines WHERE mailwatch = 1');
  await api('POST', `/api/routines/${routine.id}/run`, {});
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', routine.id).n, 0);
  db.run('INSERT INTO cases (thread, sender, facts, updated_at) VALUES (?, ?, ?, ?)', fixture.contextThread, 'alerts@railway.example', fixture.context, Date.now());
  arrived = true;
  await api('POST', `/api/routines/${routine.id}/run`, {});
  for (const end = Date.now() + 30_000; !db.get("SELECT 1 FROM tasks WHERE routine = ? AND state = 'done'", routine.id); ) {
    assert.ok(Date.now() < end, 'watch finishes'); await new Promise((r) => setTimeout(r, 20));
  }
  const page = await api('GET', '/api/bots/chief'), alert = page.messages.filter((m) => m.author === 'bot' && m.text === fixture.reply);
  assert.equal(alert.length, 1);
  const task = db.get('SELECT * FROM tasks WHERE routine = ?', routine.id), spec = crew.runtime.specOf(task.session), transcript = crew.runtime.transcript(task.session);
  assert.match(spec.message, /Railway incident/); assert.match(transcript, /fixture-brotli\?source=stripe&kind=security/);
  await api('POST', `/api/routines/${routine.id}/run`, {});
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', routine.id).n, 1);
  assert.ok(requests.filter((r) => r.path.startsWith('/gmail/')).every((r) => r.method === 'GET'));
  writeFileSync(join(out, 'api-proof.json'), JSON.stringify({ mode: 'synthetic recorded Gmail + scripted engine, not live ranking', alert: alert[0].text, taskCount: 1, quietPoll: true, sends: 0, requests, contextDelivered: spec.message.includes(fixture.context), sourceRead: transcript }, null, 2));
  const steps = [{ name: 'private-launch', url: `${base}/#person=${key}`, settle: 0 }, { name: 'authority-ready', wait: "!!sessionStorage.getItem('crewhouse.person')" }];
  for (const look of ['day', 'night']) for (const width of [390, 1440]) steps.push(
    { name: `${look}-${width}`, w: width, h: 1000, mobile: width === 390, url: `${base}/?${look}#/chief`, settle: 0 },
    { name: 'alert-ready', wait: "document.body.innerText.includes('Which deployed app uses this Stripe account?')" },
    { name: 'paint-ready', eval: "(async()=>{await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return true;})()" },
    { name: `geometry-${look}-${width}`, eval: "({width:innerWidth, overflow:document.documentElement.scrollWidth>innerWidth, scrollContainers:[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).overflowY==='auto'&&e.scrollHeight>e.clientHeight).length, links:[...document.querySelectorAll('a')].filter(a=>a.href.includes('fixture-brotli')||a.href.includes('/#inbox/')).map(a=>({text:a.textContent,href:a.href}))})", out: join(out, `chief-${width}-${look}.png`) });
  const plan = join(lab, 'browser-plan.json');
  writeFileSync(plan, JSON.stringify({ bin: '/usr/bin/chromium', profile: join(lab, 'profile'), home: join(lab, 'home'), args: ['--no-sandbox', '--disable-dev-shm-usage', 'about:blank'], steps }));
  const { stdout } = await exec(process.execPath, [resolve(import.meta.dirname, 'pwa-shell.mjs'), plan], { timeout: 180_000, maxBuffer: 1024 * 1024 });
  writeFileSync(join(out, 'browser-proof.txt'), stdout.replaceAll(lab, '<lab>'));
  const results = JSON.parse(stdout);
  assert.ok(results.every((r) => !r.error));
  assert.ok(results.filter((r) => r.step?.startsWith('geometry-')).every((r) => !r.value.overflow && r.value.links.length === 2));
  writeSteps(out, 'inbox-triage');
  console.log('PASS: one scripted linked alert reaches Chief through real HTTP; quiet poll creates no task; Gmail receives GETs only. Not live-model, native-phone or installed-PWA proof.');
} finally {
  if (server) await new Promise((r) => server.close(r));
  await crew.stop(); db.close(); await new Promise((r) => gmail.close(r));
  rmSync(lab, { recursive: true, force: true });
}
