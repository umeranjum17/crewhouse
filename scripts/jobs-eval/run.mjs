// The driver behind scripts/jobs-eval.sh (docs/jobs-eval.md). Four steps, each its own call so the shell owns crewd's life:
//   seed      a stub-engine crewd: the goal accepted and one role in Interview, by the product's own API and tools
//   helper    the same crewd on the real engine: the three cases through the product (Chief's goal card, Rae's shortlist,
//             Will's interview prep), scored by rubric.mjs
//   baseline  the plain model (the Claude CLI, no tools, no Crewhouse prompt or checks) on the same three cases, scored the same way
//   report    both arms' files into results.json, report.md and one ledger line (model, prompt hash, commit)
// Observation reads crewd's own SQLite file read-only; every action goes through its HTTP API.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as jobs from '../../src/jobs.ts';
import { CASES, CV, RUBRIC_VERSION, goal as scoreGoal, prep as scorePrep, serve, shortlist as scoreShortlist } from './rubric.mjs';

const [cmd, ...rest] = process.argv.slice(2), o = Object.fromEntries(rest.flatMap((a, i) => a.startsWith('--') ? [[a.slice(2), rest[i + 1]]] : []));
const REPO = resolve(import.meta.dirname, '../..'), NAMES = (o.cases ?? 'goal,shortlist,prep').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 60_000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`gave up after ${Math.round(ms / 1000)} s waiting for ${what}`); await sleep(500); } };
const tool = (n, i) => `[tool ${n} ${JSON.stringify(i)}]`;
const G = CASES.goal, K = CASES.prep.role;

// ---- crewd: actions by HTTP, observation read-only ----
const H = () => ({ 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${o.key}` });
const api = async (m, p, body) => { const r = await fetch(o.url + p, { method: m, headers: H(), body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${await r.text()}`); return r.json(); };
const state = () => api('GET', '/api/state');
const db = () => new DatabaseSync(join(o.state, 'crew.db'), { readOnly: true });
const ENDED = ['done', 'failed', 'unsure'];

/** One case on the real route: send, wait for the bot's task to end (a task that parks says why), and keep what it cost. */
async function ran(bot, send, ms) {
  const d = db(), t0 = Date.now(), floor = d.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM tasks').get().id;
  const sent = await send();
  const id = sent?.task ?? (await until(`${bot} to take the job`, () => d.prepare('SELECT id FROM tasks WHERE bot = ? AND id > ? ORDER BY id LIMIT 1').get(bot, floor), 60_000)).id;
  const row = await until(`${bot}'s task ${id} to end`, () => { const t = d.prepare('SELECT * FROM tasks WHERE id = ?').get(id); if (t.state === 'paused') throw new Error(`the task parked: ${String(t.result).slice(0, 200)}`); return ENDED.includes(t.state) && t; }, ms);
  const calls = d.prepare("SELECT data FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') = ? ORDER BY seq").all(id).map((e) => JSON.parse(e.data));
  d.close();
  return { task: id, state: row.state, seconds: Math.round((Date.now() - t0) / 1000), tokens: row.tokens ?? null, reply: String(row.result ?? '').slice(0, 300),
    calls: calls.length, refused: calls.filter((c) => !c.ok).length, refusals: calls.filter((c) => !c.ok).slice(0, 3).map((c) => `${c.tool}: ${c.head}`) };
}

// ---- seed: stub engine ----
async function seed() {
  const web = await serve(+o.port);
  await api('POST', '/api/onboard', { address: CASES.person });
  await api('POST', '/api/bots/chief/messages', { text: `Find me roles ${tool('crew_goal', { title: CASES.seedTitle, places: G.places, floor: G.floor, cv: CV })}` });
  const d = db(), ask = await until('the goal card', () => d.prepare("SELECT id FROM asks WHERE kind = 'propose' AND state = 'open'").get());
  await api('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow', scope: 'once' });
  const { goal } = await until('the board', async () => (await state()).goals[0]);
  const quiet = () => d.prepare("SELECT COUNT(*) AS n FROM tasks WHERE state IN ('queued', 'working', 'needs_you', 'paused')").get().n === 0;
  await until('the first look to end', quiet);
  await api('POST', `/api/bots/${goal.rae}/messages`, { text: `Found one ${tool('crew_role', { goal: goal.id, company: K.co, title: K.title, place: K.place, url: `${web.base}/job/${K.n}`, pay: K.pay, missing: 'GraphQL is not on your CV', fit: [{ says: 'You led a React and TypeScript team', cv: CASES.cv[2] }] })}` });
  const role = await until('the role on the board', async () => (await state()).goals[0].roles.find((r) => r.co === K.co));
  await api('POST', `/api/jobs/${role.id}`, { stage: 'interview' });
  await until('the first task to end', quiet);
  d.close(); web.close();
  console.log(JSON.stringify({ goal: goal.id, rae: goal.rae, will: goal.will, role: role.id }));
}

