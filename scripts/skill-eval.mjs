#!/usr/bin/env node
// A paired eval for one bundled skill: the same prompts, with and without the skill, on the stub engine.
//
//   node scripts/skill-eval.mjs [--skill crewhouse-research-report] [--prompts <csv>] [--world <json>]
//                              [--out <dir>] [--jsonl <file>] [--html <file>] [--strict]
//
// Three things, all deterministic:
//   1. Trigger: does the skill's own name and description match the prompt? The prompt set's should_trigger
//      column is the label; the harness reports the agreement, misses and false alarms included.
//   2. Effect: the same prompt run twice - once with the skill in the helper's folder, once without - and each
//      run's document checked against the rubric below.
//   3. Cost: the prompt the run carried, and the tokens it spent.
//
// What it does not measure, and says so in its report: the stub engine has no model. The run's actions are
// scripted here - from the skill's own steps when the skill fires, from a plain good answer when it does not.
// So this measures whether a skill is actionable on this product, and whether its description matches the
// prompts it is for. A live-model arm (the same prompts on a real account) is the next slice.
//
// The two arms: with the skill, the run follows the skill's own steps (its sections, its number of sources, its
// closing line). Without it, the run is a plain good answer: it reads the page most people would check and
// writes the answer and what it found, one source, no procedure. A prompt the description does not match gets
// the plain answer in both arms.
//
// No account, no network, no model: the pages a run reads are fixture pages on loopback, served by this script.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const HERE = import.meta.dirname, REPO = join(HERE, '..');
const args = process.argv.slice(2), flag = (name) => args.includes(name), opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const SKILL_FILE = opt('--skill-file') ? resolve(process.cwd(), opt('--skill-file')) : join(REPO, 'skills', opt('--skill', 'crewhouse-research-report'), 'SKILL.md');
// The skill's folder name is its slug: the name a helper's folder and the app's list carry it under.
const SLUG = opt('--skill-file') ? basename(dirname(SKILL_FILE)) : opt('--skill', 'crewhouse-research-report');
const PROMPT_FILE = resolve(REPO, opt('--prompts', 'scripts/skill-eval-prompts.csv'));
const WORLD_FILE = resolve(REPO, opt('--world', 'scripts/skill-eval-world.json'));
const OUT = resolve(process.cwd(), opt('--out', 'skill-eval'));
const JSONL = resolve(process.cwd(), opt('--jsonl', join(OUT, 'results.jsonl')));
const HTML = resolve(process.cwd(), opt('--html', join(OUT, 'report.html')));

