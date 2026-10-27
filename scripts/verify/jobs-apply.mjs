// Drives the application hand-off on a live stub-engine crewd (jobs-apply.sh). The model's turns are scripted (stub engine);
// the browser, the form, the gate that refuses what is not the person's own words, crewd's reading of the page and its
// press of Submit are all real.
//   node scripts/verify/jobs-apply.mjs serve <port> <sent-file>          the local posting: its own form, a POST records what was sent
//   node scripts/verify/jobs-apply.mjs board <crewd> <key> <posting-url> <company> <title> <pay>   goal, role, draft → {role, ask}
//   node scripts/verify/jobs-apply.mjs fill <crewd> <key> <crew-dir> <state-dir> <tools-dir>       Fill it in for me → the form card id
//   node scripts/verify/jobs-apply.mjs submit <crewd> <key>             the person's Submit, with their answers → the card's outcome
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
const [step, B, key, ...rest] = process.argv.slice(2);
if (step === 'serve') {
  const FORM = `<!doctype html><title>Northwind Careers · Apply for Frontend Engineer</title><h1>Frontend Engineer</h1><p>London. Salary: £55,000 to £65,000 a year. React, TypeScript, GraphQL.</p>
<form method="post" action="/apply"><label>First Name <input name="first"></label><label>Last Name <input name="last"></label><label>Email <input name="email" type="email"></label>
<label>Why do you want to work at Northwind? <textarea name="why"></textarea></label><fieldset><legend>Resume/CV</legend><button type="button">Attach</button></fieldset>
<label>Will you now or in the future require visa sponsorship? <select name="visa"><option>Yes</option><option>No</option></select></label>
<label>Expected salary <input name="salary"></label><label><input type="checkbox" name="consent"> I consent to Northwind keeping my data for this application</label><button>Submit application</button></form>`;
  createServer((q, r) => {
    r.setHeader('content-type', 'text/html; charset=utf-8');
    if (q.method !== 'POST') return r.end(FORM);
    let body = ''; q.on('data', (c) => { body += c; }); q.on('end', () => { writeFileSync(key, JSON.stringify(Object.fromEntries(new URLSearchParams(body)))); r.end('<title>Application received</title><h1>Thanks for applying</h1>'); });
  }).listen(+B, '127.0.0.1');
} else {
  const H = { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${key}` };
  // One connection per call: the writer's browser runs between calls for longer than the server keeps an idle socket.
  const api = (m, p, body) => new Promise((ok, no) => { const q = request(B + p, { method: m, headers: H, agent: false }, (r) => { let t = ''; r.on('data', (c) => { t += c; }).on('end', () => (r.statusCode < 300 ? ok(JSON.parse(t)) : no(new Error(`${m} ${p}: ${r.statusCode} ${t}`)))); }); q.on('error', no); q.end(body === undefined ? undefined : JSON.stringify(body)); });
  const until = async (what, fn) => { for (let i = 0; i < 240; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); } throw new Error(`never saw ${what}`); };
  const tool = (n, i) => `[tool ${n} ${JSON.stringify(i)}]`, state = () => api('GET', '/api/state');
  const idle = (bot) => until(`${bot} done`, async () => !(await state()).bots.find((b) => b.id === bot)?.task);
  const CV = readFileSync(new URL('./jobs-cv.txt', import.meta.url), 'utf8').trim(), lines = CV.split('\n');
  const WHY = 'I build payments dashboards, and I would like to do it for a team that ships every week.';
  if (step === 'board') {
    const [posting, co, title, pay] = rest;
    await api('POST', '/api/onboard', { address: 'Umer' });
    await api('POST', '/api/bots/chief/messages', { text: `Find me roles ${tool('crew_goal', { title, places: 'London or remote', floor: '£50,000', cv: CV })}` });
    const goal = await until('the goal card', async () => (await state()).asks.find((a) => a.kind === 'propose'));
    await api('POST', `/api/asks/${goal.id}/answer`, { answer: 'allow', scope: 'once' });
    const { rae, will } = (await until('the board', async () => (await state()).jobs)).goal;
    await idle(rae);
    await api('POST', `/api/bots/${rae}/messages`, { text: `Found one ${tool('crew_role', { company: co, title, place: 'London', url: posting, pay, missing: 'GraphQL is not on your CV', fit: [{ says: 'You led a payments dashboard in React', cv: lines[1] }] })}` });
    const role = await until(`${co} on the board`, async () => (await state()).jobs.roles.find((x) => x.co === co));
    await api('POST', `/api/jobs/${role.id}/draft`);
    await api('POST', `/api/bots/${will}/messages`, { text: `Drafted ${tool('crew_application', { role: role.id, cv: [lines[1], lines[2]], answers: [{ ask: `Why ${co}?`, answer: WHY }] })}` });
    const draft = await until('the draft card', async () => (await state()).asks.find((a) => a.detail?.draft));
    console.log(JSON.stringify({ role: role.id, ask: draft.id }));
  } else if (step === 'fill') {
    const [crew, stateDir, tools] = rest, s = await state(), will = s.jobs.goal.will, role = s.jobs.roles.find((r) => r.stage === 'drafted');
    await api('POST', `/api/asks/${s.asks.find((a) => a.detail?.draft).id}/answer`, { answer: 'allow', scope: 'once', fill: true });
    await idle(will);
    // The scripted model reads the page first, as the writer would (its browser, profile and HOME), so its one turn can name refs.
    const home = join(stateDir, 'homes', will), space = join(crew, 'bots', will), script = join(tools, 'browser', 'node_modules', 'playwright-axi', 'bin', 'playwright-axi.js');
    const axi = (...a) => execFileSync(process.execPath, [script, ...a], { cwd: space, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_STATE_HOME: join(home, '.local', 'state'), LANG: 'C.UTF-8', NO_COLOR: '1', PLAYWRIGHT_BROWSERS_PATH: join(tools, 'browser', 'ms-playwright'), PLAYWRIGHT_CLI_SESSION: will } });
    axi('open', '--persistent', '--profile', join(space, 'browser')); axi('goto', role.url);
    const snap = axi('snapshot', '--full'); axi('close');
    writeFileSync(join(stateDir, '..', 'form-snapshot.txt'), snap);
    const ref = (role, re) => [...snap.matchAll(new RegExp(`- ${role} "([^"]*)"[^\\n]*\\[ref=([\\w-]+)\\]`, 'g'))].find((m) => re.test(m[1]))?.[2];
    const [first, last] = lines[0].split(' '), calls = [];
    for (const [re, v] of [[/^first name/i, first], [/^last name/i, last], [/e-?mail/i, 'umer@example.com'], [/sponsor/i, 'No'], [/salary/i, '£60,000'], [/^why|cover letter/i, WHY]]) {
      const r = ref('(?:textbox|combobox)', re); if (r) calls.push(tool('browser', { args: ['fill', r, v] }));
    }
    const tick = ref('checkbox', /consent|agree/i); if (tick) calls.splice(0, 0, tool('browser', { args: ['click', tick] }));
    await api('POST', `/api/bots/${will}/messages`, { text: `Filling it in ${tool('browser', { args: ['goto', role.url] })} ${calls.join(' ')} ${tool('crew_form', { role: role.id })}` });
    const card = await until('the form card', async () => (await state()).asks.find((a) => a.detail?.form)).catch(async (e) => { console.error((await api('GET', '/api/events')).filter((x) => /run\.call|message/.test(x.kind)).slice(-12)); throw e; });
    console.log(card.id);
  } else if (step === 'submit') {
    const card = (await state()).asks.find((a) => a.detail?.form), q = (re) => card.detail.form.fields.find((f) => re.test(f.label))?.label;
    const fields = { [q(/e-?mail/i)]: 'umer@example.com', [q(/sponsor/i)]: 'No', [q(/salary/i)]: '£60,000', [q(/consent/i)]: true };
    await api('POST', `/api/asks/${card.id}/answer`, { answer: 'allow', scope: 'once', fields });
    console.log(JSON.stringify((await state()).jobs.roles.map((r) => r.stage)));
  }
}
