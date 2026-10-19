// Email and meeting routines on a real crewd (stub engine) against emulate's stateful Google (docs/verification/event-routines.md).
//   node scripts/verify/event-routines.mjs <evidence-dir>    (PWA=1 under `xvfb-run -a -s "-screen 0 1920x1200x24"` adds the installed app)
// The person connects Gmail and Calendar through crewd and the kit's real sign-in; Chief offers "when an email from the bank
// with subject statement arrives" and "10 minutes before each meeting" on cards the person says yes to; a mail lands in the
// emulated inbox and a meeting is booked there; crewd's own tick notices each once and starts the helper. crewd's API and
// event log are the witness, and home-gate.mjs captures the card, Routines and the helper's thread at 390/1280, day/night.
// emulate has no Gmail users.getProfile (0.12.2), so this lab answers that one call from the emulator's own history id.
// Demo data only; nothing reaches a real Google.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { startGoogleEmulator, ME, CLIENT } from '../../test/emulate-google.ts';

const EV = resolve(process.argv[2] ?? ''), REPO = resolve(import.meta.dirname, '../..');
if (!process.argv[2]) { console.error('usage: event-routines.mjs <evidence-dir>'); process.exit(2); }
mkdirSync(EV, { recursive: true });
const scratch = join(homedir(), '.cache', 'fm-scratch'); mkdirSync(scratch, { recursive: true });
const LAB = mkdtempSync(join(scratch, 'event-routines-'));
const log = (s) => { console.log(s); writeFileSync(join(EV, 'transcript.txt'), `${s}\n`, { flag: 'a' }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 180_000) { for (const end = Date.now() + ms; ; await sleep(500)) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); } }
const free = () => new Promise((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

const PORT = await free(), B = `http://127.0.0.1:${PORT}`;
const { server: google, url: EMU } = await startGoogleEmulator(PORT);
// The lab's front for the emulator: every call passes through, except users.getProfile, which emulate lacks.
const front = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const headers = { ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}) };
  if (req.method === 'GET' && req.url === '/gmail/v1/users/me/profile') {
    const h = await (await fetch(`${EMU}/gmail/v1/users/me/history?startHistoryId=0`, { headers })).json();
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ emailAddress: ME, historyId: h.historyId }));
  }
  const up = await fetch(EMU + req.url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: 'manual' });
  res.writeHead(up.status, Object.fromEntries([...up.headers].filter(([k]) => ['content-type', 'location'].includes(k))));
  res.end(Buffer.from(await up.arrayBuffer()));
});
await new Promise((r) => front.listen(0, '127.0.0.1', r));
const FRONT = `http://127.0.0.1:${front.address().port}`;