// ---- helper: the three cases through the product ----
/** What the stub engine is scripted to do instead of a model: the good answer to each case, to prove the pipeline and the scorer without an account. */
const SCRIPT = {
  roles: (web, g) => CASES.postings.filter((p) => p.label === 'fit').map((p) => tool('crew_role', { goal: g, company: p.co, title: p.title, place: p.place, url: `${web.base}/job/${p.n}`, pay: p.pay, missing: `${p.gap} is not on your CV`, fit: [{ says: 'You work in React and TypeScript', cv: CASES.cv[2] }] })),
  prep: (id) => tool('crew_prep', { role: id, brief: [['/company/kestrel', 'processes card payments for 4,000 small shops'], ['/company/kestrel', 'founded in 2019 and has 120 people'], ['/company/kestrel/engineering', 'squads of five'], ['/company/kestrel/engineering', 'moving its REST endpoints to GraphQL'], ['/company/kestrel/engineering', 'released daily']].map(([path, quote]) => ({ says: `Kestrel: ${quote}`, url: `http://127.0.0.1:${o.port}${path}`, quote })),
    questions: ['How did you make the checkout on your last project faster?', 'What would you do first to speed up our checkout widget?', 'Tell us about moving an API to GraphQL.', 'How do you run an on-call week in a squad of five?', 'How do you keep a React and TypeScript codebase tidy?', 'How do you ship safely behind a feature flag?'].map((ask) => ({ ask, why: 'They want to hear how you work.' })) }),
};
async function helper() {
  const web = await serve(+o.port), st = await state(), g = st.goals[0]?.goal, kestrel = st.goals[0]?.roles.find((r) => r.co === K.co);
  if (!kestrel) throw new Error('the seeded board is missing: run the seed step first');
  const real = o.engine !== 'stub', ms = Number(o.wait ?? 900) * 1000, out = { arm: 'helper', engine: real ? 'openclaw' : 'stub', cases: {} };
  if (real) {
    const row = await until('Claude to read as signed in', async () => (await api('GET', '/api/accounts')).find((a) => a.provider === 'claude' && a.signedIn && !a.restingUntil), 120_000);
    const m = await api('GET', '/api/accounts/1/claude/model'), model = o.model || m.dflt || m.models[0]?.id;
    await api('PUT', '/api/accounts/1/claude/model', { model });
    out.model = { account: 'claude', id: model, plan: row.plan ?? null, offered: m.models.map((x) => x.id) };
  } else out.model = { account: 'stub', id: 'scripted' };
  if (NAMES.includes('goal')) {
    const d = db(), floor = d.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM asks').get().id, own = `${G.ask}\n\n${CV}`;
    const run = await ran('chief', () => api('POST', '/api/bots/chief/messages', { text: real ? own : `${own} ${tool('crew_goal', { title: G.title, places: G.places, floor: G.floor, cv: CV })}` }), ms);
    const ask = d.prepare("SELECT id, detail FROM asks WHERE kind = 'propose' AND id > ? ORDER BY id LIMIT 1").get(floor), got = ask && JSON.parse(ask.detail).goal;
    if (ask) await api('POST', `/api/asks/${ask.id}/answer`, { answer: 'deny' }); // the card is what is judged; nothing starts
    d.close(); out.cases.goal = { run, output: got ?? null, ...scoreGoal(got) };
  }
  if (NAMES.includes('shortlist')) {
    const text = jobs.findTask({ id: g.id, title: g.title, places: g.places, floor: g.floor, brief: CV, sources: `the open roles page at ${web.base}/jobs (read it, then open each role's own page)` });
    const run = await ran(g.rae, () => api('POST', `/api/bots/${g.rae}/messages`, { text: real ? text : SCRIPT.roles(web, g.id)[0] }), ms);
    if (!real) for (const t of SCRIPT.roles(web, g.id).slice(1)) await ran(g.rae, () => api('POST', `/api/bots/${g.rae}/messages`, { text: t }), ms);
    const roles = (await state()).goals[0].roles.filter((r) => r.id !== kestrel.id);
    out.cases.shortlist = { run, output: { roles }, ...scoreShortlist({ roles }, web) };
  }
  if (NAMES.includes('prep')) {
    const run = await ran(g.will, () => api('POST', `/api/jobs/${kestrel.id}/prep`), ms);
    if (!real) await ran(g.will, () => api('POST', `/api/bots/${g.will}/messages`, { text: SCRIPT.prep(kestrel.id) }), ms);
    const got = (await state()).goals[0].roles.find((r) => r.id === kestrel.id).prep;
    out.cases.prep = { run, output: got, ...scorePrep(got, web) };
  }
  web.close(); writeFileSync(o.out, JSON.stringify(out, null, 1));
  console.log(summary(out));
}

