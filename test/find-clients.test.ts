// Tracer's find-clients job: a website in, one workbook out — the segments worth pursuing, ten real companies with the
// sourced fact that makes each a fit, the right person, a work email only where a verified lookup returned one, a grounded
// opener, and what every lookup cost — plus one draft card and nothing sent. Every paid lookup raises its card and runs
// only after the person says yes; a no leaves no email behind and the run finishes anyway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.CREWHOUSE_HOLD_MS ??= '9000'; // the ask cards are answered by hand here; give the run room to reach them
const { setup: lab, settled, until, holding, release, lastSaid } = await import('./lab.ts');
const task = (db: any, id: number) => db.get('SELECT * FROM tasks WHERE id = ?', id);
const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;

const EMAIL = 'ada@fernwood.example';
/** treg, standing in for the real one: it records every call so the test can see what money did, and never before. */
function fakeTreg(root: string) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(root, 'treg.log');
  writeFileSync(join(bin, 'treg'), `#!/bin/sh\necho "$@" >> "${log}"\ncase "$1" in\n`
    + `  catalog) echo "treg.people.email.find 0.05 per verified work email" ;;\n`
    + `  call) echo '{"full_name":"Ada Whitfield","email":"${EMAIL}","verified":"valid"}' ;;\n`
    + `  *) echo "error: refused" ;;\nesac\n`, { mode: 0o755 });
  return { log, path: `${bin}:${process.env.PATH}` };
}

const companies = [
  ['Fernwood Joinery', 'fernwood.example', 'restored the town hall roof in 2025', 'https://fernwood.example/projects/town-hall'],
  ['Bramble & Co', 'bramble.example', 'runs a two-day furnituremaking course each spring', 'https://bramble.example/courses'],
];
const people = (email: string | null) => companies.map(([c, d], n) => [
  c, n ? 'Head of buying' : 'Founder', n ? 'Sam Idowu' : 'Ada Whitfield', email ?? 'not looked up', email ? 'valid' : '',
  email ? 'treg.people.email.find' : 'not looked up', email ? '0.05' : '0',
]);

/** The workbook the job hands back: four sheets, and every company row carrying where it came from. */
const book = (email: string | null, total: string) => ({ name: 'Who to contact', sheets: [
  { name: 'Segments', columns: [{ header: 'Segment' }, { header: 'Why it is the best fit' }, { header: 'Source' }],
    rows: [['Independent joiners and furniture makers in the north', 'They buy fittings in small batches and shop locally',
      'https://trade.example/north-joinery-2026']] },
  { name: 'Companies', columns: [{ header: 'Company' }, { header: 'Site' }, { header: 'The fact that makes it a fit' }, { header: 'Source' }],
    rows: companies },
  { name: 'People', columns: [{ header: 'Company' }, { header: 'Role' }, { header: 'Name' }, { header: 'Work email' },
    { header: 'Verified' }, { header: 'Where it came from' }, { header: 'Cost' }], rows: people(email) },
  { name: 'What it cost', columns: [{ header: 'Lookup' }, { header: 'Cost' }, { header: 'Total spent' }, { header: 'Declined' }],
    rows: [['treg.people.email.find (Ada Whitfield)', '0.05', total, email ? '0' : '1'], ['Catalog price read', '0', total, email ? '0' : '1']] },
] });

const EMAIL_TEXT = 'Hi Ada,\n\nI saw Fernwood restored the town hall roof this year — that kind of joinery is why I thought of you.\n\nDo you have 15 minutes on Thursday?\n\nUmer';

const root = () => logRoot;
let logRoot = '';
function setup() {
  const { root, cfg, db, crew, done } = lab();
  crew.onboard('Umer');
  crew.recruit('tracer', 'Tracer', 'person');
  logRoot = root;
  const treg = fakeTreg(root);
  const originalPath = process.env.PATH;
  process.env.PATH = treg.path;
  return { cfg, db, crew, done, treg, restore: () => { process.env.PATH = originalPath; } };
}
const calls = (db: any, bot: string) => db.all("SELECT data FROM events WHERE kind = 'run.call' AND bot = ?", bot).map((e: any) => JSON.parse(e.data));
const spent = (root: string, log: string) => (existsSync(log) ? readFileSync(log, 'utf8') : '');