// ---- the prompt set: id, prompt, should_trigger ----
function readCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c !== '"') field += c; else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.some((f) => f.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const PROMPTS = readCsv(readFileSync(PROMPT_FILE, 'utf8'));
const WORLD = JSON.parse(readFileSync(WORLD_FILE, 'utf8'));

// ---- the skill under test: its words, and what its steps demand ----
if (!existsSync(SKILL_FILE)) throw new Error(`skill-eval: no skill file at ${SKILL_FILE}`);
const SKILL_TEXT = readFileSync(SKILL_FILE, 'utf8');
const FRONT = /^---\n([\s\S]*?)\n---\n/.exec(SKILL_TEXT)?.[1] ?? '', BODY = SKILL_TEXT.replace(/^---\n[\s\S]*?\n---\n/, '');
const field = (key) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(FRONT)?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
const NAME = field('name') || SLUG, DESCRIPTION = field('description'), SAYS = field('says');
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const count = (word) => NUMBERS[String(word ?? '').toLowerCase()] ?? (Number(word) || 0);
const DELIVER = /deliver with (crew_\w+)/i.exec(BODY), DELIVER_TOOL = DELIVER?.[1] ?? null;
const DELIVER_STEP = DELIVER ? BODY.slice(BODY.indexOf(DELIVER[0]), BODY.indexOf(DELIVER[0]) + 400) : '';
const SECTIONS = [...DELIVER_STEP.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());
const MIN_SOURCES = count(/at least (one|two|three|four|five|six|seven|eight|nine|ten|\d+) (?:independent )?sources?/i.exec(BODY)?.[1]);
const MIN_ANGLES = count(/(\w+) to \w+ different angles/i.exec(BODY)?.[1]);
const WANTS_CLOSING = /end with .*(did not check|where you looked)/i.test(BODY);
const WANTS_POPULAR = /including the source most people would check/i.test(BODY);

// ---- trigger: the words a model reads before it decides (the name and the description) ----
const STOP = new Set('a an the for use uses used any out what is and or of to in on my me it that this with do does did i you your be are was were short long look back thing also just like need want keep come some more most than then they them from as at by get got make made give only which who when where why how all both each'.split(' '));
const PHRASES = [...DESCRIPTION.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => (m[1] ?? m[2]).toLowerCase());
const WORDS = [...new Set(`${DESCRIPTION} ${SAYS}`.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((w) => !STOP.has(w));
const SLUG_WORDS = new Set(SLUG.split('-').filter((w) => w.length >= 4));
const trigger = (prompt) => {
  const p = prompt.toLowerCase();
  const phrase = PHRASES.find((q) => new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(p));
  if (phrase) return { fired: true, why: `the description's phrase "${phrase}"` };
  const named = [...SLUG_WORDS].filter((w) => new RegExp(`\\b${w}\\b`).test(p));
  if (named.length) return { fired: true, why: `the skill's own name word "${named[0]}"` };
  const hit = WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(p));
  if (hit.length >= 2) return { fired: true, why: `the description's words ${hit.slice(0, 3).join(', ')}` };
  return { fired: false, why: 'no word or phrase of the name or description matched' };
};
/** The skill was on offer in the run: the prompt named it in the list of skills the helper follows. */
const offered = (system) => new RegExp(`^- ${SLUG}:`, 'm').test(system);

// ---- the fixture web: the pages a run reads, on loopback ----
const PAGES = new Map();
for (const [id, world] of Object.entries(WORLD)) for (const page of world.pages) PAGES.set(page.path, `# ${page.title}\n${page.fact}`);
const server = createServer((req, res) => {
  const body = PAGES.get(req.url.split('?')[0]);
  if (!body) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('No such page.'); return; }
  res.writeHead(200, { 'content-type': 'text/plain' }); res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ---- what the model does in each arm: the skill's steps when it fires, a plain good answer when it does not ----
const call = (name, input) => `[tool ${name} ${JSON.stringify(input)}]`;
const roleOf = (label) => /answer|summary/i.test(label) ? 'answer' : /finding|evidence|detail|result/i.test(label) ? 'findings'
  : /source|reference|link/i.test(label) ? 'sources' : /question|unknown|open/i.test(label) ? 'open' : null;
function planFor(prompt, arm) {
  const world = WORLD[prompt.id], pages = world.pages, fired = arm === 'with' && trigger(prompt.prompt).fired;
  const wanted = Math.max(1, MIN_SOURCES, MIN_ANGLES), reads = [], popular = pages.find((p) => p.popular);
  if (fired && WANTS_POPULAR && popular) reads.push(popular);
  for (const page of pages) { if (reads.length >= wanted) break; if (!reads.includes(page)) reads.push(page); }
  if (!fired) { reads.length = 0; reads.push(popular ?? pages[0]); } // no procedure: the one page most people would check
  const skipped = pages.filter((p) => !reads.includes(p)), answer = reads[0].fact, url = (p) => `${ORIGIN}${p.path}`;
  const calls = reads.map((p) => call('crew_web_fetch', { url: url(p) }));
  if (!fired) { // a plain good answer: what it found and where it came from, one source, no procedure
    calls.push(call('crew_document', { name: world.title, blocks: [{ text: answer }, { bullets: reads.map((p) => `${p.fact} (${p.title} - ${url(p)})`) }] }));
    return { fired, reads, skipped, calls };
  }
  if (!DELIVER_TOOL) return { fired, reads, skipped, calls }; // the skill asks for no document
  const sections = [];
  for (const label of SECTIONS.length ? SECTIONS : ['Answer']) {
    const role = roleOf(label);
    if (role === 'open' && !world.open?.length) continue; // the skill says: omit it when there is none
    sections.push({ heading: label, role });
  }
  const blocks = [];
  for (const section of sections) {
    blocks.push({ heading: section.heading });
    if (section.role === 'answer') blocks.push({ text: answer });
    else if (section.role === 'findings') blocks.push({ bullets: reads.map((p) => `${p.fact} (${p.title})`) });
    else if (section.role === 'sources') blocks.push({ bullets: reads.map((p) => `${p.title} - ${url(p)}`) });
    else if (section.role === 'open') blocks.push({ bullets: world.open });
    else blocks.push({ text: answer });
  }
  if (WANTS_CLOSING) blocks.push({ text: `I checked ${reads.map((p) => p.title).join(' and ')}; I didn't check ${skipped.map((p) => p.title).join(' and ')}.` });
  calls.push(call(DELIVER_TOOL, { name: world.title, blocks }));
  return { fired, reads, skipped, calls };
}

// ---- the rubric: what a research report in this product owes the person ----
const words = (text) => (text.match(/\S+/g) ?? []).length;
const sectionOf = (parts, title) => {
  const at = parts.findIndex((p) => p.kind === 'heading' && (p.text ?? '').toLowerCase() === title);
  if (at < 0) return null;
  const items = [], paras = [];
  for (const p of parts.slice(at + 1)) { if (p.kind === 'heading') break; if (p.kind === 'li') items.push(p.text ?? ''); else if (p.kind === 'p') paras.push(p.text ?? ''); }
  return { items, paras };
};
const CHECKS = [
  { id: 'R1', name: 'the run delivered a document the person can open', ok: (r) => !!r.document },
  { id: 'R2', name: 'the answer comes first, in one line', ok: (r) => { const first = (r.parts ?? []).find((p) => p.kind === 'p'); return !!first && words(first.text ?? '') <= 25; } },
  { id: 'R3', name: 'the findings have their own section', ok: (r) => (sectionOf(r.parts ?? [], 'findings')?.items.length ?? 0) > 0 },
  { id: 'R4', name: 'every finding names a source in the sources list', ok: (r) => { const f = sectionOf(r.parts ?? [], 'findings'), s = sectionOf(r.parts ?? [], 'sources'); if (!f?.items.length || !s?.items.length) return false; return f.items.every((i) => s.items.some((line) => i.includes((line.split(' - ')[0] ?? '').trim()))); } },
  { id: 'R5', name: 'two independent sources are named', ok: (r) => { const s = sectionOf(r.parts ?? [], 'sources'); return new Set((s?.items ?? []).map((i) => i.match(/https?:\/\/\S+/)?.[0] ?? i)).size >= 2; } },
  { id: 'R6', name: 'it says what it did not check', ok: (r) => { const last = (r.parts ?? []).filter((p) => p.kind === 'p').at(-1)?.text ?? ''; return /did ?n[o']t check/i.test(last) && r.skipped.some((p) => last.includes(p.title)); } },
  { id: 'R7', name: 'it is under a page', ok: (r) => words((r.parts ?? []).map((p) => p.text ?? '').join(' ')) <= 500 },
  { id: 'R8', name: 'every link in it was really fetched', ok: (r) => [...((r.parts ?? []).map((p) => p.text ?? '').join(' ').match(/https?:\/\/[^\s)]+/g) ?? [])].every((u) => r.fetched.includes(u)) },
];

// ---- one run: the real crew, on the stub engine, in its own lab ----
const { Store } = await import(join(REPO, 'src/db.ts'));
const { Crew } = await import(join(REPO, 'src/crew.ts'));
const { loadConfig } = await import(join(REPO, 'src/config.ts'));
async function runOne(prompt, arm, plan) {
  const lab = mkdtempSync(join(tmpdir(), 'skill-eval-'));
  process.env.CREWHOUSE_ENGINE = 'stub'; process.env.CREWHOUSE_RUN_MODE = 'test';
  process.env.CREWHOUSE_RUN_HOME = join(lab, 'home'); process.env.HOME = join(lab, 'home');
  process.env.CREWHOUSE_STATE_DIR = join(lab, 'state'); process.env.CREWHOUSE_CREW_DIR = join(lab, 'crew');
  process.env.CREWHOUSE_TOOLS_DIR = join(lab, 'tools'); process.env.CREWHOUSE_ENGINE_DIR = join(lab, 'engine');
  process.env.CREWHOUSE_GOOGLE_CLIENT = join(lab, 'absent-google-client.json');
  for (const dir of ['home', 'state', 'crew', 'tools']) mkdirSync(join(lab, dir), { recursive: true });
  const cfg = { ...loadConfig(), stateDir: join(lab, 'state'), crewDir: join(lab, 'crew'), toolsDir: join(lab, 'tools'), engine: 'stub', maxConcurrent: 2 };
  const db = new Store(cfg.stateDir), crew = new Crew(cfg, db);
  try {
    crew.init();
    const bot = crew.recruit('scout', 'Research Rae', 'person'), dir = join(cfg.crewDir, 'bots', bot.id, 'skills', SLUG);
    if (arm === 'with') { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'SKILL.md'), SKILL_TEXT); }
    else rmSync(dir, { recursive: true, force: true }); // the baseline arm has no such skill
    const { task } = await crew.post(bot.id, [prompt.prompt, ...plan.calls].join(' '));
    const until = Date.now() + 30_000;
    let row = db.get('SELECT * FROM tasks WHERE id = ?', task);
    while (Date.now() < until && ['queued', 'working'].includes(row.state)) { await new Promise((r) => setTimeout(r, 40)); row = db.get('SELECT * FROM tasks WHERE id = ?', task); }
    const calls = db.all("SELECT data FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') = ?", task).map((r) => JSON.parse(r.data));
    const fetched = calls.filter((c) => c.tool === 'crew_web_fetch').map((c) => JSON.parse(c.input ?? '{}').url).filter(Boolean);
    const files = db.all("SELECT data FROM events WHERE kind = 'file.delivered' AND bot = ? AND json_extract(data, '$.task') = ?", bot.id, task).map((r) => JSON.parse(r.data));
    const path = files.map((f) => f.path).find((p) => String(p).endsWith('.docx'));
    const view = path ? await crew.documentView(bot.id, path).catch(() => null) : null;
    const system = crew.runtime.specOf(row.session)?.system ?? '';
    return {
      prompt_id: prompt.id, arm, task_state: row.state, fired: plan.fired,
      tools: calls.map((c) => c.tool), fetched, document: path ?? null, parts: view?.parts ?? [],
      reply: db.get("SELECT text FROM messages WHERE bot = ? AND author = 'bot' ORDER BY id DESC", bot.id)?.text ?? '',
      offered: offered(system), system_chars: system.length, tokens: row.tokens ?? 0,
      skipped: plan.skipped.map((p) => ({ title: p.title })),
    };
  } finally { crew.stop(); db.close(); rmSync(lab, { recursive: true, force: true }); }
}

// ---- the run: every prompt, both arms, and the diff between them ----
const records = [], crewLog = [], say = console.log;
console.log = (...args) => { const line = args.map(String).join(' '); if (/^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] crewd /.test(line)) { crewLog.push(line); return; } say(...args); };
for (const prompt of PROMPTS) {
  const label = prompt.should_trigger === 'yes', decision = trigger(prompt.prompt);
  for (const arm of ['with', 'without']) {
    const run = await runOne(prompt, arm, planFor(prompt, arm));
    const checks = Object.fromEntries(CHECKS.map((c) => [c.id, c.ok(run)]));
    records.push({ ...run, prompt: prompt.prompt, should_trigger: label, trigger_why: decision.why, trigger_fired: decision.fired,
      checks, passed: CHECKS.filter((c) => checks[c.id]).length, total: CHECKS.length });
  }
}
console.log = say;
server.close();

const with_ = records.filter((r) => r.arm === 'with'), without = records.filter((r) => r.arm === 'without');
const passed = (list) => list.reduce((sum, r) => sum + r.passed, 0);
const triggers = PROMPTS.map((p) => ({ id: p.id, label: p.should_trigger === 'yes', fired: trigger(p.prompt).fired, why: trigger(p.prompt).why }));
const hits = triggers.filter((t) => t.label && t.fired).length, misses = triggers.filter((t) => t.label && !t.fired);
const alarms = triggers.filter((t) => !t.label && t.fired);
const delta = passed(with_) - passed(without), beats = delta > 0;
const verdict = beats
  ? `The skill beats the baseline: ${passed(with_)} of ${with_.length * CHECKS.length} checks pass with it, ${passed(without)} without it (${delta > 0 ? '+' : ''}${delta}).`
  : `The skill does NOT beat the baseline: ${passed(with_)} checks with it, ${passed(without)} without it (${delta}). It does not ship in this form.`;

mkdirSync(dirname(JSONL), { recursive: true });
writeFileSync(JSONL, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(join(dirname(JSONL), 'crew.log'), crewLog.join('\n') + '\n');
writeFileSync(HTML, html(records, triggers, verdict, delta, { hits, misses, alarms }));

// ---- what it prints ----
console.log(`skill-eval: ${SLUG} (${NAME}) on the stub engine, ${PROMPTS.length} prompts, two arms\n`);
console.log('prompt          should  fires  why');
for (const t of triggers) console.log(`${t.id.padEnd(14)} ${(t.label ? 'yes' : 'no').padEnd(7)} ${(t.fired ? 'yes' : 'no').padEnd(6)} ${t.why}`);
console.log(`\ntrigger: ${hits}/${triggers.filter((t) => t.label).length} prompts that should fire did; ${misses.length} missed, ${alarms.length} false alarms\n`);
console.log('check                                             with  without');
for (const c of CHECKS) console.log(`${c.name.padEnd(50)} ${String(with_.filter((r) => r.checks[c.id]).length).padEnd(5)} ${without.filter((r) => r.checks[c.id]).length}`);
console.log(`\n${verdict}`);
console.log(`prompt cost: ${with_[0]?.system_chars ?? 0} characters with the skill, ${without[0]?.system_chars ?? 0} without; tokens: ${with_.reduce((s, r) => s + r.tokens, 0)} with, ${without.reduce((s, r) => s + r.tokens, 0)} without.`);
console.log(`\nraw runs: ${JSONL}\nreport:   ${HTML}`);
if (flag('--strict') && !beats) { console.error('skill-eval: the skill does not beat the baseline'); process.exit(1); }

// ---- the report a person reads ----
function bars(rows) {
  const W = 480, bar = (n, max) => (max ? Math.round(W * n / max) : 0);
  return `<svg class="chart" viewBox="0 0 640 ${rows.length * 46 + 4}" role="img" aria-label="${rows.map(([l, n, max]) => `${l}: ${n} of ${max}`).join('; ')}">${rows.map(([label, n, max, fill], i) =>
    `<text x="0" y="${i * 46 + 30}">${label}</text><rect x="130" y="${i * 46 + 8}" width="${W}" height="30" rx="4" fill="#e3e3e0"/><rect x="130" y="${i * 46 + 8}" width="${bar(n, max)}" height="30" rx="4" fill="${fill}"/><text x="138" y="${i * 46 + 30}" ${bar(n, max) > 90 ? 'style="fill:#fff"' : ''}>${n} of ${max}</text>`).join('')}</svg>`;
}
function html(records, triggers, verdict, delta, t) {
  const row = (r) => `<tr><td>${r.id}</td><td>${PROMPTS.find((p) => p.id === r.id)?.prompt ?? ''}</td><td>${r.label ? 'yes' : 'no'}</td><td>${r.fired ? 'yes' : 'no'}</td><td>${r.why}</td></tr>`;
  const check = (id) => `<tr><td>${id}</td><td>${CHECKS.find((c) => c.id === id).name}</td><td>${records.filter((r) => r.arm === 'with' && r.checks[id]).length}/${with_.length}</td><td>${records.filter((r) => r.arm === 'without' && r.checks[id]).length}/${without.length}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Skill eval: ${NAME}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; color: #14161a; background: #fbfbfa; margin: 0; padding: 28px 34px; }
  h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 26px 0 8px; }
  p { margin: 6px 0; max-width: 78ch; color: #3c4048; }
  table { border-collapse: collapse; margin: 8px 0; font-size: 14px; } th, td { text-align: left; padding: 5px 14px 5px 0; border-bottom: 1px solid #e3e3e0; vertical-align: top; }
  th { color: #6b7078; font-weight: 600; } .yes { color: #1f6f4a; font-weight: 600; } .no { color: #a3341f; font-weight: 600; }
  .verdict { font-size: 18px; font-weight: 600; padding: 12px 14px; border-radius: 8px; background: ${beats ? '#eaf4ee' : '#fbeeea'}; display: inline-block; }
  .badge { font-size: 44px; font-weight: 800; letter-spacing: .02em; padding: 14px 30px; border-radius: 14px; display: inline-block; color: #fff; background: ${beats ? '#1f6f4a' : '#a3341f'}; }
  .chart { margin: 10px 0 4px; max-width: 640px; } .chart text { font: 600 15px system-ui, sans-serif; fill: #14161a; } .chart .sub { font-weight: 400; fill: #6b7078; font-size: 13px; }
  code { background: #f0f0ee; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
</style></head><body>
<h1>Skill eval: ${NAME}</h1>
<p>The same ${PROMPTS.length} prompts, run with and without <code>${SLUG}</code> on the stub engine. Every run is deterministic: no account, no network, no model. The pages a run reads are fixture pages on loopback.</p>
<p><span class="badge">${beats ? 'BEATS THE BASELINE' : 'DOES NOT BEAT THE BASELINE'}</span></p>
<p class="verdict">${verdict}</p>
<h2>Checks passed, with the skill and without it</h2>
${bars([['With the skill', passed(with_), with_.length * CHECKS.length, '#1f6f4a'], ['Without it', passed(without), without.length * CHECKS.length, '#8d929a']])}
<h2>Trigger: prompts that fired</h2>
${bars([['Should fire', t.hits, triggers.filter((x) => x.label).length, '#1f6f4a'], ['Should not fire', t.alarms.length, triggers.filter((x) => !x.label).length, '#a3341f']])}
<h2>Trigger: does the description match the prompt?</h2>
<table><tr><th>id</th><th>prompt</th><th>should fire</th><th>fired</th><th>why</th></tr>${triggers.map(row).join('')}</table>
<p>${t.hits} of the prompts that should fire did. ${t.misses.length} missed, ${t.alarms.length} false alarms.</p>
<h2>Effect: the checks, both arms</h2>
<table><tr><th>check</th><th>what it asks</th><th>with the skill</th><th>without it</th></tr>${CHECKS.map((c) => check(c.id)).join('')}</table>
<h2>The two arms</h2>
<p>With the skill, the run follows the skill's own steps: the sections it names, the number of sources it asks for, the closing line it asks for. Without it, the run is a plain good answer: it reads the page most people would check and writes the answer and what it found, one source, no procedure. A prompt the description does not match gets the plain answer in both arms, so the negative control shows the harness does not apply the skill to everything.</p>
<h2>What this does not measure</h2>
<p>The stub engine has no model: the run's actions are scripted from the skill's own steps when the skill fires, and from a plain good answer when it does not. So this measures whether the skill is actionable on this product and whether its description matches the prompts it is for - not a model's judgement. A live-model arm is the next slice.</p>
</body></html>`;
}