// ---- baseline: the plain model ----
const pageText = (web, path) => `${web.base}${path}\n${web.text(path)}`;
const SHAPE = {
  goal: '{"title": "...", "places": "...", "floor": "...", "brief": "..."}',
  shortlist: '[{"company": "...", "title": "...", "place": "...", "url": "...", "pay": "...", "fit": [{"says": "...", "cv": "..."}], "missing": "..."}]',
  prep: '{"brief": [{"says": "...", "url": "...", "quote": "..."}], "questions": [{"ask": "...", "why": "..."}]}',
};
/** What each baseline is asked. `plain` names the job and the answer's shape and nothing else; `rules` adds the sentences the helper's own
 *  task text and tool descriptions carry (src/jobs.ts, src/crew.ts), so the gap between the two is the prompt and the gap to the helper is crewd's tools and checks. */
const PROMPTS = {
  goal: (web, rules) => [`${G.ask}\n\n${CV}`, `Turn this into my job-search goal. Reply with only JSON: ${SHAPE.goal}. brief is my CV${rules ? ' in full, every line copied exactly as I wrote it, nothing added' : ''}.`],
  shortlist: (web, rules) => [`${G.ask.replace(' Here is my CV:', '')} My CV:\n${CV}\n\nThe open roles page and each role's page:\n\n${['/jobs', ...CASES.postings.map((p) => `/job/${p.n}`)].map((p) => pageText(web, p)).join('\n\n')}`,
    `Which of these roles belong on my shortlist? Reply with only JSON, an array with one object per role: ${SHAPE.shortlist}. pay is the pay the page shows; fit says why it fits and quotes the line of my CV that shows it; missing is what the role asks for that my CV does not show.${rules ? ' Copy the pay word for word from the page, or leave it empty when the page shows none. Quote CV lines exactly as written. Never claim anything my CV does not show. Skip anything past my limit. List each role once. Use only these pages.' : ''}`],
  prep: (web, rules) => [`I have an interview for the ${K.title} role at ${K.co}. My CV:\n${CV}\n\nThe role's page and the company's pages:\n\n${[`/job/${K.n}`, ...Object.keys(CASES.prep.pages)].map((p) => pageText(web, p)).join('\n\n')}`,
    `Prepare me. Reply with only JSON: ${SHAPE.prep}. brief is a one-page company brief of facts, each with the page it came from (url) and words from that page (quote); questions are the ones I am likely to be asked, each with why they ask it.${rules ? ' Give 5 to 10 facts, each saying one thing, and leave out any fact with no page. Give 6 to 10 questions. Questions about pay, notice, visa, right to work or consent are mine to answer: list them, never answer them. Never write my answers.' : ''}`],
};
const json = (s) => { const t = String(s); const i = t.search(/[[{]/), j = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']')); try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; } };
const NORMAL = {
  goal: (v) => v && !Array.isArray(v) ? { ...v, brief: Array.isArray(v.brief) ? v.brief.join('\n') : v.brief } : null,
  shortlist: (v) => { const list = Array.isArray(v) ? v : v?.roles; return list ? { roles: list.map((r) => ({ co: r.company ?? r.co, title: r.title, place: r.place, pay: r.pay, fit: r.fit, gap: r.missing ?? r.gap, url: r.url })) } : null; },
  prep: (v) => v && !Array.isArray(v) ? v : null,
};
/** A model-free stand-in for the stub run: plain-sounding answers with the slips a plain model makes, so the scorer has something to catch. */
const CANNED = (name) => name === 'goal' ? { title: 'Frontend engineer', places: 'London', floor: '50k', brief: 'Frontend engineer, 6 years, React and TypeScript, payments and checkout work.' }
  : name === 'shortlist' ? CASES.postings.filter((p) => p.label !== 'dup').slice(0, 5).map((p) => ({ company: p.co, title: p.title, place: p.place, url: `http://127.0.0.1:${o.port}/job/${p.n}`, pay: p.pay.replace(/,000/g, 'k'), fit: [{ says: 'Good match', cv: 'Strong React background' }], missing: '' }))
  : { brief: [{ says: 'Kestrel is a payments firm', url: `http://127.0.0.1:${o.port}/company/kestrel`, quote: 'processes card payments for 4,000 small shops' }], questions: ['Why Kestrel?', 'Tell us about yourself.', 'What is your expected salary? Say about £60,000.'].map((ask) => ({ ask, why: 'Standard.' })) };