test('find-clients is wired into Tracer, and Home offers the job once the lookup tool is granted', async () => {
  const { crew, cfg, done } = setup();
  const file = join(cfg.repoDir, 'templates', 'tracer', 'bot.json');
  const conf = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(conf.skills.includes('find-clients'), 'the template lists the skill');
  assert.match(readFileSync(join(cfg.repoDir, 'templates', 'tracer', 'AGENTS.md'), 'utf8'),
    /Asked who should buy from their business, follow `find-clients`/, 'the job file points at it');
  assert.ok(existsSync(join(cfg.crewDir, 'bots', 'tracer', 'skills', 'find-clients', 'SKILL.md')), 'recruiting Tracer copies the skill in');
  const row = crew.snapshot().ideas.find((i: any) => /Find me clients/.test(i.ask));
  assert.ok(row, 'Home lists the job');
  assert.match(row.promise, /one workbook/, 'and says what they get');
  assert.deepEqual(row.needs, [], 'Tracer already has the lookup tool, so the job can be handed over');
  done();
});

test('the job asks before every paid lookup, runs it only after the yes, and hands back one workbook, one draft, nothing sent', async () => {
  const { cfg, db, crew, done, treg, restore } = setup();
  try {
    const paid = (name: string) => call('crew_app', { tool: 'people_search', input: { args: [
      'call', 'treg.people.email.find', '--header', 'X-Treg-Route-Max-Cost: 0.05', '--method', 'POST',
      '--data', JSON.stringify({ full_name: name, domain: 'fernwood.example' })] } });
    const { task: t } = (await crew.post('tracer', 'My site is fernwood.example, I make oak worktops for kitchens. Find me clients. '
      + call('crew_app', { tool: 'people_search', input: { args: ['catalog', 'search', 'work email founder'] } })
      + paid('Ada Whitfield')
      + call('crew_workbook', book(EMAIL, '0.05'))
      + call('crew_write', { path: 'files/fernwood-ada.md', content: EMAIL_TEXT })
      + call('crew_draft', { path: 'files/fernwood-ada.md', channel: 'email', to: EMAIL, subject: 'The town hall roof' })
      + ' ask permission: done'))!;

    // The catalog read is free; the paid lookup stops on a card, and nothing has been spent while it waits.
    await until('the lookup card', () => db.get("SELECT * FROM asks WHERE bot = 'tracer' AND state = 'open'"));
    const ask = db.get("SELECT * FROM asks WHERE bot = 'tracer' AND state = 'open'")!;
    const detail = JSON.parse(ask.detail);
    assert.equal(detail.effect, 'spend', 'a paid lookup is the person’s money');
    assert.equal(detail.cost, 0.05, 'and the card carries the cap from the call itself');
    assert.match(ask.title, /paid lookup with treg people search, up to \$0\.05/, 'the card names the tool and the most it may spend');
    assert.equal(detail.key, undefined, 'spending carries no key: asked every time');
    const card = crew.snapshot().asks.find((a: any) => a.id === ask.id)!;
    assert.equal(card.detail.always, undefined, 'and offers no standing Always OK');
    assert.equal(task(db, t).state, 'needs_you', 'the job waits on the person');
    assert.match(spent(root(), treg.log), /catalog search work email founder/, 'the free catalog read ran at once');
    assert.doesNotMatch(spent(root(), treg.log), /call/, 'the paid lookup has not run: no answer, no charge');

    await crew.answer(ask.id, { answer: 'allow' });
    await holding(crew, 'tracer');
    assert.match(spent(root(), treg.log), /call treg\.people\.email\.find .*X-Treg-Route-Max-Cost: 0\.05/, 'the yes runs exactly that call');
    await release(crew, 'tracer', 'Fernwood is first: they restored the town hall roof this year. Here is your workbook and the one email, unsent.');
    await settled(db, t);

    // The workbook is the deliverable: every company row carries where it came from.
    const delivered = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data));
    assert.equal(delivered.length, 1, 'one file, the workbook');
    const view: any = await crew.workbookView('tracer', delivered[0].path);
    assert.deepEqual(view.sheets.map((s: any) => s.name), ['Segments', 'Companies', 'People', 'What it cost']);
    const rows = view.sheets.map((s: any) => s.rows);
    for (const row of rows[1].slice(1)) assert.ok(String(row[3]).startsWith('http'), `every company row carries a source: ${row[0]}`);
    assert.ok(rows[0].slice(1).every((r: any) => String(r[2]).startsWith('http')), 'the best segment carries its source too');
    assert.deepEqual(rows[2][1][3], EMAIL, 'the verified address is the one the lookup returned');
    assert.equal(rows[3][rows[3].length - 1][2], '0.05', 'and the real total spent is on the sheet');
    for (const row of rows[2].slice(1)) assert.match(String(row[5]), /^treg|^not looked up$/, 'each row says where its address came from');

    // Exactly one draft card, still waiting on them; nothing was sent anywhere.
    const drafts = crew.snapshot().asks.filter((a: any) => a.kind === 'propose' && a.detail.draft);
    assert.equal(drafts.length, 1, 'one finished email on one card');
    assert.equal(drafts[0].detail.preview.body, EMAIL_TEXT, 'the whole email, in the person’s own business');
    assert.equal(drafts[0].state, 'open', 'it waits for them to send it themselves');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'draft.approved'")!.n, 0, 'nobody approved it');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE bot = 'tracer' AND state = 'open'")!.n, 1, 'the draft is the only thing left open');
    const tools = calls(db, 'tracer').map((c: any) => c.tool);
    assert.ok(!tools.includes('mail'), 'the mail tool was never touched');
    assert.ok(!tools.some((x: string) => /send|mail|smtp/i.test(x)), `nothing sends: ${tools.join(', ')}`);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'money.spent'")!.n, 1, 'one yes, one charge');
  } finally { restore(); done(); }
});