for (const d of ['home', 'state', 'crew', 'tools', 'run']) mkdirSync(join(LAB, d), { recursive: true });
const out = openSync(join(LAB, 'crewd.log'), 'w');
const crewd = spawn(process.execPath, [join(REPO, 'src/main.ts')], { cwd: REPO, detached: true, stdio: ['ignore', out, out], env: {
  PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: join(LAB, 'home'), TMPDIR: LAB, XDG_STATE_HOME: join(LAB, 'home/.local/state'), XDG_DATA_HOME: join(LAB, 'home/.local/share'),
  XDG_CONFIG_HOME: join(LAB, 'home/.config'), XDG_CACHE_HOME: join(LAB, 'home/.cache'), XDG_RUNTIME_DIR: join(LAB, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${LAB}/no-bus`,
  CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(PORT), CREWHOUSE_STATE_DIR: join(LAB, 'state'), CREWHOUSE_CREW_DIR: join(LAB, 'crew'), CREWHOUSE_TOOLS_DIR: join(LAB, 'tools'),
  CREWHOUSE_GOOGLE_CLIENT: join(LAB, 'absent-google-client.json'), CREWHOUSE_GOOGLE_EMULATOR: FRONT } });
// Captures run beside this process (it is the emulator's front), never blocking it. The gate's rules are Home's: on a chat
// page it also lists the thread's own small time stamps, so its findings are kept in <slug>-gate.json for the look-over.
const capture = (slug, then) => new Promise((ok, no) => spawn(process.execPath, [join(REPO, 'scripts/verify/home-gate.mjs'), REPO, `${B}/#person=${KEY}`, EV, slug, then], { stdio: ['ignore', 'ignore', 'inherit'] })
  .once('exit', (code) => code === 0 || code === 1 ? (log(`captured ${slug} at 390 and 1280, day and night (gate ${code ? 'findings' : 'clean'}: ${slug}-gate.json)`), ok()) : no(new Error(`${slug}: capture failed (${code})`))));
let KEY = '';
let failed = false;
try {
  const key = KEY = await until('crewd ready', async () => {
    const f = join(LAB, 'state/person.key'); if (!existsSync(f)) return null;
    const k = readFileSync(f, 'utf8'); return (await fetch(`${B}/api/state`, { headers: { authorization: `Bearer ${k}`, 'x-crewhouse': '1' } }).catch(() => null))?.ok && k;
  }, 60_000);
  const api = async (method, path, body) => {
    const res = await fetch(B + path, { method, headers: { authorization: `Bearer ${key}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  const google = (method, path, body) => fetch(`${EMU}${path}`, { method, headers: { authorization: 'Bearer witness', 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const state = () => api('GET', '/api/state');
  const all = async () => (await state()).routines, routine = async (name) => (await all()).find((r) => r.name === name);

  await api('POST', '/api/onboard', { address: 'Umer' });
  await api('POST', '/api/recruit', { template: 'scribe', name: 'Quill' });
  await api('PUT', '/api/house/google', CLIENT);
  // An email routine before Gmail is connected: refused in plain words, nothing made.
  const early = await fetch(`${B}/api/routines`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: JSON.stringify({ bot: 'quill', on: 'when an email from the bank arrives', task: 'Tell me' }) });
  log(`before Gmail is connected: POST /api/routines -> ${early.status} ${JSON.stringify((await early.json()).error)}`);
  if (early.status !== 400) throw new Error('an email routine was allowed before Gmail was connected');
  for (const app of ['gmail', 'calendar']) {
    const { url } = await api('POST', `/api/connections/${app}`);
    const page = await (await fetch(url.replace(FRONT, EMU))).text(), form = page.split('<form').find((f) => f.includes(`value="${ME}"`));
    const fields = new URLSearchParams([...form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/g)].map((m) => [m[1], m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')]));
    const chosen = await fetch(`${EMU}/o/oauth2/v2/auth/callback`, { method: 'POST', body: fields, redirect: 'manual' });
    const words = await (await fetch(chosen.headers.get('location'))).text();
    if (!/is connected\./.test(words)) throw new Error(`${app}: ${words.slice(0, 200)}`);
    log(`${app}: connected through crewd on the emulated Google`);
  }
  // Chief offers each routine on a card (the stub runs the tool call in the person's message); the person says yes.
  const offer = async (args, words) => {
    await api('POST', '/api/bots/chief/messages', { text: `Set this up for me [tool crew_routine ${JSON.stringify(args)}]` });
    const ask = await until(`the "${words}" card`, async () => (await state()).asks?.find((a) => a.kind === 'propose' && a.title.startsWith(words)), 60_000);
    log(`card: ${JSON.stringify({ title: ask.title, preview: ask.detail.preview })}`);
    return ask;
  };
  const bankAsk = await offer({ bot: 'quill', on: 'when an email from the bank with subject statement arrives', task: 'Tell me what the statement says and anything I need to do', name: 'Bank statement' }, 'When an email from bank with subject statement arrives');
  const meetAsk = await offer({ bot: 'quill', on: '10 minutes before each meeting', task: 'Give me a short note on what the meeting is about', name: 'Meeting prep' }, '10 minutes before each meeting');
  await capture('card', "location.hash = '#/chief'");
  for (const a of [bankAsk, meetAsk]) await api('POST', `/api/asks/${a.id}/answer`, { answer: 'allow' });
  const bank = await until('bank routine', () => routine('Bank statement')), meet = await until('meeting routine', () => routine('Meeting prep'));
  log(`routines: ${JSON.stringify([bank, meet].map((r) => ({ name: r.name, on: r.on, state: r.state })))}`);
  await until('first look stores the mail baseline', async () => JSON.parse((await routine('Bank statement')).cursor ?? '{}').history);

  // Old-looking and unrelated mail after the baseline: the wrong sender and the wrong subject start nothing.
  await google('POST', '/gmail/v1/users/me/messages', { from: 'Shop <hello@shop.example>', to: ME, subject: 'Your statement of points', body_text: 'Points.', labelIds: ['INBOX'] });
  await google('POST', '/gmail/v1/users/me/messages', { from: 'Bank <alerts@bank.example>', to: ME, subject: 'A new offer for you', body_text: 'Offer.', labelIds: ['INBOX'] });
  const sent = await google('POST', '/gmail/v1/users/me/messages', { from: 'Bank <alerts@bank.example>', to: ME, subject: 'Your October statement is ready', body_text: 'Balance due 12 Nov.', labelIds: ['INBOX'] });
  log(`emulated inbox: three mails added, the matching one ${sent.id}`);
  const fired = await until('the mail routine fires', async () => (await routine('Bank statement')).history.find((h) => h.why === 'event' && h.state === 'done'), 150_000);
  const task = (await api('GET', `/api/bots/quill`)).messages?.filter((m) => m.task_id === fired.task).map((m) => m.text) ?? [];
  log(`mail fired task ${fired.task}: ${JSON.stringify(task)}`);
  if (!task.some((t) => t.includes('Your October statement is ready')) || task.some((t) => /points|offer/i.test(t))) throw new Error('the task named the wrong mail');

  // A meeting booked a little over ten minutes ahead comes due on a later tick.
  const at = (ms) => new Date(Date.now() + ms).toISOString();
  await google('POST', '/calendar/v3/calendars/primary/events', { summary: 'Call with the accountant', location: 'Phone', start: { dateTime: at(10 * 60_000 + 20_000) }, end: { dateTime: at(40 * 60_000) } });
  await google('POST', '/calendar/v3/calendars/primary/events', { summary: 'Holiday', start: { date: '2099-01-01' }, end: { date: '2099-01-02' } });
  const met = await until('the meeting routine fires', async () => (await routine('Meeting prep')).history.find((h) => h.why === 'event' && h.state === 'done'), 150_000);
  const body = (await api('GET', `/api/bots/quill`)).messages?.filter((m) => m.task_id === met.task).map((m) => m.text) ?? [];
  log(`meeting fired task ${met.task}: ${JSON.stringify(body)}`);
  if (!body.some((t) => t.includes('Call with the accountant'))) throw new Error('the meeting task did not name the meeting');

  // Two more minutes of ticks: nothing new, so nothing fires again.
  await sleep(125_000);
  const runs = (await all()).filter((r) => r.bot === 'quill').map((r) => ({ name: r.name, on: r.on, fired: r.history.filter((h) => h.kind === 'routine.fired').length }));
  log(`after two quiet minutes: ${JSON.stringify(runs)}`);
  if (runs.some((r) => r.fired !== 1)) throw new Error('a routine fired more than once');
  writeFileSync(join(EV, 'routines.json'), JSON.stringify(await all(), null, 1));
  await capture('routines', "location.hash = '#/routines'");
  await capture('helper', "location.hash = '#/h/quill'");
  if (process.env.PWA) { // the installed app (docs/verification/pwa-shell.md), under xvfb-run: Routines in its standalone window
    const phone = { w: 390, h: 844, dpr: 2, mobile: true }, shown = `!!document.querySelector('.routine-last')`;
    const steps = [{ name: 'open', url: `${B}/#person=${KEY}`, settle: 3000 }, { name: 'settings', url: `${B}/#/settings`, settle: 3000 },
      { name: 'install', click: '.install .btn', settle: 3000 }, { name: 'tab', key: 'Tab' }, { name: 'return', key: 'Return', settle: 3000 },
      { name: 'attach', attachApp: B }, { name: 'standalone', eval: `matchMedia('(display-mode: standalone)').matches` },
      ...['day', 'night'].flatMap((look) => [{ name: `${look}-390`, ...phone, url: `${B}/?${look}#/routines`, settle: 2500 }, { name: `${look}-390-wait`, wait: shown, timeout: 20000 },
        { name: `${look}-390-shot`, eval: `[matchMedia('(display-mode: standalone)').matches, document.documentElement.scrollWidth <= innerWidth]`, out: join(EV, `pwa-routines-390-${look}.png`) }]),
      { name: 'wide', win: [1280, 900], url: `${B}/?day#/routines`, settle: 2500 }, { name: 'wide-wait', wait: shown, timeout: 20000 }, { name: 'wide-shot', wshot: join(EV, 'pwa-routines-1280-day.png') }];
    writeFileSync(join(LAB, 'plan.json'), JSON.stringify({ profile: join(LAB, 'pwa/profile'), home: join(LAB, 'pwa/home'), headless: false, xkey: join(REPO, 'scripts/verify/xkey.py'),
      args: ['--window-size=1400,950', '--force-device-scale-factor=1', 'about:blank'], steps }));
    const ran = await new Promise((ok) => { const c = spawn('node', [join(REPO, 'scripts/verify/pwa-shell.mjs'), join(LAB, 'plan.json')], { stdio: ['ignore', 'pipe', 'inherit'] }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.once('exit', () => ok(o)); });
    writeFileSync(join(EV, 'pwa-run.json'), ran.replaceAll(LAB, '<lab>'));
    const seen = JSON.parse(ran || '[]'), bad = seen.filter((x) => x.error || (x.value && x.value.includes?.(false)));
    if (!seen.some((x) => x.step === 'standalone' && x.value === true) || bad.length) throw new Error(`the installed app: ${JSON.stringify(bad)} (pwa-run.json)`);
    log('captured the installed app: Routines at 390 day and night, 1280 day (pwa-run.json)');
  }
  log('PASS');
} catch (e) { failed = true; log(`FAIL: ${e.stack ?? e}`); }
finally {
  writeFileSync(join(EV, 'crewd.log'), readFileSync(join(LAB, 'crewd.log'), 'utf8').replaceAll(LAB, '<lab>'));
  try { process.kill(-crewd.pid, 'SIGTERM'); } catch {}
  await Promise.race([new Promise((r) => crewd.once('exit', r)), sleep(10_000)]);
  try { process.kill(-crewd.pid, 'SIGKILL'); } catch {}
  front.close(); google.close();
  execFileSync('chmod', ['-R', 'u+w', LAB]); rmSync(LAB, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