async function baseline() {
  const web = await serve(+o.port), real = o.engine !== 'stub', out = { arm: 'baseline', engine: real ? 'claude-cli' : 'stub', model: o.model || null, variants: {} };
  const ask = (p, system) => { // the Claude CLI as it is: no tools, no settings, no Crewhouse prompt
    const r = spawnSync(o.cli || 'claude', ['-p', '--model', o.model, '--system-prompt', system, '--tools', '', '--no-session-persistence', '--output-format', 'json', '--disable-slash-commands', '--strict-mcp-config'],
      { input: p, encoding: 'utf8', timeout: Number(o.wait ?? 900) * 1000, maxBuffer: 1 << 24, env: { PATH: process.env.PATH, HOME: o.home, LANG: 'C.UTF-8' } });
    const reply = json(r.stdout) ?? {};
    if (r.status !== 0 || reply.is_error) throw new Error(`the Claude CLI failed: ${String(reply.result ?? r.stderr ?? r.error).slice(0, 300)}`);
    return { text: String(reply.result ?? ''), models: Object.keys(reply.modelUsage ?? {}), cost: reply.total_cost_usd ?? null, seconds: Math.round((reply.duration_ms ?? 0) / 1000) };
  };
  for (const variant of ['plain', 'rules']) {
    out.variants[variant] = { cases: {} };
    for (const name of NAMES) {
      const [facts, job] = PROMPTS[name](web, variant === 'rules'), prompt = `${facts}\n\n${job}`;
      const said = real ? ask(prompt, 'You are a helpful assistant.') : { text: JSON.stringify(CANNED(name)), models: ['scripted'] };
      const got = NORMAL[name](json(said.text)), score = { goal: scoreGoal, shortlist: scoreShortlist, prep: scorePrep }[name];
      out.variants[variant].cases[name] = { run: { seconds: said.seconds, cost: said.cost, models: said.models }, prompt, reply: said.text, output: got, ...score(got, web) };
      out.models = said.models;
    }
  }
  web.close(); writeFileSync(o.out, JSON.stringify(out, null, 1));
  for (const [v, x] of Object.entries(out.variants)) console.log(`${v}: ${summary({ cases: x.cases })}`);
}
const pct = (x) => `${Math.round(x * 100)}%`;
const summary = (a) => Object.entries(a.cases).map(([n, c]) => `${n} ${pct(c.score)}`).join(', ');

