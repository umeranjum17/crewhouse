// Drives the application hand-off on a live stub-engine crewd (jobs-apply.sh). The model's turns are scripted (stub engine);
// the browser, the form, the gate that refuses what is not the person's own words, crewd's reading of the page and its
// press of Submit are all real.
//   node scripts/verify/jobs-apply.mjs serve <port> <sent-file>          the local posting: its own form, a POST records what was sent
//   node scripts/verify/jobs-apply.mjs board <crewd> <key> <posting-url> <company> <title> <pay>   goal, role, draft → {role, ask}
//   node scripts/verify/jobs-apply.mjs fill <crewd> <key> <crew-dir> <state-dir> <tools-dir>       Fill it in for me → the form card id
//   node scripts/verify/jobs-apply.mjs submit <crewd> <key>             the person's Submit, with their answers → the card's outcome
//   SERIAL=<emulator> node scripts/verify/jobs-apply.mjs phone <crewd> <key> <out> <lab>   the same by taps on the paired phone (phone-apply.sh)
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
  const until = async (what, fn) => { for (let i = 0; i < 480; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); }
    console.error((await api('GET', '/api/events')).filter((x) => /run\.call|message|task\./.test(x.kind)).slice(-12)); throw new Error(`never saw ${what}`); };
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
    const { rae, will } = (await until('the board', async () => (await state()).goals[0])).goal;
    await idle(rae);
    await api('POST', `/api/bots/${rae}/messages`, { text: `Found one ${tool('crew_role', { company: co, title, place: 'London', url: posting, pay, missing: 'GraphQL is not on your CV', fit: [{ says: 'You led a payments dashboard in React', cv: lines[1] }] })}` });
    const role = await until(`${co} on the board`, async () => (await state()).goals[0].roles.find((x) => x.co === co));
    await api('POST', `/api/jobs/${role.id}/draft`);
    await api('POST', `/api/bots/${will}/messages`, { text: `Drafted ${tool('crew_application', { role: role.id, cv: [lines[1], lines[2]], answers: [{ ask: `Why ${co}?`, answer: WHY }] })}` });
    const draft = await until('the draft card', async () => (await state()).asks.find((a) => a.detail?.draft));
    console.log(JSON.stringify({ role: role.id, ask: draft.id }));
  } else if (step === 'fill') {
    const [crew, stateDir, tools] = rest, s = await state(), will = s.goals[0].goal.will, role = s.goals[0].roles.find((r) => r.stage === 'drafted');
    const d = s.asks.find((a) => a.detail?.draft); // already answered when the person tapped Fill it in for me on the phone
    if (d) await api('POST', `/api/asks/${d.id}/answer`, { answer: 'allow', scope: 'once', fill: true });
    await idle(will);
    // The scripted model reads the page first, as the writer would (its browser, profile and HOME), so its one turn can name refs.
    const home = join(stateDir, 'homes', will), space = join(crew, 'bots', will), script = join(tools, 'browser', 'node_modules', 'playwright-axi', 'bin', 'playwright-axi.js');
    const axi = (...a) => execFileSync(process.execPath, [script, ...a], { cwd: space, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_STATE_HOME: join(home, '.local', 'state'), LANG: 'C.UTF-8', NO_COLOR: '1', PLAYWRIGHT_BROWSERS_PATH: join(tools, 'browser', 'ms-playwright'), PLAYWRIGHT_CLI_SESSION: will } });
    axi('open', '--persistent', '--profile', join(space, 'browser')); axi('goto', role.url);
    const snap = axi('snapshot', '--full'); axi('close');
    writeFileSync(join(stateDir, '..', 'form-snapshot.txt'), snap);
    const ref = (role, re) => [...snap.matchAll(new RegExp(`- ${role} "([^"]*)"[^\\n]*\\[ref=([\\w-]+)\\]`, 'g'))].find((m) => re.test(m[1]))?.[2];
    const [first, last] = lines[0].split(' '), calls = [];
    for (const [re, v] of [[/^first name/i, first], [/^last name/i, last], [/^legal name/i, lines[0]], [/e-?mail/i, 'umer@example.com'], [/sponsor/i, 'No'], [/salary/i, '£60,000'], [/^why|cover letter|additional information/i, WHY]]) {
      const r = ref('(?:textbox|combobox)', re); if (r) calls.push(tool('browser', { args: ['fill', r, v] }));
    }
    const tick = ref('checkbox', /consent|agree/i); if (tick) calls.splice(0, 0, tool('browser', { args: ['click', tick] }));
    // Then the reading pack: facts quoted from the posting's own page (crewd opens it and checks every quote).
    const pk = JSON.parse(readFileSync(new URL('./jobs-pack.json', import.meta.url), 'utf8'))[role.co], url = pk?.page ?? role.url;
    const pack = pk ? tool('crew_prep', { role: role.id, brief: pk.brief.map((f) => ({ ...f, url })), questions: pk.questions }) : '';
    await api('POST', `/api/bots/${will}/messages`, { text: `Filling it in ${tool('browser', { args: ['goto', role.url] })} ${calls.join(' ')} ${tool('crew_form', { role: role.id })} ${pack}` });
    const card = await until('the form card', async () => (await state()).asks.find((a) => a.detail?.form));
    if (pk) await until('the reading pack', async () => /Delivered [^"]*reading-pack/i.test(JSON.stringify(await api('GET', `/api/bots/${will}`))));
    console.log(card.id);
  } else if (step === 'submit') {
    const card = (await state()).asks.find((a) => a.detail?.form), q = (re) => card.detail.form.fields.find((f) => re.test(f.label))?.label;
    const fields = { [q(/e-?mail/i)]: 'umer@example.com', [q(/sponsor/i)]: 'No', [q(/salary/i)]: '£60,000', [q(/consent/i)]: true };
    await api('POST', `/api/asks/${card.id}/answer`, { answer: 'allow', scope: 'once', fields });
    console.log(JSON.stringify((await state()).goals[0].roles.map((r) => r.stage)));
  } else if (step === 'phone') {
    // The same journey by the person's taps on the paired phone ($SERIAL, phone-apply.sh): never the card's "Open the form yourself".
    const [out, lab] = rest, me = new URL(import.meta.url).pathname, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const A = (...a) => execFileSync('adb', ['-s', process.env.SERIAL, ...a], { encoding: 'utf8', maxBuffer: 1 << 27 });
    const ui = (...a) => execFileSync(process.execPath, [new URL('./phone-ui.mjs', import.meta.url).pathname, ...a], { encoding: 'utf8' });
    // A dump fails while the screen animates: that try is a miss, not an error.
    const on = (re) => until(String(re), async () => { try { return re.test(ui('texts')); } catch { return false; } }), shot = (n) => ui('shot', join(out, 'screens', n));
    const show = (re) => { try { ui('reveal', re); } catch { /* the list's end: as high as it goes */ } };
    // Controlled inputs drop fast injected text: three letters at a time, then the keyboard closed only while it is up.
    const type = async (label, v) => { show(`^${label}$`); ui('tap', `^${label}$`, '1'); await sleep(600);
      for (let i = 0; i < v.length; i += 3) { A('shell', 'input', 'text', v.slice(i, i + 3)); await sleep(300); }
      if (/mInputShown=true/.test(A('shell', 'dumpsys', 'input_method'))) A('shell', 'input', 'keyevent', '4'); await sleep(600); };
    await on(/Chief has 1 thing for you/); shot('01-home-draft.png'); ui('tap', '^Chief has 1 thing for you$');
    await on(/Fill it in for me/); show('^Writer Will drafted your application$'); await sleep(800); shot('02-draft-card.png');
    ui('tap', '^Fill it in for me$'); await sleep(1500); shot('03-filling.png');
    execFileSync(process.execPath, [me, 'fill', B, key, join(lab, 'crew'), join(lab, 'state'), join(lab, 'tools')], { stdio: 'inherit' });
    await on(/filled in your application|ONLY YOU CAN ANSWER/); A('shell', 'input', 'swipe', '540', '700', '540', '1500', '400'); await sleep(1200); shot('04-form-card.png'); // back up to its head
    show('^ONLY YOU CAN ANSWER THESE$'); await sleep(800); shot('05-only-you.png');
    // Top to bottom (the list only scrolls on): his own answers, then the email his CV doesn't hold. `input text` takes no £.
    show('^Will you now or in the future require visa sponsorship\\?$'); ui('tap', '^No$');
    await type('Expected salary', '60000');
    show('^I consent to Northwind'); ui('tap', '^I consent to Northwind', '1'); await sleep(800);
    await type('Email', 'umer@example.com'); shot('06-answered.png');
    show('^Submit$'); await sleep(800); shot('07-submit.png'); ui('tap', '^Submit$');
    await until('Applied', async () => (await state()).goals[0].roles[0].stage === 'applied');
    await on(/Sent from/); await sleep(1500); shot('08-sent.png');
    const s = await state(); writeFileSync(join(out, 'phone-apply.json'), JSON.stringify({ stage: s.goals[0].roles[0].stage, receipt: s.answered.find((a) => a.detail?.form)?.answer, sent: JSON.parse(readFileSync(join(lab, 'sent.json'), 'utf8')) }, null, 1));
  }
}