test('a person who says no to the lookup gets the workbook anyway, with no invented email behind it', async () => {
  const { cfg, db, crew, done, treg, restore } = setup();
  try {
    const { task: t } = (await crew.post('tracer', 'I sell handmade soap in Leeds. Find me clients, but I do not want to pay for lookups. '
      + call('crew_app', { tool: 'people_search', input: { args: ['call', 'treg.people.email.find', '--header', 'X-Treg-Route-Max-Cost: 0.05',
        '--method', 'POST', '--data', '{"full_name":"Ada Whitfield","domain":"fernwood.example"}'] } })
      + call('crew_workbook', book(null, '0'))
      + call('crew_write', { path: 'files/soap-list.md', content: 'Ten soap shops near Leeds, with the source for each.' })
      + call('crew_draft', { path: 'files/soap-list.md', channel: 'email', to: 'hello@fernwood.example', subject: 'Your oak worktops' })
      + ' ask permission: done'))!;
    await until('the lookup card', () => db.get("SELECT * FROM asks WHERE bot = 'tracer' AND state = 'open'"));
    const ask = db.get("SELECT * FROM asks WHERE bot = 'tracer' AND state = 'open'")!;
    await crew.answer(ask.id, { answer: 'deny' });
    await holding(crew, 'tracer');
    assert.doesNotMatch(spent(root(), treg.log), /call/, 'the lookup never ran, so nothing was charged');
    await release(crew, 'tracer', 'No problem — I used the open sources only. Ten shops with the source for each, and no email I could not verify.');
    await settled(db, t);

    const delivered = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data));
    const view: any = await crew.workbookView('tracer', delivered[0].path);
    const rows = view.sheets[2].rows.slice(1);
    assert.ok(rows.every((r: any) => r[3] === 'not looked up'), 'no email is invented for a lookup they said no to');
    assert.ok(rows.every((r: any) => !String(r[3]).includes('@')), 'not one address on the sheet');
    for (const row of view.sheets[1].rows.slice(1)) assert.ok(String(row[3]).startsWith('http'), 'the companies still carry their sources');
    assert.equal(view.sheets[3].rows[1][2], '0', 'and the sheet says the real total: nothing');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'money.spent'")!.n, 0, 'a no spends nothing');
    assert.match(lastSaid(db, 'tracer')!, /open sources only/, 'the job says it went on without the paid lookup');
    const drafts = crew.snapshot().asks.filter((a: any) => a.kind === 'propose' && a.detail.draft);
    assert.equal(drafts.length, 1, 'one draft card, still theirs to send');
    assert.equal(drafts[0].state, 'open');
    assert.ok(!calls(db, 'tracer').some((c: any) => /send|mail|smtp/i.test(c.tool)), 'nothing sends');
  } finally { restore(); done(); }
});