// ---- report ----
const sha = (...parts) => createHash('sha256').update(parts.join('\n---\n')).digest('hex').slice(0, 12);
const git = (...a) => { try { return execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
function report() {
  const dir = resolve(o.dir), files = (p) => readdirSync(dir).filter((f) => f.startsWith(p)).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const helpers = files('helper-'), bases = files('baseline-');
  if (!helpers.length) throw new Error(`no helper-*.json in ${dir}`);
  const arms = { helper: helpers.map((h) => h.cases), plain: bases.map((b) => b.variants.plain.cases), rules: bases.map((b) => b.variants.rules.cases) };
  const cases = Object.keys(helpers[0].cases), checks = (arm, c) => Object.fromEntries(arms[arm][0]?.[c]?.checks.map((k, i) => [k.id, avg(arms[arm].map((r) => r[c].checks[i].score).filter((s) => s !== null))]) ?? []);
  const mean = Object.fromEntries(Object.keys(arms).map((arm) => [arm, Object.fromEntries(cases.map((c) => [c, avg(arms[arm].map((r) => r[c].score))]))]));
  const total = Object.fromEntries(Object.keys(mean).map((arm) => [arm, avg(Object.values(mean[arm]))]));
  const losses = cases.flatMap((c) => arms.helper[0][c].checks.map((k) => ({ case: c, id: k.id, label: k.label, helper: checks('helper', c)[k.id], plain: checks('plain', c)[k.id], rules: checks('rules', c)[k.id] })))
    .filter((r) => r.helper < Math.max(r.plain ?? 0, r.rules ?? 0) - 1e-9);
  const sample = jobs.findTask({ id: 1, title: G.title, places: G.places, floor: G.floor, brief: CV, sources: 'SOURCES' }), role = { id: 1, title: K.title, co: K.co, place: K.place, url: 'URL' };
  const promptFiles = ['chief', 'scout', 'scribe'].flatMap((t) => ['soul.md', 'AGENTS.md', 'bot.json'].map((f) => readFileSync(join(REPO, 'templates', t, f), 'utf8')));
  const record = { at: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain', '--', 'src', 'templates', 'scripts/jobs-eval', 'scripts/jobs-eval.sh'),
    engine: helpers[0].engine, model: helpers[0].model, baselineModels: bases[0]?.models ?? [], claudeCli: helpers[0].engine === 'stub' ? null : spawnSync(o.cli || 'claude', ['--version'], { encoding: 'utf8' }).stdout.trim(),
    rubric: RUBRIC_VERSION, cases: CASES.version, runs: helpers.length,
    prompt: sha(...promptFiles, sample, jobs.prepTask({ brief: CV }, role), JSON.stringify(Object.values(PROMPTS).map((f) => f({ base: 'B', text: () => 'T' }, false).concat(f({ base: 'B', text: () => 'T' }, true)))), readFileSync(new URL('./cases.json', import.meta.url), 'utf8')),
    mean, total };
  const rows = cases.map((c) => `| ${c} | ${pct(mean.helper[c])} | ${pct(mean.plain[c])} | ${pct(mean.rules[c])} |`);
  const text = [`# Jobs eval — ${record.at}`, '',
    `Commit ${record.commit.slice(0, 10)}${record.dirty ? ' (uncommitted changes in the files under test)' : ''} · engine ${record.engine} · model ${record.model?.id} (${record.model?.account}) · baseline model ${record.baselineModels.join(', ') || 'n/a'} · prompt ${record.prompt} · rubric v${RUBRIC_VERSION} · cases v${CASES.version} · ${helpers.length} run${helpers.length > 1 ? 's' : ''} per arm`, '',
    ...(record.engine === 'stub' ? ['**Stub engine: scripted answers, no model. This proves the harness and scorer only; it is not a result.**', ''] : []),
    '| case | helper | plain model | plain model + the same rules |', '|---|---|---|---|', ...rows, `| **mean** | **${pct(total.helper)}** | **${pct(total.plain)}** | **${pct(total.rules)}** |`, '',
    `## Where the helper loses (${losses.length} check${losses.length === 1 ? '' : 's'})`, '', ...(losses.length ? ['| case | check | helper | plain | plain + rules |', '|---|---|---|---|---|', ...losses.map((r) => `| ${r.case} | ${r.label} | ${pct(r.helper)} | ${pct(r.plain)} | ${pct(r.rules)} |`)] : ['None: no check where the helper scored below a baseline.']), '',
    '## Every check', '', '| case | check | helper | plain | plain + rules |', '|---|---|---|---|---|', ...cases.flatMap((c) => arms.helper[0][c].checks.map((k) => `| ${c} | ${k.label} | ${pct(checks('helper', c)[k.id])} | ${pct(checks('plain', c)[k.id])} | ${pct(checks('rules', c)[k.id])} |`)), '',
    '## What the helper did', '', '| run | case | task ended | seconds | tool calls | refused by crewd | first refusals |', '|---|---|---|---|---|---|---|',
    ...helpers.flatMap((h, i) => Object.entries(h.cases).map(([c, x]) => `| ${i + 1} | ${c} | ${x.run.state} | ${x.run.seconds} | ${x.run.calls} | ${x.run.refused} | ${x.run.refusals.join(' ; ').replace(/\|/g, '/') || '-'} |`)), ''].join('\n');
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ record, helpers, bases }, null, 1)); writeFileSync(join(dir, 'report.md'), text);
  if (o.ledger) appendFileSync(o.ledger, `${JSON.stringify(record)}\n`);
  console.log(text);
}

const step = { seed, helper, baseline, report }[cmd];
if (!step) throw new Error('usage: run.mjs <seed|helper|baseline|report> --url … --key … --state … --port … --out …');
await step();
