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
const { PWA, DISPLAY } = process.env; // xvfb-run's screen, for the installed app's window only (crewd's env is built below)
const fixture = JSON.parse(readFileSync(new URL('../../test/fixtures/inbox-stripe.json', import.meta.url), 'utf8'));
let arrived = false, down = false;
const requests = [], gmail = createServer((req, res) => {
  requests.push({ method: req.method, path: req.url });
  res.setHeader('content-type', 'application/json');
  const path = new URL(req.url, 'http://localhost').pathname, message = { threadId: fixture.thread, payload: { headers: [{ name: 'From', value: fixture.from }, { name: 'Subject', value: fixture.subject }], mimeType: 'text/html', body: { data: Buffer.from(fixture.html).toString('base64url') } } };
  if (down && path.endsWith('/profile')) { res.statusCode = 503; return res.end(JSON.stringify({ error: { code: 503, message: 'Service Unavailable' } })); }
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
  // Gmail down first: crewd's one line with its cause, then the next run baselines old mail.
  down = true; await api('POST', `/api/routines/${routine.id}/run`, {});
  for (const end = Date.now() + 30_000; !db.get("SELECT 1 FROM messages WHERE bot = 'chief' AND author = 'system' AND text LIKE 'Mail watch couldn''t check Gmail:%'"); ) {
    assert.ok(Date.now() < end, 'the Gmail failure is said'); await new Promise((r) => setTimeout(r, 20));
  }
  down = false; await api('POST', `/api/routines/${routine.id}/run`, {});
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
  writeFileSync(join(out, 'api-proof.json'), JSON.stringify({ mode: 'synthetic recorded Gmail + scripted engine, not live ranking', alert: alert[0].text, taskCount: 1, quietPoll: true, sends: 0, requests, contextDelivered: spec.message.includes(fixture.context), sourceRead: transcript, gmailDown: db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'system' AND text LIKE 'Mail watch couldn''t check Gmail:%'").text }, null, 2));
  const steps = [{ name: 'private-launch', url: `${base}/#person=${key}`, settle: 0 }, { name: 'authority-ready', wait: "!!sessionStorage.getItem('crewhouse.person')" }];
  const painted = "(async()=>{await document.fonts.ready; await Promise.allSettled(document.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished)); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return true;})()";
  // The alert card: its source rows (where each goes, 44px to tap), the one question apart, and crewd's Gmail failure above.
  const card = "(()=>{const c=[...document.querySelectorAll('.inbox')].at(-1);return {width:innerWidth, overflow:document.documentElement.scrollWidth>innerWidth, wide:[...document.querySelectorAll('.lines *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).length, rows:[...c.querySelectorAll('.inbox-src a')].map(a=>({text:a.innerText.replace(/\\s+/g,' ').trim(),href:a.href,h:Math.round(a.getBoundingClientRect().height)})), links:[...c.querySelectorAll('a')].map(a=>a.href), lead:c.querySelector('.inbox-lead')?.innerText, ask:c.querySelector('.inbox-ask .chat-md')?.innerText, answer:!!c.querySelector('.inbox-ask button'), down:document.querySelector('.inbox-down')?.innerText.replace(/\\s+/g,' ')}})()";
  for (const look of ['day', 'night']) for (const width of [390, 1440]) steps.push(
    { name: `${look}-${width}`, w: width, h: 1000, mobile: width === 390, url: `${base}/?${look}#/chief`, settle: 0 },
    { name: 'alert-ready', wait: "document.body.innerText.includes('Which deployed app uses this Stripe account?')" },
    { name: 'paint-ready', eval: painted },
    { name: `geometry-${look}-${width}`, eval: card, out: join(out, `chief-${width}-${look}.png`) });
  // The quiet side: Mail watch's own runs on Routines, in inbox words.
  for (const look of ['day', 'night']) steps.push(
    { name: `routines-${look}`, w: 390, h: 1000, mobile: true, url: `${base}/?${look}&r=${look}#/routines`, settle: 0 },
    { name: 'runs-ready', wait: "document.body.innerText.includes('Mail watch')" },
    { name: 'runs-open', eval: "(()=>{document.querySelectorAll('details.routine-runs').forEach(d=>d.open=true);return true})()" },
    { name: 'paint-ready', eval: painted },
    { name: `runs-${look}`, eval: "document.querySelector('.routine-runs').innerText", out: join(out, `routines-390-${look}.png`) });
  // The follow-up: Answer puts the person in the box, and the reply lands under the alert.
  steps.push(
    { name: 'answer-open', w: 390, h: 1000, mobile: true, url: `${base}/?day&r=answer#/chief`, settle: 0 },
    { name: 'answer-ready', wait: "!!document.querySelector('.inbox-ask button')" },
    { name: 'answer-tap', click: '.inbox-ask button', settle: 300 },
    { name: 'answer-box', eval: "({tag:document.activeElement?.tagName, inDock:!!document.activeElement?.closest('.dock'), placeholder:document.activeElement?.placeholder, to:document.querySelector('.reply-to')?.innerText.replace(/\\s+/g,' ')})" },
    { name: 'answer-type', eval: "document.execCommand('insertText', false, 'The UmerTech billing app on Railway.')", out: join(out, 'chief-390-day-answering.png') },
    { name: 'answer-send', click: '.dock button.send', settle: 300 },
    { name: 'answer-landed', wait: "!!document.querySelector('.line.me:not(.sending) blockquote') && !document.querySelector('.inbox-ask button, .reply-to')" },
    { name: 'paint-ready', eval: painted },
    { name: 'answered', eval: card, out: join(out, 'chief-390-day-answered.png') });
  if (PWA) { // the installed app (docs/verification/pwa-shell.md), under xvfb-run: the alert in its standalone window
    const phone = { w: 390, h: 844, dpr: 2, mobile: true }, shown = "!!document.querySelector('.inbox-ask button')", app = join(lab, 'pwa');
    const pwa = [{ name: 'open', url: `${base}/#person=${key}`, settle: 3000 }, { name: 'settings', url: `${base}/#/settings`, settle: 3000 },
      { name: 'install', click: '.install .btn', settle: 3000 }, { name: 'tab', key: 'Tab' }, { name: 'return', key: 'Return', settle: 3000 },
      { name: 'attach', attachApp: base }, { name: 'standalone', eval: "matchMedia('(display-mode: standalone)').matches" },
      ...['day', 'night'].flatMap((look) => [{ name: `${look}-390`, ...phone, url: `${base}/?${look}#/chief`, settle: 2500 }, { name: `${look}-390-wait`, wait: shown, timeout: 20000 },
        { name: `${look}-390-shot`, eval: "[matchMedia('(display-mode: standalone)').matches, document.documentElement.scrollWidth <= innerWidth, document.querySelectorAll('.inbox-src a').length === 2]", out: join(out, `pwa-chief-390-${look}.png`) }]),
      { name: 'wide', win: [1280, 900], url: `${base}/?day#/chief`, settle: 2500 }, { name: 'wide-wait', wait: shown, timeout: 20000 }, { name: 'wide-shot', wshot: join(out, 'pwa-chief-1280-day.png') }];
    writeFileSync(join(lab, 'pwa-plan.json'), JSON.stringify({ profile: join(app, 'profile'), home: join(app, 'home'), headless: false, xkey: resolve(import.meta.dirname, 'xkey.py'),
      args: ['--window-size=1400,950', '--force-device-scale-factor=1', 'about:blank'], steps: pwa }));
    const ran = JSON.parse((await exec(process.execPath, [resolve(import.meta.dirname, 'pwa-shell.mjs'), join(lab, 'pwa-plan.json')], { timeout: 120_000, maxBuffer: 1024 * 1024, env: { ...process.env, DISPLAY } })).stdout);
    writeFileSync(join(out, 'pwa-run.json'), JSON.stringify(ran, null, 1).replaceAll(lab, '<lab>'));
    assert.ok(ran.some((x) => x.step === 'standalone' && x.value === true) && !ran.some((x) => x.error || x.value?.includes?.(false)), 'the installed app shows the alert card (pwa-run.json)');
  }
  // Only Mail watch's turn is scripted: the answer's turn gets the stub's own reply, which the app never shows (a real
  // reply needs a real model), so the thread ends on the person's answer rather than a failed scripted turn.
  delete process.env.CREWHOUSE_STUB_GOLDEN;
  const plan = join(lab, 'browser-plan.json');
  writeFileSync(plan, JSON.stringify({ bin: '/usr/bin/chromium', profile: join(lab, 'profile'), home: join(lab, 'home'), args: ['--no-sandbox', '--disable-dev-shm-usage', 'about:blank'], steps }));
  const { stdout } = await exec(process.execPath, [resolve(import.meta.dirname, 'pwa-shell.mjs'), plan], { timeout: 180_000, maxBuffer: 1024 * 1024 });
  writeFileSync(join(out, 'browser-proof.txt'), stdout.replaceAll(lab, '<lab>'));
  const results = JSON.parse(stdout), at = (name) => results.find((r) => r.step === name)?.value;
  assert.ok(results.every((r) => !r.error));
  for (const g of results.filter((r) => r.step?.startsWith('geometry-')).map((r) => r.value)) {
    assert.ok(!g.overflow && !g.wide, `no sideways scroll at ${g.width}`);
    assert.deepEqual(g.rows.map((r) => [r.text, r.href]), [['Open the alert Gmail', `https://mail.google.com/mail/u/0/#inbox/${fixture.thread}`], ['The advisory nodejs.org', 'https://nodejs.org/en/blog/vulnerability/fixture-brotli?source=stripe&kind=security']]);
    assert.ok(g.rows.every((r) => r.h >= 44), 'each source row is a 44px tap');
    assert.ok(g.links.every((h) => /^https:/.test(h)), 'only https links render');
    assert.equal(g.lead, 'Stripe flagged recent UmerTech API traffic as likely using an outdated Node.js runtime.');
    assert.equal(g.ask, 'Which deployed app uses this Stripe account?'); assert.ok(g.answer);
    assert.match(g.down, /Couldn't check your Gmail .*503/);
  }
  for (const look of ['day', 'night']) assert.match(at(`runs-${look}`), /No new mail[\s\S]*Told you[\s\S]*Started watching your inbox[\s\S]*Couldn't reach Gmail/);
  assert.deepEqual(at('answer-box'), { tag: 'TEXTAREA', inDock: true, placeholder: 'Your answer for Chief…', to: 'Answering Chief Which deployed app uses this Stripe account? ×' });
  assert.ok(!at('answered').answer, 'Answer leaves once the person replied');
  // The reply reaches Chief as his own job: the question it answers, quoted, and the alert above it.
  const reply = db.get("SELECT * FROM tasks WHERE bot = 'chief' AND routine IS NULL AND body = ?", '> Which deployed app uses this Stripe account?\n\nThe UmerTech billing app on Railway.');
  assert.ok(reply, 'the answer starts a Chief job');
  const read = () => { const session = db.get('SELECT session FROM tasks WHERE id = ?', reply.id).session; return session && crew.runtime.specOf(session); };
  for (const end = Date.now() + 30_000; !read(); ) { assert.ok(Date.now() < end, 'Chief reads the answer'); await new Promise((r) => setTimeout(r, 20)); }
  assert.match(read().message, /Earlier in this chat:\n[\s\S]*Chief: Stripe flagged[\s\S]*The person says: > Which deployed app uses this Stripe account\?\n\nThe UmerTech billing app on Railway\.$/);
  writeSteps(out, 'inbox-triage');
  console.log(`PASS: one scripted alert card reaches Chief through real HTTP, the answer quotes its question, a quiet poll creates no task and Gmail receives GETs only${PWA ? '; the installed app shows the card' : ''}. Not live-model or native-phone proof.`);
} finally {
  if (server) await new Promise((r) => server.close(r));
  await crew.stop(); db.close(); await new Promise((r) => gmail.close(r));
  rmSync(lab, { recursive: true, force: true });
}
