// A021 and ch-user-rules: real HTTP/SQLite and real rendered screens on the scripted engine, never an AI key; the one
// outward act is an add on emulate's stateful Google Calendar (test/emulate-google.ts), never a real account.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { startGoogleEmulator, ME, CLIENT } from '../../test/emulate-google.ts';
const EV = resolve(process.argv[2]), REPO = resolve(import.meta.dirname, '../..');
mkdirSync(EV, { recursive: true });
const d = mkdtempSync(join(EV, '.lab-'));
for (const p of ['home', 'state', 'crew', 'tools', 'run']) mkdirSync(join(d, p));
const port = await new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }), B = `http://127.0.0.1:${port}`;
const { server: google, url: EMU } = await startGoogleEmulator(port);
const env = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: join(d, 'home'), TMPDIR: '/tmp', XDG_STATE_HOME: join(d, 'home/.local/state'), XDG_DATA_HOME: join(d, 'home/.local/share'), XDG_CONFIG_HOME: join(d, 'home/.config'), XDG_CACHE_HOME: join(d, 'home/.cache'), XDG_RUNTIME_DIR: join(d, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${d}/no-bus`, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_STUB_GOLDEN: '1', CREWHOUSE_PORT: String(port), CREWHOUSE_STATE_DIR: join(d, 'state'), CREWHOUSE_CREW_DIR: join(d, 'crew'), CREWHOUSE_TOOLS_DIR: join(d, 'tools'), CREWHOUSE_GOOGLE_CLIENT: join(d, 'absent-google-client.json'), CREWHOUSE_GOOGLE_EMULATOR: EMU };
let child, key = '', run = 0;
const until = async (what, fn) => { const end = Date.now() + 30000; for (;;) { if (await fn()) return; if (Date.now() > end) throw Error(`Timed out: ${what}`); await new Promise(r => setTimeout(r, 100)); } };
const api = async (method, path, body) => { const r = await fetch(B + path, { method, headers: { authorization: `Bearer ${key}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(5000) }); if (!r.ok) throw Error(`${method} ${path}: ${r.status}`); return r.json(); };
const start = async () => {
  const fd = openSync(join(EV, `crewd-${++run}.log`), 'w');
  child = spawn('setpriv', ['--pdeathsig', 'KILL', '--', process.execPath, join(REPO, 'src/main.ts')], { cwd: REPO, env, detached: true, stdio: ['ignore', fd, fd] });
  await until('crewd ready', async () => { if (!existsSync(join(d, 'state/person.key'))) return false; key = readFileSync(join(d, 'state/person.key'), 'utf8').trim(); return api('GET', '/api/state').then(() => true, () => false); });
};
const stop = async () => { if (!child || child.exitCode !== null) return; const closed = new Promise(r => child.once('exit', r)); process.kill(-child.pid, 'SIGTERM'); await closed; };
const click = label => `(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}); if(!b) throw Error('No button: ${label}'); b.click(); return true; })()`;
const fill = text => `(() => { const e=document.querySelector('textarea[aria-label="Edit rule"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)}); e.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`;
const ready = `document.fonts.status === 'loaded' && !document.querySelector('.splash')`;
const geometry = `({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,scrollContainers:[...document.querySelectorAll('*')].filter(e=>e.clientHeight>0 && e.scrollHeight>e.clientHeight+2 && /auto|scroll/.test(getComputedStyle(e).overflowY)).length})`;
const matrix = (slug, route, shown, then = []) => ['day', 'night'].flatMap(look => [390, 1440].flatMap(w => [
  { name: `${slug}-${look}-${w}`, w, h: w === 390 ? 844 : 900, dpr: 1, url: `${B}/?${look}#/${route}`, settle: 0 },
  { name: 'ready', wait: `${ready} && (${shown})` }, ...then,
  { name: `${slug}-geometry-${look}-${w}`, eval: geometry, out: join(EV, `${slug}-${look}-${w}.png`) }
]));
const browser = async (name, steps) => {
  const path = join(d, `${name}.json`), out = join(EV, `${name}-run.json`);
  writeFileSync(path, JSON.stringify({ profile: join(d, `${name}-profile`), home: join(d, 'home'), headless: false, args: ['--window-size=1440,1000', '--force-device-scale-factor=1', 'about:blank'], xkey: join(REPO, 'scripts/verify/xkey.py'), recorder: join(REPO, 'scripts/verify/record.mjs'), steps: [{ name: 'authenticate', url: `${B}/#person=${key}`, settle: 0 }, { name: 'authority-ready', wait: `sessionStorage.getItem('crewhouse.person')?.length === 64` }, ...steps] }));
  // Keep HTTP socket-close events flowing while the browser runs; a synchronous child leaves pooled sockets stale.
  const { stdout: result } = await promisify(execFile)(process.execPath, [join(REPO, 'scripts/verify/pwa-shell.mjs'), path], { cwd: REPO, encoding: 'utf8', timeout: 300000, maxBuffer: 10_000_000 }).catch(e => e);
  writeFileSync(out, result.replaceAll(d, '<lab>').replaceAll(key, '<lab-key>'));
  const rows = JSON.parse(result), bad = rows.filter(r => r.error || r.value === false || r.value?.scrollWidth > r.value?.width);
  assert.deepEqual(bad, [], `${name} browser assertions`);
};
const post = (bot, text) => api('POST', `/api/bots/${bot}/messages`, { text });
const rule = 'Only prepare drafts. I will send messages myself.', say = 'Keep drafts, but when I say send, do it.', edited = `${say} Keep each draft short.`;
const lunches = async () => ((await (await fetch(`${EMU}/calendar/v3/calendars/primary/events`, { headers: { authorization: 'Bearer witness' } })).json()).items ?? []).filter(e => e.summary === 'Lunch with Ada' && e.status !== 'cancelled').length;
const text = (words) => `document.body.innerText.includes(${JSON.stringify(words)})`;
const request = (text) => `fetch('/api/bots/chief/messages',{method:'POST',headers:{authorization:${JSON.stringify(`Bearer ${key}`)},'x-crewhouse':'1','content-type':'application/json'},body:JSON.stringify({text:${JSON.stringify(text)}})}).then(r=>{if(!r.ok)throw Error('Message failed');return true})`;
try {
  await start(); await api('POST', '/api/onboard', { address: 'Umer' });
  // Calendar the way the person connects it: Connect, emulate's sign-in page, Umer's account, back to crewd.
  await api('PUT', '/api/house/google', CLIENT);
  const { url } = await api('POST', '/api/connections/calendar');
  const form = (await (await fetch(url)).text()).split('<form').find(f => f.includes(`value="${ME}"`));
  const fields = new URLSearchParams([...form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/g)].map(m => [m[1], m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')]));
  const chosen = await fetch(`${EMU}/o/oauth2/v2/auth/callback`, { method: 'POST', body: fields, redirect: 'manual' });
  assert.match(await (await fetch(chosen.headers.get('location'))).text(), /is connected\./);
  // emulate ignores privateExtendedProperty, so calendar add's add-twice check would match a seeded event.
  for (const id of ['standup0001', 'dentist0001']) await fetch(`${EMU}/calendar/v3/calendars/primary/events/${id}`, { method: 'DELETE', headers: { authorization: 'Bearer witness' } });
  if (process.env.BASELINE) {
    await browser('before', matrix('before-settings', 'settings', `document.body.innerText.includes('Settings')`));
  } else {
    await post('chief', 'From now on, only prepare drafts. I will send messages myself.');
    await until('pending rule card', async () => (await api('GET', '/api/state')).asks.some(a => a.detail.customRule));
    assert.deepEqual((await api('GET', '/api/rules')).rules, []);
    const confirm = `!!document.querySelector('[aria-label="New custom rule"]')`, update = `!!document.querySelector('[aria-label="Update custom rule"]')`;
    await browser('journey', [
      ...matrix('confirm', 'chief', confirm),
      { name: 'phone', w: 390, h: 844, url: `${B}/?day#/chief`, settle: 0 }, { name: 'ready', wait: confirm },
      { name: 'record', record: join(EV, 'rule-journey.webm'), seconds: 120 },
      { name: 'create-rule', eval: click('Create rule') }, { name: 'saved', wait: `document.body.innerText.includes('Custom rule · Saved')` },
      { name: 'stored-exactly', eval: `fetch('/api/rules',{headers:{authorization:${JSON.stringify(`Bearer ${key}`)},'x-crewhouse':'1'}}).then(r=>r.json()).then(r=>JSON.stringify(r.rules)===${JSON.stringify(JSON.stringify([{ text: rule, hold: 'draft' }]))})` },
      ...matrix('saved', 'chief', `document.body.innerText.includes('Custom rule · Saved')`),
      { name: 'phone-again', w: 390, h: 844, url: `${B}/?day#/chief`, settle: 0 },
      { name: 'offer-cancelled-rule', eval: request('From now on, always write long replies.') }, { name: 'pending', wait: confirm },
      { name: 'cancel-rule', eval: click('Cancel') }, { name: 'cancelled', wait: `document.body.innerText.includes('Custom rule · Cancelled')` },
      // The dot journey: the rule holds the add, the person widens it to "when I say send", then says send.
      { name: 'ask-lunch', eval: request('Put lunch with Ada on my calendar for tomorrow at 1.') }, { name: 'held', wait: text('Held by your rule') },
      ...matrix('held', 'chief', text('Held by your rule')), { name: 'phone-held', w: 390, h: 844, url: `${B}/?day#/chief`, settle: 0 },
      { name: 'ask-say-rule', eval: request(say) }, { name: 'update-card', wait: update },
      ...matrix('update', 'chief', update), { name: 'phone-update', w: 390, h: 844, url: `${B}/?day#/chief`, settle: 0 }, { name: 'ready', wait: update },
      { name: 'update-rule', eval: click('Update rule') }, { name: 'updated', wait: `!(${update})` },
      { name: 'say-send', eval: request('Send it.') }, { name: 'sent', wait: text('Done: Lunch with Ada') },
      ...matrix('sent', 'chief', text('Done: Lunch with Ada')),
      { name: 'list', url: `${B}/?day#/settings/rules`, settle: 0 }, { name: 'ready', wait: text(say) },
      { name: 'edit', eval: click('Edit') }, { name: 'ready', wait: `!!document.querySelector('textarea')` }, { name: 'type-cancelled-edit', eval: fill('Do not save this edit.') },
      { name: 'cancel-edit', eval: click('Cancel') }, { name: 'unchanged', wait: `!document.querySelector('textarea') && ${text(say)}` },
      { name: 'edit', eval: click('Edit') }, { name: 'ready', wait: `!!document.querySelector('textarea')` }, { name: 'type-edit', eval: fill(edited) },
      { name: 'save-edit', eval: click('Save changes') }, { name: 'edited', wait: `!document.querySelector('textarea') && document.body.innerText.includes('Keep each draft short.')` },
      { name: 'record-end', recwait: true },
      ...matrix('rules', 'settings/rules', `document.body.innerText.includes('Keep each draft short.')`),
      // The same address at the next width keeps the open form, so Edit is pressed only where it is closed.
      ...matrix('rule-edit', 'settings/rules', `${text('Keep each draft short.')} || !!document.querySelector('textarea')`, [{ name: 'edit', eval: `!!document.querySelector('textarea') || ${click('Edit')}` }, { name: 'ready', wait: `!!document.querySelector('textarea')` }]),
      ...matrix('receipts', 'chief', `document.body.innerText.includes('Custom rule · Cancelled')`)
    ]);
    assert.deepEqual((await api('GET', '/api/rules')).rules, [{ text: edited, hold: 'say' }]);
    assert.equal(await lunches(), 1, "the add went out once, on the person's word");
    writeFileSync(join(EV, 'rules.json'), JSON.stringify(await api('GET', '/api/rules')));
    await api('POST', '/api/recruit', { template: 'scribe', name: 'Scribe' });
    const task = await post('scribe', 'Write a draft reply to Alex.');
    await until('helper draft', async () => (await api('GET', '/api/bots/scribe')).tasks.some(t => t.id === task.task && t.state === 'done'));
    const helper = await api('GET', '/api/bots/scribe'), trail = await api('GET', `/api/task/${task.task}/trail`);
    writeFileSync(join(EV, 'helper.json'), JSON.stringify({ helper, trail }, null, 2));
    assert.deepEqual(trail.map(({ words, ok }) => ({ words, ok })), [{ words: 'Saved reply.txt', ok: true }, { words: 'Used draft', ok: true }], 'the complete public task trail is successful draft-only work, with no outward action');
    const draft = (await api('GET', '/api/state')).asks.find(a => a.bot === 'scribe' && a.detail.draft);
    assert.equal(draft?.detail.preview.body, 'Thanks, Alex. I will reply tomorrow. — Umer'); assert.equal(draft.detail.draft.to, 'Alex');
    assert.deepEqual(helper.allow, [], 'the confirmed rule gave no standing safety permission');
    await browser('helper', matrix('helper-draft', 'chief', `document.body.innerText.includes('Alex') && document.body.innerText.includes('Nothing is sent')`));
    await stop(); await start(); assert.deepEqual((await api('GET', '/api/rules')).rules, [{ text: edited, hold: 'say' }]);
    writeFileSync(join(EV, 'restart.json'), JSON.stringify({ rules: (await api('GET', '/api/rules')).rules, cancelledRuleAbsent: true }));
  }
} finally { await stop(); await google.close(); rmSync(d, { recursive: true, force: true }); }
