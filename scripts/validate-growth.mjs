// Checks what a growth run left behind against crewd's own record, never the helper's word: which tools ran
// (run.call) and the files it delivered. The plan is read from the file the file.delivered event names,
// because run.call keeps only the first 1,000 characters of a call's input (crew.ts:1638).
//   node scripts/validate-growth.mjs <task-id>
// Prints PASS, FAIL or UNKNOWN per criterion; exits 1 on any FAIL. UNKNOWN means it could not be told, and says why.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Venues whose rules say the person writes the words: the card must carry the five labelled notes.
const NOTES = /hacker ?news|\bhn\b|product ?hunt|dev\.to|awesome|r\/[a-z0-9_]+|\breddit\b|listicle/i;
const LABELS = ['Thread:', 'They asked:', 'What you know that helps:', 'Say you made it:', 'Their rule:'];
// Paid data tools, and the cost cap a paid call carries. Growth work is free or the person's own sign-in.
const PAID = /people_search|treg|semrush|ahrefs|dataforseo|serpapi|hunter|apollo|clearbit|zoominfo|exploding|keywordtool|max-cost/i;
const CAPS = [ // plan §4: Crewhouse's own limits, counted from crewd's draft cards
  { what: '3 new draft cards a day', re: /.*/, n: 3, days: 1 },
  { what: '2 X originals a day', re: /\bx\b|twitter/i, n: 2, days: 1 },
  { what: '1 own-link Reddit post a week', re: /\breddit\b|r\/[a-z0-9_]+/i, n: 1, days: 7 },
  { what: '2 Show HN a year', re: /show ?hn/i, n: 2, days: 365 },
  { what: '1 Product Hunt every 6 months', re: /product ?hunt/i, n: 1, days: 183 },
];
const words = (text) => text.replace(/[#*`|>-]/g, ' ').split(/\s+/).filter(Boolean).length;
/** crewd keeps only the first 1,000 characters of a call's input (crew.ts:1638), so a long one arrives cut.
 *  What the checks need is the plain string values, and those survive: pick them out rather than give up. */
const argsOf = (raw) => {
  try { return JSON.parse(raw); } catch { const pick = (k) => new RegExp(`"${k}":"([^"]*)"`).exec(raw)?.[1]; return { to: pick('to'), path: pick('path'), cut: true }; }
};

export function validate({ db, crewDir }, id) {
  const t = db.get('SELECT * FROM tasks WHERE id = ?', id);
  if (!t) throw new Error(`no task ${id}`);
  const bot = join(crewDir, 'bots', t.bot), rows = [];
  const row = (verdict, what, detail) => rows.push({ verdict, what, detail });
  // The whole job, including the halves a helper handed on: the rivals document comes from Scout's task.
  const root = t.root ?? id;
  const kin = db.all('SELECT id FROM tasks WHERE root = ? OR id = ?', root, root).map((r) => r.id);
  const ev = (kind) => db.all(`SELECT bot, data FROM events WHERE kind = ? AND json_extract(data, '$.task') IN (${kin.map(() => '?').join(',')})`, kind, ...kin)
    .map((e) => ({ bot: e.bot, ...JSON.parse(e.data) }));
  const delivered = ev('file.delivered');
  const calls = db.all(`SELECT bot, data FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') IN (${kin.map(() => '?').join(',')})`, ...kin)
    .map((e) => { const d = JSON.parse(e.data); return { bot: e.bot, tool: String(d.tool), args: argsOf(d.input ?? '{}'), ok: d.ok }; });
  if (!calls.length) return row('UNKNOWN', 'record', 'no tool calls on record: nothing this run did can be checked'), rows;
  const fileOf = (b, path) => join(crewDir, 'bots', b, path);
  const text = (b, path) => (existsSync(fileOf(b, path)) ? readFileSync(fileOf(b, path), 'utf8') : '');

  // 1. The rivals document the plan is built on. It comes from Scout's own task, so a plan asked about on its
  //    own counts the crew's most recent one; the job's own tree always wins when it delivered one.
  const crewDocs = db.all("SELECT bot, at, data FROM events WHERE kind = 'file.delivered' AND json_extract(data, '$.input') IS NULL")
    .map((e) => ({ bot: e.bot, at: e.at, ...JSON.parse(e.data) })).filter((d) => /\.docx$/.test(d.path) && /rival|who[- ]?else|competitor|others/i.test(d.path));
  const rivals = delivered.filter((d) => /\.docx$/.test(d.path) && /rival|who[- ]?else|competitor|others/i.test(d.path));
  const doc = rivals.at(-1) ?? crewDocs.filter((d) => d.at <= (t.updated_at ?? 0) + 60_000).at(-1);
  row(doc ? 'PASS' : 'FAIL', 'rivals document', doc ? `${doc.bot}: ${doc.path}` : 'no document whose name says who else does this was delivered');

  // 2. The plan, from the file it delivered: at most 300 words.
  const plans = delivered.filter((d) => /\.md$/.test(d.path));
  const plan = plans.map((p) => ({ ...p, words: words(text(p.bot, p.path)) })).sort((a, b) => a.words - b.words)[0];
  if (!plan) row('FAIL', 'plan', 'no plan file was delivered');
  else row(plan.words <= 300 ? 'PASS' : 'FAIL', 'plan under 300 words', `${plan.path}: ${plan.words} words`);

  // 3. One to three draft cards.
  const drafts = calls.filter((c) => c.tool === 'crew_draft');
  row(drafts.length >= 1 && drafts.length <= 3 ? 'PASS' : 'FAIL', '1-3 draft cards', `${drafts.length} crew_draft call(s)`);

  // 4. A notes-style venue got labelled notes, not a finished post.
  for (const d of drafts.filter((x) => NOTES.test(String(x.args.to ?? '')))) {
    const body = text(d.bot, String(d.args.path ?? '')), missing = LABELS.filter((l) => !body.includes(l));
    row(missing.length ? 'FAIL' : 'PASS', `notes for ${d.args.to}`, missing.length ? `no ${missing.join(', ')}` : 'all five labels are there');
  }
  if (!drafts.some((d) => NOTES.test(String(d.args.to ?? '')))) row('UNKNOWN', 'notes venues', 'no notes-style venue in this run');

  // 5. Nothing that spends, nothing paid.
  const spent = ev('ask.opened').filter((e) => e.effect === 'spend');
  row(spent.length ? 'FAIL' : 'PASS', 'no spend ask', spent.length ? `${spent.length} spend card(s) opened` : 'no spend card');
  const paid = calls.filter((c) => PAID.test(c.tool) || PAID.test(JSON.stringify(c.args)));
  row(paid.length ? 'FAIL' : 'PASS', 'no paid tool', paid.length ? paid.map((c) => c.tool).join(', ') : 'free sources only');

  // 6. The caps, counted from every draft card this bot has ever filed, not only this run's.
  const cards = db.all("SELECT at, detail FROM asks WHERE kind = 'propose' AND json_extract(detail, '$.draft.to') IS NOT NULL AND bot = ?", t.bot)
    .map((r) => ({ at: r.at, to: String(JSON.parse(r.detail).draft.to) }));
  for (const cap of CAPS) {
    const since = Date.now() - cap.days * 86_400_000;
    const hit = cards.filter((c) => c.at >= since && cap.re.test(c.to));
    row(hit.length <= cap.n ? 'PASS' : 'FAIL', `cap: ${cap.what}`, `${hit.length} in the last ${cap.days} day(s)`);
  }
  row(['done', 'unsure'].includes(t.state) ? 'PASS' : 'FAIL', 'ended', t.state);
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id] = process.argv.slice(2);
  const { loadConfig } = await import('../src/config.ts');
  const { Store } = await import('../src/db.ts');
  const cfg = loadConfig();
  const rows = validate({ db: new Store(cfg.stateDir), crewDir: cfg.crewDir }, Number(id));
  for (const r of rows) console.log(`${r.verdict.padEnd(7)} ${r.what}: ${r.detail}`);
  process.exitCode = rows.some((r) => r.verdict === 'FAIL') ? 1 : 0;
}